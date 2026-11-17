"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const { isMarkdownFile } = require("./fs-workspace.cjs");

function normalizeRemotePath(remotePath) {
  const raw = String(remotePath || "/TyporaNotes/").trim();
  const collapsed = raw.replace(/\\/g, "/").replace(/\/+/g, "/");
  const withLeading = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function normalizeWebdavConfig(config = {}) {
  const serverUrl = String(config.serverUrl || "").trim();
  const username = String(config.username || "").trim();
  const password = String(config.password || "");
  const remotePath = normalizeRemotePath(config.remotePath);
  const syncDirection =
    config.syncDirection === "push" || config.syncDirection === "pull"
      ? config.syncDirection
      : "bidirectional";

  return {
    enabled: Boolean(config.enabled),
    serverUrl,
    username,
    password,
    remotePath,
    autoSyncOnSave: config.autoSyncOnSave !== false,
    syncDirection
  };
}

function sanitizeDocFileName(fileName) {
  const base = path.basename(String(fileName || "Untitled.md").trim() || "Untitled.md");
  const ext = path.extname(base).toLowerCase();
  if (!ext) {
    return `${base}.md`;
  }
  return base;
}

function isMarkdownFileName(fileName) {
  return isMarkdownFile(String(fileName || ""));
}

function buildAuthHeader(username, password) {
  if (!username && !password) return null;
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function resolveWebdavUrl(serverUrl, remotePath, fileName = "") {
  if (!serverUrl) {
    throw new Error("WebDAV 服务器地址不能为空");
  }
  let parsedBase;
  try {
    parsedBase = new URL(serverUrl);
  } catch {
    throw new Error(`无效的 WebDAV 服务器 URL: ${serverUrl}`);
  }
  if (parsedBase.protocol !== "http:" && parsedBase.protocol !== "https:") {
    throw new Error("WebDAV 仅支持 http:// 或 https:// 协议");
  }

  const basePath = parsedBase.pathname.replace(/\/+$/, "");
  const relSegments = normalizeRemotePath(remotePath)
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)));

  let fullPathname = `${basePath}/${relSegments.join("/")}/`.replace(/\/+/g, "/");
  if (fileName) {
    const safeFile = sanitizeDocFileName(fileName);
    fullPathname = `${fullPathname}${encodeURIComponent(safeFile)}`;
  }

  const target = new URL(parsedBase.toString());
  target.pathname = fullPathname;
  return target;
}

