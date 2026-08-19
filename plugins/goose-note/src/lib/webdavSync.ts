import { createClient } from "webdav";
import { useSettings } from "@/stores/settings";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { generateExportZip } from "@/lib/export";

export interface WebdavBackupFile {
  filename: string;
  basename: string;
  size: number;
  lastmod: string;
}

export function normalizeBaseUrl(raw: string): string {
  let val = raw.trim();
  if (!val) throw new Error("WebDAV 地址不能为空");
  
  if (!/^https?:\/\//i.test(val)) {
    throw new Error("WebDAV 地址必须以 http 或 https 开头");
  }

  if (/^http:\/\//i.test(val)) {
    let host = "";
    try {
      const url = new URL(val);
      host = url.hostname.toLowerCase();
    } catch (e) {
      const match = val.match(/^http:\/\/([^:/]+)/i);
      if (match) {
        host = match[1].toLowerCase();
      }
    }
    
    // 局域网私有地址和本地回环地址放行 HTTP，保障 NAS 局域网内同步的可用性（包含常见的 IPv6 本地及回环地址）
    const isLocal = 
      host === "localhost" || 
      host.startsWith("127.") || 
      host === "::1" ||
      host === "[::1]" ||
      host.startsWith("192.168.") || 
      host.startsWith("10.") || 
      host.endsWith(".local") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.startsWith("[fe80:") ||
      host.startsWith("[fd") ||
      host.startsWith("[fc");

    if (!isLocal) {
      throw new Error("公网 WebDAV 服务必须使用安全的 https 连接");
    }
  }
  
  try {
    const url = new URL(val);
    url.search = "";
    url.hash = "";
    val = url.toString();
  } catch (e) {
    throw new Error("WebDAV 地址格式无效", { cause: e });
  }
  
  if (!val.endsWith("/")) {
    val += "/";
  }
  return val;
}

export function normalizeRemoteDir(raw: string): string {
  const val = raw.trim().replace(/^\/|\/$/g, "");
  if (!val) throw new Error("WebDAV 远端目录不能为空");
  if (val.includes("\\")) throw new Error("WebDAV 远端目录不能包含反斜杠");
  
  const parts = val.split("/");
  const cleanParts: string[] = [];
  for (const part of parts) {
    const clean = part.trim();
    if (!clean) throw new Error("WebDAV 远端目录不能包含空路径段");
    
    let decoded: string;
    try {
      decoded = decodeURIComponent(clean);
    } catch (e) {
      throw new Error("WebDAV 远端目录编码无效", { cause: e });
    }
    
    if (decoded === "." || decoded === ".." || decoded.includes("\\")) {
      throw new Error("WebDAV 远端目录不能包含路径穿越片段");
    }
    cleanParts.push(clean);
  }
  return cleanParts.join("/");
}

export function isBackupFileName(fileName: string): boolean {
  const trimmed = fileName.trim();
  if (trimmed !== fileName || trimmed.includes("/") || trimmed.includes("\\")) {
    return false;
  }
  const backupPattern = /^goose-note-export-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/;
  return backupPattern.test(trimmed);
}

function formatWebdavError(error: any): string {
  const msg = String(error.message || error);
  if (msg.includes("AncestorsNotFound") || msg.includes("The ancestors of this location does not found")) {
    return "检测到上级目录不存在，请确认“远端目录”填写的是服务端已经存在的路径。部分 WebDAV 服务不支持直接在根目录创建文件夹，例如 Nextcloud、ownCloud、坚果云或部分 NAS 场景通常需要先在服务端创建同步目录，再在这里填写对应路径（如“backups/goose-notes”）。";
  }
  return msg;
}

async function ensureRemoteDir(client: any, remoteDir: string): Promise<void> {
  const dirClean = normalizeRemoteDir(remoteDir);
  const parts = dirClean.split("/");
  let currentPath = "";
  for (const part of parts) {
    if (!part) continue;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    try {
      const exists = await client.exists(currentPath);
      if (!exists) {
        await client.createDirectory(currentPath);
      }
    } catch (err: any) {
      if (err.status === 405 || err.response?.status === 405) {
        continue;
      }
      throw err;
    }
  }
}

export async function testWebdavConnection(
  url: string,
  username: string,
  passwordInput: string,
  remoteDir: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const cleanUrl = normalizeBaseUrl(url);
    const cleanDir = normalizeRemoteDir(remoteDir);
    const client = createClient(cleanUrl, { username, password: passwordInput });
    
    await client.getDirectoryContents("/");
    await ensureRemoteDir(client, cleanDir);
    await client.getDirectoryContents(cleanDir);
    
    return { ok: true, message: "连接成功" };
  } catch (err) {
    return { ok: false, message: formatWebdavError(err) };
  }
}

