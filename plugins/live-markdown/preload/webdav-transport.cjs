"use strict";

// WebDAV 传输层：URL 解析、鉴权、HTTP 请求、MKCOL 与 PROPFIND 解析。不涉及本地文件写入与冲突判定。

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

module.exports = {
  normalizeRemotePath,
  normalizeWebdavConfig,
  sanitizeDocFileName,
  isMarkdownFileName,
  buildAuthHeader,
  resolveWebdavUrl,
  sendWebdavRequest,
  ensureRemoteCollection,
  parsePropfindXml
};
