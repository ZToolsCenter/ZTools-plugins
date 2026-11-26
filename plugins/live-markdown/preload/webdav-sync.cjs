"use strict";

// WebDAV 同步编排层：连接测试、上传、拉取、删除与工作区同步。
// 传输细节在 webdav-transport.cjs；所有覆盖写入（云端或本地）都先经过 webdav-sync-ledger.cjs 的冲突守卫。

const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeRemotePath,
  normalizeWebdavConfig,
  sanitizeDocFileName,
  isMarkdownFileName,
  buildAuthHeader,
  resolveWebdavUrl,
  sendWebdavRequest,
  ensureRemoteCollection,
  parsePropfindXml
} = require("./webdav-transport.cjs");
const {
  hashContent,
  createWebdavSyncLedger,
  decidePullWrite,
  decidePushWrite,
  describeConflict
} = require("./webdav-sync-ledger.cjs");

let defaultLedger = null;
function resolveLedger(options) {
  if (options && options.ledger) return options.ledger;
  if (!defaultLedger) defaultLedger = createWebdavSyncLedger();
  return defaultLedger;
}

function authHeaders(config) {
  const auth = buildAuthHeader(config.username, config.password);
  return auth ? { Authorization: auth } : {};
}

async function testWebdavConnection(rawConfig) {
  try {
    const config = normalizeWebdavConfig(rawConfig);
    const collectionUrl = resolveWebdavUrl(config.serverUrl, config.remotePath);

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
        ...authHeaders(config),
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

/** 读取云端文档；不存在时返回 null。 */
async function fetchRemoteDocument(config, safeName) {
  const targetUrl = resolveWebdavUrl(config.serverUrl, config.remotePath, safeName);
  const res = await sendWebdavRequest(targetUrl, { method: "GET", headers: authHeaders(config) });
  if (res.statusCode === 404 || res.statusCode === 410) return null;
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`拉取云端文档 ${safeName} 失败: HTTP ${res.statusCode} ${res.statusMessage}`);
  }
  const lastModHeader = res.headers["last-modified"];
  const parsedMtime = lastModHeader ? Date.parse(lastModHeader) : NaN;
  return {
    content: res.bodyText,
    mtimeMs: Number.isFinite(parsedMtime) ? parsedMtime : Date.now()
  };
}

function readLocalHash(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return hashContent(fs.readFileSync(filePath, "utf8"));
}

function conflictResult(direction, safeName, reason) {
  const message = describeConflict(direction, safeName, reason);
  return { ok: false, conflict: true, reason, name: safeName, error: message, message };
}

async function pushWebdavDocument(rawConfig, docName, content, options = {}) {
  const config = normalizeWebdavConfig(rawConfig);
  const ledger = resolveLedger(options);
  const safeName = sanitizeDocFileName(docName);
  const mkcolResult = await ensureRemoteCollection(config);
  if (!mkcolResult.ok) {
    throw new Error(mkcolResult.message);
  }

  const bodyStr = String(content ?? "");
  const localHash = hashContent(bodyStr);
  const localPath = typeof options.localPath === "string" && options.localPath ? options.localPath : null;
  const remote = await fetchRemoteDocument(config, safeName);
  const remoteHash = remote ? hashContent(remote.content) : null;
  const decision = decidePushWrite({
    binding: ledger.get(config, safeName),
    localPath,
    localHash,
    remoteHash
  });
  if (!decision.allowed) {
    return { ...conflictResult("push", safeName, decision.reason), syncedAt: Date.now() };
  }

  const targetUrl = resolveWebdavUrl(config.serverUrl, config.remotePath, safeName);
  if (remoteHash !== localHash) {
    const res = await sendWebdavRequest(targetUrl, {
      method: "PUT",
      headers: { ...authHeaders(config), "Content-Type": "text/markdown; charset=utf-8" },
      body: bodyStr
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`上传 ${safeName} 失败: HTTP ${res.statusCode} ${res.statusMessage}`);
    }
  }
  ledger.record(config, safeName, { localPath, contentHash: localHash });

  return {
    ok: true,
    name: safeName,
    remoteUrl: targetUrl.toString(),
    status: 201,
    size: Buffer.byteLength(bodyStr, "utf8"),
    syncedAt: Date.now()
  };
}