export async function listWebdavBackups(
  url: string,
  username: string,
  passwordInput: string,
  remoteDir: string
): Promise<WebdavBackupFile[]> {
  const cleanUrl = normalizeBaseUrl(url);
  const cleanDir = normalizeRemoteDir(remoteDir);
  const client = createClient(cleanUrl, { username, password: passwordInput });
  
  const exists = await client.exists(cleanDir);
  if (!exists) return [];
  
  const items = await client.getDirectoryContents(cleanDir);
  if (!Array.isArray(items)) return [];
  
  const files = items
    .filter(item => item.type === "file" && isBackupFileName(item.basename))
    .map(item => {
      let decodedBasename = item.basename;
      try {
        decodedBasename = decodeURIComponent(item.basename);
      } catch (e) {
        console.warn("解码文件名失败", item.basename, e);
      }
      return {
        filename: item.filename,
        basename: decodedBasename,
        size: item.size,
        lastmod: item.lastmod || new Date().toISOString()
      };
    });
    
  return files.sort((a, b) => {
    const timeA = new Date(a.lastmod).getTime();
    const timeB = new Date(b.lastmod).getTime();
    if (timeB !== timeA) return timeB - timeA;
    return b.basename.localeCompare(a.basename);
  });
}

export async function uploadWebdavBackup(
  url: string,
  username: string,
  passwordInput: string,
  remoteDir: string,
  retentionDays: number,
  zipBlob: Blob,
  fileName: string
): Promise<{ success: boolean; cleanedCount: number }> {
  if (!isBackupFileName(fileName)) {
    throw new Error("WebDAV 只允许操作鹅毛笔备份文件");
  }
  
  const cleanUrl = normalizeBaseUrl(url);
  const cleanDir = normalizeRemoteDir(remoteDir);
  const client = createClient(cleanUrl, { username, password: passwordInput });
  
  await ensureRemoteDir(client, cleanDir);
  
  const buffer = await zipBlob.arrayBuffer();
  await client.putFileContents(`${cleanDir}/${fileName}`, buffer);
  
  let cleanedCount = 0;
  try {
    const list = await listWebdavBackups(cleanUrl, username, passwordInput, cleanDir);
    const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    
    for (const file of list) {
      const fileTime = new Date(file.lastmod).getTime();
      if (fileTime < cutoff) {
        try {
          await client.deleteFile(`${cleanDir}/${file.basename}`);
          cleanedCount++;
        } catch (delErr: any) {
          if (delErr.status === 404 || delErr.response?.status === 404) {
            continue;
          }
          console.error("删除过期备份文件出错", file.basename, delErr);
        }
      }
    }
  } catch (cleanErr) {
    console.warn("清理过期备份失败", cleanErr);
  }
  
  return { success: true, cleanedCount };
}

export async function downloadWebdavBackup(
  url: string,
  username: string,
  passwordInput: string,
  remoteDir: string,
  fileName: string
): Promise<Blob> {
  if (!isBackupFileName(fileName)) {
    throw new Error("WebDAV 只允许操作鹅毛笔备份文件");
  }
  
  const cleanUrl = normalizeBaseUrl(url);
  const cleanDir = normalizeRemoteDir(remoteDir);
  const client = createClient(cleanUrl, { username, password: passwordInput });
  
  const fileData = await client.getFileContents(`${cleanDir}/${fileName}`, { format: "binary" }) as ArrayBuffer;
  return new Blob([fileData], { type: "application/zip" });
}

export async function deleteWebdavBackup(
  url: string,
  username: string,
  passwordInput: string,
  remoteDir: string,
  fileName: string
): Promise<void> {
  if (!isBackupFileName(fileName)) {
    throw new Error("WebDAV 只允许操作鹅毛笔备份文件");
  }
  
  const cleanUrl = normalizeBaseUrl(url);
  const cleanDir = normalizeRemoteDir(remoteDir);
  const client = createClient(cleanUrl, { username, password: passwordInput });
  try {
    await client.deleteFile(`${cleanDir}/${fileName}`);
  } catch (err: any) {
    if (err.status === 404 || err.response?.status === 404) {
      return;
    }
    throw err;
  }
}

export async function triggerAutoWebdavBackup(): Promise<void> {
  const settings = useSettings.getState();
  const {
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavRemoteDir,
    webdavRetentionDays,
    webdavAutoBackupEnabled,
    webdavLastUploadAt,
    updateWebdavSettings
  } = settings;

  if (!webdavAutoBackupEnabled) return;
  if (!webdavUrl || !webdavUsername || !webdavPassword || !webdavRemoteDir) return;

  const now = Date.now();
  if (webdavLastUploadAt) {
    const lastTime = new Date(webdavLastUploadAt).getTime();
    if (now - lastTime < 24 * 60 * 60 * 1000) {
      return;
    }
  }

  try {
    const notebooksStore = useNotebooks.getState();
    const pagesStore = usePages.getState();
    const notebookList = Object.values(notebooksStore.notebooks);
    const notebookIds = notebookList.map(n => n.id);
    if (notebookIds.length === 0) return;

    const zipBlob = await generateExportZip(
      { format: "md", notebookIds },
      notebooksStore.notebooks,
      Object.values(pagesStore.pages)
    );

    const date = new Date(now);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fileName = `goose-note-export-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.zip`;

    const result = await uploadWebdavBackup(
      webdavUrl,
      webdavUsername,
      webdavPassword,
      webdavRemoteDir,
      webdavRetentionDays,
      zipBlob,
      fileName
    );

    if (result.success) {
      updateWebdavSettings({
        webdavLastUploadAt: date.toISOString(),
        webdavLastUploadFilename: fileName,
      });
      console.log(`[AutoBackup] WebDAV auto backup completed: ${fileName}, cleaned: ${result.cleanedCount}`);
    }
  } catch (err) {
    console.warn("[AutoBackup] WebDAV auto backup failed silently:", err);
  }
}