function sendWebdavRequest(targetUrl, options = {}, redirectCount = 0) {
  const urlObj = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl));
  const client = urlObj.protocol === "https:" ? https : http;
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs || 12000;
  const maxRedirects = options.maxRedirects ?? 3;
  const bodyBuffer =
    options.body === undefined || options.body === null
      ? null
      : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(String(options.body), "utf8");

  const headers = {
    "User-Agent": "ZTools-Markdown-WebDAV/1.0",
    ...(options.headers || {})
  };

  if (bodyBuffer) {
    headers["Content-Length"] = String(bodyBuffer.length);
  }

  return new Promise((resolve, reject) => {
    const req = client.request(
      urlObj,
      {
        method,
        headers,
        timeout: timeoutMs
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const locationHeader = res.headers?.location;
        if (
          [301, 302, 307, 308].includes(statusCode) &&
          locationHeader &&
          redirectCount < maxRedirects
        ) {
          res.resume();
          try {
            const redirectedUrl = new URL(locationHeader, urlObj);
            if (
              redirectedUrl.protocol === "http:" ||
              redirectedUrl.protocol === "https:"
            ) {
              resolve(
                sendWebdavRequest(redirectedUrl, options, redirectCount + 1)
              );
              return;
            }
          } catch {
            // Fall through and return raw response if redirect URL is malformed
          }
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode,
            statusMessage: res.statusMessage || "",
            headers: res.headers || {},
            bodyBuffer: buffer,
            bodyText: buffer.toString("utf8")
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`WebDAV 请求超时 (${timeoutMs}ms)`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (bodyBuffer && bodyBuffer.length > 0) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function ensureRemoteCollection(rawConfig) {
  const config = normalizeWebdavConfig(rawConfig);
  const auth = buildAuthHeader(config.username, config.password);
  const baseHeaders = auth ? { Authorization: auth } : {};

  const segments = config.remotePath.split("/").filter(Boolean);
  let cumulative = "/";
  for (const seg of segments) {
    cumulative = `${cumulative}${seg}/`;
    const colUrl = resolveWebdavUrl(config.serverUrl, cumulative);
    const res = await sendWebdavRequest(colUrl, {
      method: "MKCOL",
      headers: baseHeaders
    });
    // 201 Created, 405 Method Not Allowed (already exists), 200/204/207/301/302 are acceptable
    if (res.statusCode === 401 || res.statusCode === 403) {
      return {
        ok: false,
        status: res.statusCode,
        message: `WebDAV 鉴权失败 (HTTP ${res.statusCode})，请检查账号或应用密码`
      };
    }
  }
  return { ok: true, status: 201 };
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXmlTagText(xmlBlock, localTagName) {
  const regex = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${localTagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localTagName}>`,
    "i"
  );
  const match = xmlBlock.match(regex);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function isCollectionResource(xmlBlock) {
  const resTypeMatch = xmlBlock.match(
    /<(?:[a-zA-Z0-9_-]+:)?resourcetype\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?resourcetype>/i
  );
  if (!resTypeMatch) return false;
  return /<(?:[a-zA-Z0-9_-]+:)?collection\b/i.test(resTypeMatch[1]);
}

function parsePropfindXml(xmlText, collectionUrlPathname) {
  const responseBlocks =
    String(xmlText || "").match(
      /<(?:[a-zA-Z0-9_-]+:)?response\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?response>/gi
    ) || [];

  const normalizedCollectionPath = decodeURIComponent(
    String(collectionUrlPathname || "").replace(/\/+$/, "")
  );

  const files = [];
  const seenNames = new Set();

  for (const block of responseBlocks) {
    const rawHref = extractXmlTagText(block, "href");
    if (!rawHref) continue;

    let hrefPathname = rawHref;
    try {
      if (/^https?:\/\//i.test(rawHref)) {
        hrefPathname = new URL(rawHref).pathname;
      }
    } catch {
      // keep rawHref
    }

    const decodedHref = decodeURIComponent(hrefPathname);
    const trimmedHref = decodedHref.replace(/\/+$/, "");

    if (!trimmedHref || trimmedHref === normalizedCollectionPath) {
      continue;
    }

    if (isCollectionResource(block) || decodedHref.endsWith("/")) {
      continue;
    }

    const fileName = path.posix.basename(trimmedHref);
    if (!fileName || !isMarkdownFileName(fileName) || seenNames.has(fileName)) {
      continue;
    }

    const sizeStr = extractXmlTagText(block, "getcontentlength");
    const lastModStr = extractXmlTagText(block, "getlastmodified");
    const etagStr = extractXmlTagText(block, "getetag").replace(/^"+|"+$/g, "");

    const size = Number.isFinite(Number(sizeStr)) ? Number(sizeStr) : 0;
    const parsedTime = lastModStr ? Date.parse(lastModStr) : NaN;
    const hasValidMtime = Number.isFinite(parsedTime);
    const mtimeMs = hasValidMtime ? parsedTime : 0;

    seenNames.add(fileName);
    files.push({
      name: fileName,
      href: rawHref,
      size,
      lastModified: lastModStr || "",
      mtimeMs,
      hasValidMtime,
      etag: etagStr
    });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return files;
}

async function testWebdavConnection(rawConfig) {
  try {
    const config = normalizeWebdavConfig(rawConfig);
    const collectionUrl = resolveWebdavUrl(config.serverUrl, config.remotePath);
    const auth = buildAuthHeader(config.username, config.password);
    const headers = {
      ...(auth ? { Authorization: auth } : {})
    };

    const mkcolResult = await ensureRemoteCollection(config);
    if (!mkcolResult.ok) {
      return {
        ok: false,
        status: mkcolResult.status,
        message: mkcolResult.message,
        serverUrl: config.serverUrl,
        remotePath: config.remotePath,
        fileCount: 0,
        files: []
      };
    }

    const propfindXml =
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

    const res = await sendWebdavRequest(collectionUrl, {
      method: "PROPFIND",
      headers: {
        ...headers,
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8"
      },
      body: propfindXml
    });

    if (res.statusCode === 401 || res.statusCode === 403) {
      return {
        ok: false,
        status: res.statusCode,
        message: `认证失败 (HTTP ${res.statusCode})，请检查用户名与应用密码`,
        serverUrl: config.serverUrl,
        remotePath: config.remotePath,
        fileCount: 0,
        files: []
      };
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const files = parsePropfindXml(res.bodyText, collectionUrl.pathname);
      return {
        ok: true,
        status: res.statusCode,
        message: `WebDAV 连接成功 · 远端目录 ${config.remotePath} (${files.length} 篇云端文档)`,
        serverUrl: config.serverUrl,
        remotePath: config.remotePath,
        fileCount: files.length,
        files
      };
    }

    return {
      ok: false,
      status: res.statusCode,
      message: `服务器返回异常状态 HTTP ${res.statusCode} ${res.statusMessage}`,
      serverUrl: config.serverUrl,
      remotePath: config.remotePath,
      fileCount: 0,
      files: []
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `连接失败: ${err instanceof Error ? err.message : String(err)}`,
      serverUrl: String(rawConfig?.serverUrl || ""),
      remotePath: normalizeRemotePath(rawConfig?.remotePath),
      fileCount: 0,
      files: []
    };
  }
}

async function listWebdavFiles(rawConfig) {
  const result = await testWebdavConnection(rawConfig);
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    remotePath: result.remotePath,
    files: result.files || [],
    syncedAt: Date.now()
  };
}

async function pushWebdavDocument(rawConfig, docName, content) {
  const config = normalizeWebdavConfig(rawConfig);
  const safeName = sanitizeDocFileName(docName);
  const mkcolResult = await ensureRemoteCollection(config);
  if (!mkcolResult.ok) {
    throw new Error(mkcolResult.message);
  }

  const targetUrl = resolveWebdavUrl(config.serverUrl, config.remotePath, safeName);
  const auth = buildAuthHeader(config.username, config.password);
  const bodyStr = String(content ?? "");

  const res = await sendWebdavRequest(targetUrl, {
    method: "PUT",
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      "Content-Type": "text/markdown; charset=utf-8"
    },
    body: bodyStr
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `上传 ${safeName} 失败: HTTP ${res.statusCode} ${res.statusMessage}`
    );
  }

  return {
    ok: true,
    name: safeName,
    remoteUrl: targetUrl.toString(),
    status: res.statusCode,
    size: Buffer.byteLength(bodyStr, "utf8"),
    syncedAt: Date.now()
  };
}

async function pullWebdavDocument(rawConfig, remoteFileName, localTargetDir = null) {
  const config = normalizeWebdavConfig(rawConfig);
  const safeName = sanitizeDocFileName(remoteFileName);
  const targetUrl = resolveWebdavUrl(config.serverUrl, config.remotePath, safeName);
  const auth = buildAuthHeader(config.username, config.password);

  const res = await sendWebdavRequest(targetUrl, {
    method: "GET",
    headers: {
      ...(auth ? { Authorization: auth } : {})
    }
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `拉取云端文档 ${safeName} 失败: HTTP ${res.statusCode} ${res.statusMessage}`
    );
  }

  const content = res.bodyText;
  const lastModHeader = res.headers["last-modified"];
  const parsedMtime = lastModHeader ? Date.parse(lastModHeader) : NaN;
  const mtimeMs = Number.isFinite(parsedMtime) ? parsedMtime : Date.now();

  let savedPath = null;
  let savedDir = "";
  if (localTargetDir && typeof localTargetDir === "string" && fs.existsSync(localTargetDir)) {
    savedDir = path.resolve(localTargetDir);
    savedPath = path.join(savedDir, safeName);
    fs.writeFileSync(savedPath, content, "utf8");
  }

  return {
    ok: true,
    name: safeName,
    content,
    path: savedPath,
    dir: savedDir,
    size: Buffer.byteLength(content, "utf8"),
    mtimeMs,
    syncedAt: Date.now()
  };
}

async function deleteWebdavDocument(rawConfig, remoteFileName) {
  const config = normalizeWebdavConfig(rawConfig);
  const safeName = sanitizeDocFileName(remoteFileName);
  const targetUrl = resolveWebdavUrl(config.serverUrl, config.remotePath, safeName);
  const auth = buildAuthHeader(config.username, config.password);

  const res = await sendWebdavRequest(targetUrl, {
    method: "DELETE",
    headers: {
      ...(auth ? { Authorization: auth } : {})
    }
  });

  if (
    res.statusCode !== 404 &&
    (res.statusCode < 200 || res.statusCode >= 300)
  ) {
    throw new Error(
      `删除云端文档 ${safeName} 失败: HTTP ${res.statusCode} ${res.statusMessage}`
    );
  }

  return {
    ok: true,
    name: safeName,
    status: res.statusCode
  };
}

async function syncWorkspaceWithWebdav(rawConfig, options = {}) {
  const config = normalizeWebdavConfig(rawConfig);
  const direction =
    options.direction || config.syncDirection || "bidirectional";
  const localDir =
    options.localDir &&
    typeof options.localDir === "string" &&
    fs.existsSync(options.localDir)
      ? path.resolve(options.localDir)
      : null;
  const activeDoc =
    options.activeDoc &&
    typeof options.activeDoc === "object" &&
    options.activeDoc.name
      ? options.activeDoc
      : null;

  const initialList = await listWebdavFiles(config);
  if (!initialList.ok) {
    return {
      ok: false,
      direction,
      uploaded: [],
      downloaded: [],
      downloadedPaths: [],
      skipped: [],
      remoteFiles: [],
      syncedAt: Date.now(),
      message: initialList.message
    };
  }

  const remoteMap = new Map(initialList.files.map((f) => [f.name, f]));
  const uploaded = [];
  const downloaded = [];
  const downloadedPaths = [];
  const skipped = [];

  // 1. Collect local markdown file metadata without reading file contents upfront
  const localMap = new Map();
  if (localDir) {
    const entries = fs.readdirSync(localDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (!isMarkdownFileName(entry.name)) continue;
      const fullPath = path.join(localDir, entry.name);
      const stat = fs.statSync(fullPath);
      localMap.set(entry.name, {
        name: entry.name,
        path: fullPath,
        content: null,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
    }
  }

  // Also include activeDoc if it's not already in localMap and direction allows push
  if (
    activeDoc &&
    (direction === "push" || direction === "bidirectional") &&
    !localMap.has(sanitizeDocFileName(activeDoc.name))
  ) {
    const safeActiveName = sanitizeDocFileName(activeDoc.name);
    const activeContent = String(activeDoc.content ?? "");
    localMap.set(safeActiveName, {
      name: safeActiveName,
      path: activeDoc.path || null,
      content: activeContent,
      mtimeMs: activeDoc.mtimeMs || Date.now(),
      size: Buffer.byteLength(activeContent, "utf8")
    });
  }

  // 2. Push phase (local -> remote)
  if (direction === "push" || direction === "bidirectional") {
    for (const [name, localFile] of localMap.entries()) {
      const remoteFile = remoteMap.get(name);
      const remoteHasMtime = Boolean(remoteFile && remoteFile.mtimeMs > 0);
      const shouldPush =
        direction === "push" ||
        !remoteFile ||
        (remoteHasMtime
          ? localFile.mtimeMs >= remoteFile.mtimeMs - 1000
          : localFile.size !== remoteFile.size);

      if (shouldPush) {
        const contentToPush =
          localFile.content !== null
            ? localFile.content
            : fs.readFileSync(localFile.path, "utf8");
        await pushWebdavDocument(config, name, contentToPush);
        uploaded.push(name);
      } else {
        skipped.push(name);
      }
    }
  }

  // 3. Pull phase (remote -> localDir)
  if ((direction === "pull" || direction === "bidirectional") && localDir) {
    for (const [name, remoteFile] of remoteMap.entries()) {
      if (uploaded.includes(name)) continue;
      const localFile = localMap.get(name);
      const remoteHasMtime = Boolean(remoteFile.mtimeMs > 0);
      const shouldPull =
        direction === "pull" ||
        !localFile ||
        (remoteHasMtime && remoteFile.mtimeMs > localFile.mtimeMs + 1000);

      if (shouldPull) {
        const pulled = await pullWebdavDocument(config, name, localDir);
        downloaded.push(name);
        if (pulled.path) {
          downloadedPaths.push(pulled.path);
        }
      } else if (!skipped.includes(name)) {
        skipped.push(name);
      }
    }
  }

  const refreshed = await listWebdavFiles(config);
  const remoteFiles = refreshed.ok ? refreshed.files : initialList.files;

  return {
    ok: true,
    direction,
    uploaded,
    downloaded,
    downloadedPaths,
    skipped,
    remoteFiles,
    syncedAt: Date.now(),
    message: `同步完成：上传 ${uploaded.length} 篇，下载 ${downloaded.length} 篇（云端共 ${remoteFiles.length} 篇）`
  };
}

module.exports = {
  normalizeWebdavConfig,
  parsePropfindXml,
  testWebdavConnection,
  listWebdavFiles,
  pushWebdavDocument,
  pullWebdavDocument,
  deleteWebdavDocument,
  syncWorkspaceWithWebdav
};