async function pullWebdavDocument(rawConfig, remoteFileName, localTargetDir = null, options = {}) {
  const config = normalizeWebdavConfig(rawConfig);
  const ledger = resolveLedger(options);
  const safeName = sanitizeDocFileName(remoteFileName);
  const remote = await fetchRemoteDocument(config, safeName);
  if (!remote) {
    throw new Error(`拉取云端文档 ${safeName} 失败: HTTP 404 Not Found`);
  }
  const { content, mtimeMs } = remote;
  const remoteHash = hashContent(content);

  let savedPath = null;
  let savedDir = "";
  if (localTargetDir && typeof localTargetDir === "string" && fs.existsSync(localTargetDir)) {
    savedDir = path.resolve(localTargetDir);
    const targetPath = path.join(savedDir, safeName);
    const localHash = readLocalHash(targetPath);
    const decision = decidePullWrite({
      binding: ledger.get(config, safeName),
      localPath: targetPath,
      localHash,
      remoteHash
    });
    if (!decision.allowed) {
      return { ...conflictResult("pull", safeName, decision.reason), path: null, dir: savedDir, syncedAt: Date.now() };
    }
    if (localHash !== remoteHash) {
      fs.writeFileSync(targetPath, content, "utf8");
    }
    savedPath = targetPath;
    ledger.record(config, safeName, { localPath: targetPath, contentHash: remoteHash });
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

async function deleteWebdavDocument(rawConfig, remoteFileName, options = {}) {
  const config = normalizeWebdavConfig(rawConfig);
  const safeName = sanitizeDocFileName(remoteFileName);
  const targetUrl = resolveWebdavUrl(config.serverUrl, config.remotePath, safeName);

  const res = await sendWebdavRequest(targetUrl, { method: "DELETE", headers: authHeaders(config) });

  if (res.statusCode !== 404 && (res.statusCode < 200 || res.statusCode >= 300)) {
    throw new Error(`删除云端文档 ${safeName} 失败: HTTP ${res.statusCode} ${res.statusMessage}`);
  }
  resolveLedger(options).forget(config, safeName);

  return { ok: true, name: safeName, status: res.statusCode };
}

function collectLocalMarkdown(localDir) {
  const localMap = new Map();
  if (!localDir) return localMap;
  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    if (!isMarkdownFileName(entry.name)) continue;
    const fullPath = path.join(localDir, entry.name);
    const stat = fs.statSync(fullPath);
    localMap.set(entry.name, { name: entry.name, path: fullPath, content: null, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  return localMap;
}

async function syncWorkspaceWithWebdav(rawConfig, options = {}) {
  const config = normalizeWebdavConfig(rawConfig);
  const ledgerOptions = { ledger: resolveLedger(options) };
  const direction = options.direction || config.syncDirection || "bidirectional";
  const localDir =
    options.localDir && typeof options.localDir === "string" && fs.existsSync(options.localDir)
      ? path.resolve(options.localDir)
      : null;
  const activeDoc =
    options.activeDoc && typeof options.activeDoc === "object" && options.activeDoc.name ? options.activeDoc : null;

  const initialList = await listWebdavFiles(config);
  if (!initialList.ok) {
    return {
      ok: false,
      direction,
      uploaded: [],
      downloaded: [],
      downloadedPaths: [],
      skipped: [],
      conflicts: [],
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
  const conflicts = [];
  const conflictNames = new Set();
  const noteConflict = (result, dir) => {
    conflictNames.add(result.name);
    conflicts.push({ name: result.name, direction: dir, reason: result.reason, message: result.message });
  };

  // 1. 收集本地 Markdown 元数据，不预读内容
  const localMap = collectLocalMarkdown(localDir);

  // 当前文档不在工作区根目录时也参与上传
  if (activeDoc && (direction === "push" || direction === "bidirectional") && !localMap.has(sanitizeDocFileName(activeDoc.name))) {
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

  // 2. 上传阶段（本地 -> 云端）
  if (direction === "push" || direction === "bidirectional") {
    for (const [name, localFile] of localMap.entries()) {
      const remoteFile = remoteMap.get(name);
      const remoteHasMtime = Boolean(remoteFile && remoteFile.mtimeMs > 0);
      const shouldPush =
        direction === "push" ||
        !remoteFile ||
        (remoteHasMtime ? localFile.mtimeMs >= remoteFile.mtimeMs - 1000 : localFile.size !== remoteFile.size);

      if (!shouldPush) {
        skipped.push(name);
        continue;
      }
      const contentToPush = localFile.content !== null ? localFile.content : fs.readFileSync(localFile.path, "utf8");
      const pushed = await pushWebdavDocument(config, name, contentToPush, { ...ledgerOptions, localPath: localFile.path });
      if (pushed.ok) uploaded.push(name);
      else noteConflict(pushed, "push");
    }
  }

  // 3. 拉取阶段（云端 -> localDir）
  if ((direction === "pull" || direction === "bidirectional") && localDir) {
    for (const [name, remoteFile] of remoteMap.entries()) {
      if (uploaded.includes(name) || conflictNames.has(name)) continue;
      const localFile = localMap.get(name);
      const remoteHasMtime = Boolean(remoteFile.mtimeMs > 0);
      const shouldPull =
        direction === "pull" || !localFile || (remoteHasMtime && remoteFile.mtimeMs > localFile.mtimeMs + 1000);

      if (shouldPull) {
        const pulled = await pullWebdavDocument(config, name, localDir, ledgerOptions);
        if (!pulled.ok) {
          noteConflict(pulled, "pull");
          continue;
        }
        downloaded.push(name);
        if (pulled.path) downloadedPaths.push(pulled.path);
      } else if (!skipped.includes(name)) {
        skipped.push(name);
      }
    }
  }

  const refreshed = await listWebdavFiles(config);
  const remoteFiles = refreshed.ok ? refreshed.files : initialList.files;
  const conflictNote = conflicts.length > 0 ? `，${conflicts.length} 篇同名冲突已跳过` : "";

  return {
    ok: true,
    direction,
    uploaded,
    downloaded,
    downloadedPaths,
    skipped,
    conflicts,
    remoteFiles,
    syncedAt: Date.now(),
    message: `同步完成：上传 ${uploaded.length} 篇，下载 ${downloaded.length} 篇${conflictNote}（云端共 ${remoteFiles.length} 篇）`
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
