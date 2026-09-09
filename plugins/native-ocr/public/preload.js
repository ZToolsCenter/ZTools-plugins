const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { clipboard } = require("electron");
const { execFile, spawn, spawnSync } = require("node:child_process");

const OCR_IMAGE_STORAGE_KEY = "native_ocr_image";
const OCR_IMAGE_EVENT = "native-ocr-image";
const RUNTIME_REGISTRY_URL = "https://registry.npmmirror.com/@ztools-center/wechat-ocr-native";
const RUNTIME_DIST_PREFIX = "package/dist/";
// 运行时下载文件统一存放在 ZTools 插件数据目录（ztools.getPath("pluginData")），
// 插件卸载时由 ZTools 自动清理；无法获取该目录时退回传统缓存位置。
const LEGACY_CACHE_ROOT = path.join(os.homedir(), "Library", "Application Support", "ZTools", "native-ocr");
let runtimeCacheRootCache = "";
function getRuntimeCacheRoot() {
  if (runtimeCacheRootCache) return runtimeCacheRootCache;
  let root = "";
  try {
    const api = typeof ztools !== "undefined" ? ztools : window.ztools;
    const dataDir = api && typeof api.getPath === "function" ? api.getPath("pluginData") : "";
    if (dataDir) root = path.join(dataDir, "native-ocr");
  } catch (_) {
    // ztools API 不可用时使用回退目录
  }
  if (!root && process.platform === "win32" && process.env.APPDATA) {
    root = path.join(process.env.APPDATA, "ZTools", "native-ocr");
  }
  if (!root) root = LEGACY_CACHE_ROOT;
  try {
    if (root !== LEGACY_CACHE_ROOT && fs.existsSync(LEGACY_CACHE_ROOT) && !fs.existsSync(root)) {
      fs.mkdirSync(path.dirname(root), { recursive: true });
      fs.renameSync(LEGACY_CACHE_ROOT, root); // 迁移旧缓存，避免已下载的运行时重复下载
    }
  } catch (_) {
    // 迁移失败不影响后续流程（大不了重新下载）
  }
  runtimeCacheRootCache = root;
  return root;
}
function getRuntimeDir() {
  return path.join(getRuntimeCacheRoot(), "ocr-runtime");
}
const REQUIRED_RUNTIME_FILES = [
  "index.js",
  "wcocr_native.node",
  "vendor/wechat-ocr-mac/lib/libwxocr.dylib",
  "vendor/wechat-ocr-mac/lib/libmmmojo.dylib",
  "vendor/wechat-ocr-mac/models/text_det_fp16_v1.xnet",
  "vendor/wechat-ocr-mac/models/text_rec_fp16_v2.xnet",
  "vendor/wechat-ocr-mac/models/charset_zh10798.txt"
];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);
// 微信 OCR 仅支持 macOS：下载 @ztools-center/wechat-ocr-native 运行时（仅 mac 构建）。
// Windows 平台提供 引擎：Windows OCR（系统 WinRT）+ ONNX OCR（PP-OCR v4），均零依赖。
const IS_MAC = process.platform === "darwin";
const WECHAT_RUNTIME_UNSUPPORTED_MESSAGE = "微信 OCR 运行时包仅提供 macOS 构建";


let runtimeInstallPromise = null;
let ocrModule = null;
let ocrModulePath = "";

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress(payload);
  } catch (_) {
    // Ignore renderer callback failures.
  }
}

function getResponse(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "ZTools-Native-OCR/0.1.0",
        Accept: "application/json, application/octet-stream"
      }
    }, (res) => {
      const statusCode = res.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectCount >= 5) {
          reject(new Error("下载地址重定向次数过多"));
          return;
        }
        resolve(getResponse(new URL(res.headers.location, url).toString(), redirectCount + 1));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`请求失败: HTTP ${statusCode}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error("网络请求超时")));
    req.on("error", reject);
  });
}

async function fetchJson(url) {
  const res = await getResponse(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function downloadFile(url, destination, version, onProgress) {
  const res = await getResponse(url);
  const total = Number(res.headers["content-length"] || 0);
  let downloaded = 0;
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    res.on("data", (chunk) => {
      downloaded += chunk.length;
      emitProgress(onProgress, {
        phase: "download",
        version,
        downloaded,
        total,
        percent: total ? Math.round((downloaded / total) * 100) : 0
      });
    });
    res.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    res.pipe(output);
  });
}

async function fetchLatestRuntime() {
  const metadata = await fetchJson(RUNTIME_REGISTRY_URL);
  const version = metadata && metadata["dist-tags"] && metadata["dist-tags"].latest;
  const latest = version && metadata.versions && metadata.versions[version];
  const tarball = latest && latest.dist && latest.dist.tarball;
  if (!version || !tarball) {
    throw new Error("无法解析 OCR 运行时最新版本");
  }
  return {
    version,
    tarball,
    shasum: latest.dist.shasum || "",
    unpackedSize: latest.dist.unpackedSize || 0
  };
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function isSafeRelativePath(relativePath) {
  return Boolean(relativePath)
    && !path.isAbsolute(relativePath)
    && !relativePath.split(/[\\/]+/).includes("..");
}

function parseTarString(buffer, start, length) {
  const raw = buffer.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function parseTarOctal(buffer, start, length) {
  const value = parseTarString(buffer, start, length).trim();
  return value ? parseInt(value, 8) : 0;
}

function extractRuntimeDist(tgzPath, destination, onProgress) {
  emitProgress(onProgress, { phase: "extract", percent: 0 });
  const tarBuffer = zlib.gunzipSync(fs.readFileSync(tgzPath));
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const name = parseTarString(tarBuffer, offset, 100);
    if (!name) break;
    const prefix = parseTarString(tarBuffer, offset + 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const mode = parseTarOctal(tarBuffer, offset + 100, 8);
    const size = parseTarOctal(tarBuffer, offset + 124, 12);
    const type = parseTarString(tarBuffer, offset + 156, 1) || "0";
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;

    if (entryName.startsWith(RUNTIME_DIST_PREFIX)) {
      const relativePath = entryName.slice(RUNTIME_DIST_PREFIX.length);
      if (isSafeRelativePath(relativePath)) {
        const target = path.join(destination, relativePath);
        if (type === "5") {
          fs.mkdirSync(target, { recursive: true });
        } else if (type === "0") {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, tarBuffer.subarray(bodyStart, bodyEnd));
          if (mode) {
            try {
              fs.chmodSync(target, mode);
            } catch (_) {
              // Ignore chmod failures on filesystems that do not support it.
            }
          }
        }
      }
    }

    offset = bodyStart + Math.ceil(size / 512) * 512;
    emitProgress(onProgress, {
      phase: "extract",
      percent: Math.min(100, Math.round((offset / tarBuffer.length) * 100))
    });
  }
}

function getLocalRuntimeInfo(runtimeDir = getRuntimeDir()) {
  const missing = REQUIRED_RUNTIME_FILES.filter((file) => !fs.existsSync(path.join(runtimeDir, file)));
  const meta = readJsonFile(path.join(runtimeDir, ".ztools-runtime.json"));
  const runtimePackage = readJsonFile(path.join(runtimeDir, "package.json"));
  return {
    installed: missing.length === 0,
    version: (meta && meta.version) || (runtimePackage && runtimePackage.version) || "",
    path: runtimeDir,
    missing
  };
}

function validateRuntimeDir(runtimeDir) {
  const info = getLocalRuntimeInfo(runtimeDir);
  if (!info.installed) {
    throw new Error(`OCR 运行时文件不完整: ${info.missing.join(", ")}`);
  }
}

function clearOcrRequireCache() {
  const runtimePrefix = getRuntimeDir() + path.sep;
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath === ocrModulePath || cachedPath.startsWith(runtimePrefix)) {
      try {
        delete require.cache[cachedPath];
      } catch (_) {
        // Ignore cache cleanup failures.
      }
    }
  }
  ocrModule = null;
  ocrModulePath = "";
}

async function checkRuntime() {
  if (!IS_MAC) {
    return {
      status: "native",
      ready: true,
      version: "win-local",
      latestVersion: "",
      path: "",
      message: "Windows 使用本地微信 OCR 组件，无需下载运行时"
    };
  }
  const local = getLocalRuntimeInfo();
  try {
    const latest = await fetchLatestRuntime();
    if (local.installed && local.version === latest.version) {
      return {
        status: "ready",
        ready: true,
        version: local.version,
        latestVersion: latest.version,
        path: local.path
      };
    }
    return {
      status: local.installed ? "outdated" : "missing",
      ready: false,
      version: local.version,
      latestVersion: latest.version,
      path: local.path,
      tarball: latest.tarball,
      message: local.installed ? "发现 OCR 运行时新版本" : "需要下载 OCR 运行时"
    };
  } catch (error) {
    if (local.installed) {
      return {
        status: "ready",
        ready: true,
        version: local.version,
        latestVersion: "",
        path: local.path,
        offline: true,
        message: "无法检查最新版本，已使用本地 OCR 运行时"
      };
    }
    return {
      status: "error",
      ready: false,
      version: "",
      latestVersion: "",
      path: local.path,
      message: error && error.message ? error.message : "无法检查 OCR 运行时"
    };
  }
}

async function installRuntime(onProgress) {
  if (!IS_MAC) {
    throw new Error(WECHAT_RUNTIME_UNSUPPORTED_MESSAGE);
  }
  if (runtimeInstallPromise) return runtimeInstallPromise;
  runtimeInstallPromise = (async () => {
    fs.mkdirSync(getRuntimeCacheRoot(), { recursive: true });
    emitProgress(onProgress, { phase: "metadata", percent: 0 });
    const latest = await fetchLatestRuntime();
    const current = getLocalRuntimeInfo();
    if (current.installed && current.version === latest.version) {
      return checkRuntime();
    }

    const tmpTgz = path.join(getRuntimeCacheRoot(), `native-ocr-runtime-${latest.version}-${Date.now()}.tgz`);
    const tmpRuntimeDir = path.join(getRuntimeCacheRoot(), `.ocr-runtime-${process.pid}-${Date.now()}`);
    const backupDir = path.join(getRuntimeCacheRoot(), `.ocr-runtime-backup-${Date.now()}`);
    try {
      await downloadFile(latest.tarball, tmpTgz, latest.version, onProgress);
      if (latest.shasum) {
        const shasum = crypto.createHash("sha1").update(fs.readFileSync(tmpTgz)).digest("hex");
        if (shasum !== latest.shasum) {
          throw new Error("OCR 运行时下载校验失败");
        }
      }
      fs.rmSync(tmpRuntimeDir, { recursive: true, force: true });
      fs.mkdirSync(tmpRuntimeDir, { recursive: true });
      extractRuntimeDist(tmpTgz, tmpRuntimeDir, onProgress);
      validateRuntimeDir(tmpRuntimeDir);
      fs.writeFileSync(path.join(tmpRuntimeDir, ".ztools-runtime.json"), JSON.stringify({
        version: latest.version,
        tarball: latest.tarball,
        installedAt: new Date().toISOString()
      }, null, 2));

      clearOcrRequireCache();
      if (fs.existsSync(getRuntimeDir())) {
        fs.renameSync(getRuntimeDir(), backupDir);
      }
      fs.renameSync(tmpRuntimeDir, getRuntimeDir());
      fs.rmSync(backupDir, { recursive: true, force: true });
      emitProgress(onProgress, { phase: "done", version: latest.version, percent: 100 });
      return checkRuntime();
    } catch (error) {
      if (fs.existsSync(backupDir) && !fs.existsSync(getRuntimeDir())) {
        try {
          fs.renameSync(backupDir, getRuntimeDir());
        } catch (_) {
          // Keep the original error.
        }
      }
      throw error;
    } finally {
      fs.rmSync(tmpTgz, { force: true });
      fs.rmSync(tmpRuntimeDir, { recursive: true, force: true });
      fs.rmSync(backupDir, { recursive: true, force: true });
      runtimeInstallPromise = null;
    }
  })();
  return runtimeInstallPromise;
}

function loadOcrRuntime() {
  if (!IS_MAC) {
    throw new Error(WECHAT_RUNTIME_UNSUPPORTED_MESSAGE);
  }
  const local = getLocalRuntimeInfo();
  if (!local.installed) {
    throw new Error("OCR 运行时未下载，请先下载后再识别");
  }
  const entry = path.join(getRuntimeDir(), "index.js");
  if (!ocrModule || ocrModulePath !== entry) {
    ocrModulePath = entry;
    ocrModule = require(entry);
  }
  return ocrModule;
}

function assertImagePath(imagePath) {
  if (!imagePath || typeof imagePath !== "string") {
    throw new Error("图片路径不能为空");
  }
  const resolved = path.resolve(imagePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`图片不存在: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的图片格式: ${ext || "unknown"}`);
  }
  if (fs.statSync(resolved).size > MAX_IMAGE_BYTES) {
    throw new Error("图片文件过大");
  }
  return resolved;
}

function dataUrlToTempFile(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("无效的图片数据");
  }
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("图片数据不是 base64 Data URL");
  }
  const subtype = match[1].toLowerCase();
  const ext = subtype === "jpeg" ? ".jpg" : `.${subtype}`;
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的图片格式: ${ext}`);
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("图片数据为空或过大");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ztools-native-ocr-"));
  const file = path.join(dir, `image${ext}`);
  fs.writeFileSync(file, buffer);
  return file;
}

function normalizeResult(result) {
  const text = result && typeof result.text === "string" ? result.text : "";
  return {
    engine: result && result.engine ? result.engine : "wechat-wevision",
    text,
    lines: Array.isArray(result && result.lines) ? result.lines : text ? [{ text }] : [],
    raw: result
  };
}

function firstExistingImage(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return value;
    if (fs.existsSync(value)) return value;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = firstExistingImage(item);
      if (image) return image;
    }
    return "";
  }
  if (typeof value === "object") {
    const candidates = [
      value.path,
      value.filePath,
      value.img,
      value.image,
      value.src,
      value.url,
      value.data,
      value.pastedImage,
      value.payload,
      value.files,
      value.items
    ];
    for (const item of candidates) {
      const image = firstExistingImage(item);
      if (image) return image;
    }
  }
  return "";
}

function getImageFromAction(action) {
  if (!action) return "";
  return firstExistingImage([
    action.payload,
    action.inputState && action.inputState.pastedImage,
    action.inputState && action.inputState.files,
    action
  ]);
}

function publishImage(image) {
  if (!image) return;
  window.__NATIVE_OCR_PENDING_IMAGE__ = image;
  try {
    window.ztools.dbStorage.setItem(OCR_IMAGE_STORAGE_KEY, image);
  } catch (_) {
    // Ignore unavailable storage.
  }
  const dispatch = () => {
    window.dispatchEvent(new CustomEvent(OCR_IMAGE_EVENT, { detail: { source: image } }));
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", dispatch, { once: true });
  } else {
    setTimeout(dispatch, 0);
  }
}

async function recognize(source) {
  let tempFile = "";
  try {
    const ocr = loadOcrRuntime();
    const imagePath = typeof source === "string" && source.startsWith("data:image/")
      ? (tempFile = dataUrlToTempFile(source))
      : assertImagePath(source);
    return normalizeResult(ocr.ocr(imagePath));
  } finally {
    if (tempFile) {
      try {
        fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
      } catch (_) {
        // Ignore temp cleanup failures.
      }
    }
  }
}

const cachedRuntimeScripts = {};

function ensureRuntimeScript(scriptPath, targetName) {
  const cached = cachedRuntimeScripts[targetName];
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  const content = fs.readFileSync(scriptPath, "utf8");
  const scriptsDir = path.join(getRuntimeCacheRoot(), "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const target = path.join(scriptsDir, targetName);
  fs.writeFileSync(target, content);
  cachedRuntimeScripts[targetName] = target;
  return target;
}

function ensureVisionScript(scriptPath) {
  return ensureRuntimeScript(scriptPath, "ztools-native-ocr-vision.swift");
}

let cachedVisionBinary = "";

function ensureVisionBinary(scriptPath) {
  if (cachedVisionBinary && fs.existsSync(cachedVisionBinary)) {
    return cachedVisionBinary;
  }
  const scriptReal = ensureVisionScript(scriptPath);
  const target = `${scriptReal.replace(/\.swift$/, "")}-bin`;
  const result = spawnSync("swiftc", ["-O", scriptReal, "-o", target], { timeout: 180000 });
  if (result.status === 0 && fs.existsSync(target)) {
    cachedVisionBinary = target;
    return target;
  }
  return "";
}

function runVisionScript(scriptPath, imagePath) {
  return new Promise((resolve, reject) => {
    let cmd = "swift";
    let args = [ensureVisionScript(scriptPath), imagePath];
    try {
      const binary = ensureVisionBinary(scriptPath);
      if (binary) {
        cmd = binary;
        args = [imagePath];
      }
    } catch (_) {
      // Fall back to the swift interpreter.
    }
    execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message || "Vision 识别失败"));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function runWinRtOcrScript(scriptPath, imagePath) {
  const scriptReal = ensureRuntimeScript(scriptPath, "ztools-native-ocr-winrt.ps1");
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptReal, "-ImagePath", imagePath
    ], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || err.message || "Windows OCR 识别失败")));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function parseWinRtOutput(raw) {
  const output = String(raw || "").trim();
  if (!output) {
    return { engine: "vision", text: "", lines: [] };
  }
  const parsed = JSON.parse(output);
  const lines = [];
  for (const item of (parsed && parsed.lines) || []) {
    if (!item || typeof item.text !== "string") continue;
    const line = { text: item.text };
    const box = item.box;
    if (box && Number.isFinite(Number(box.x))) {
      line.box = { x: Number(box.x), y: Number(box.y), w: Number(box.w), h: Number(box.h) };
    }
    lines.push(line);
  }
  return { engine: "vision", text: lines.map((line) => line.text).join("\n"), lines };
}

async function recognizeWinRtOcr(source) {
  let tempFile = "";
  try {
    const imagePath = typeof source === "string" && source.startsWith("data:image/")
      ? (tempFile = dataUrlToTempFile(source))
      : assertImagePath(source);
    const scriptPath = path.join(__dirname, "bin", "ocr-winrt.ps1");
    const stdout = await runWinRtOcrScript(scriptPath, imagePath);
    return parseWinRtOutput(stdout);
  } finally {
    if (tempFile) {
      try {
        fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
      } catch (_) {
        // Ignore temp cleanup failures.
      }
    }
  }
}

function parseVisionOutput(raw, engineName = "vision") {  const output = String(raw || "").trim();
  if (!output) {
    return { engine: engineName, text: "", lines: [] };
  }
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed.error === "string") {
      throw new Error(parsed.error);
    }
    const items = Array.isArray(parsed) ? parsed : null;
    if (items) {
      const lines = [];
      for (const item of items) {
        if (!item || typeof item.text !== "string") continue;
        const line = { text: item.text };
        const box = item.box;
        if (box && typeof box === "object") {
          const x = Number(box.x);
          const y = Number(box.y);
          const w = Number(box.w);
          const h = Number(box.h);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)) {
            line.box = { x, y, w, h };
          }
        }
        const score = Number(item.score);
        if (Number.isFinite(score)) {
          line.score = score;
        }
        lines.push(line);
      }
      const text = lines.map((line) => line.text).join("\n");
      return { engine: engineName, text, lines };
    }
  } catch (error) {
    if (error instanceof Error && error.message && !/JSON/i.test(error.message)) {
      throw error;
    }
    // Fall through to plain-text parsing below.
  }
  const lines = output.split("\n").filter(Boolean).map((line) => ({ text: line }));
  return {
    engine: engineName,
    text: lines.map((line) => line.text).join("\n"),
    lines
  };
}

async function recognizeVision(source) {
  if (process.platform === "win32") {
    return recognizeWinRtOcr(source);
  }
  if (process.platform !== "darwin") {
    throw new Error("系统 OCR 仅支持 macOS / Windows");
  }
  let tempFile = "";
  try {
    const imagePath = typeof source === "string" && source.startsWith("data:image/")
      ? (tempFile = dataUrlToTempFile(source))
      : assertImagePath(source);
    const scriptPath = path.join(__dirname, "bin", "ocr-vision.swift");
    const stdout = await runVisionScript(scriptPath, imagePath);
    return parseVisionOutput(stdout);
  } finally {
    if (tempFile) {
      try {
        fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
      } catch (_) {
        // Ignore temp cleanup failures.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 翻译引擎（腾讯交互翻译 transmart，免密钥、国内直连、auto 源语言检测）
// ---------------------------------------------------------------------------

const TRANSLATE_API_URL = "https://transmart.qq.com/api/imt";
const TRANSLATE_CLIENT_KEY = "browser-chromium-Win32-120.0.0.0-204747517";
const TRANSLATE_MAX_CHUNK = 4500;

function httpsRequestJson(url, { method = "POST", body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ZTools-Native-OCR/0.4.0"
      }
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`翻译请求失败: HTTP ${statusCode}`));
          return;
        }
        resolve(text);
      });
    });
    request.setTimeout(timeout, () => request.destroy(new Error("翻译请求超时")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function chunkText(text) {
  const source = String(text || "");
  if (source.length <= TRANSLATE_MAX_CHUNK) {
    return [source];
  }
  const chunks = [];
  const lines = source.split("\n");
  let current = "";
  for (const line of lines) {
    if ((current + line).length > TRANSLATE_MAX_CHUNK && current) {
      chunks.push(current);
      current = "";
    }
    current += `${line}\n`;
  }
  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [source];
}

async function translateText(text, toLang) {
  const chunks = chunkText(text);
  const results = [];
  for (const chunk of chunks) {
    const payload = JSON.stringify({
      header: {
        fn: "auto_translation",
        session: "",
        client_key: TRANSLATE_CLIENT_KEY
      },
      type: "plain",
      model_category: "normal",
      text_domain: "general",
      source: { type: "1", lang: "auto", text_list: [chunk] },
      target: { type: "2", lang: toLang }
    });
    const raw = await httpsRequestJson(TRANSLATE_API_URL, { body: payload, timeout: 45000 });
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error("翻译响应解析失败");
    }
    if (!data || data.header?.ret_code !== "succ" || !Array.isArray(data.auto_translation)) {
      throw new Error((data && data.message) || "翻译服务返回异常");
    }
    results.push(data.auto_translation.join("\n"));
  }
  return { text: results.join("") };
}

const TRANSLATE_SEGMENTS_PER_REQUEST = 40;

async function translateSegments(segments, toLang) {
  const list = Array.isArray(segments) ? segments.map((item) => String(item || "")) : [];
  const translated = new Array(list.length).fill("");
  for (let start = 0; start < list.length; start += TRANSLATE_SEGMENTS_PER_REQUEST) {
    const slice = list.slice(start, start + TRANSLATE_SEGMENTS_PER_REQUEST);
    const payload = JSON.stringify({
      header: {
        fn: "auto_translation",
        session: "",
        client_key: TRANSLATE_CLIENT_KEY
      },
      type: "plain",
      model_category: "normal",
      text_domain: "general",
      source: { type: "1", lang: "auto", text_list: slice },
      target: { type: "2", lang: toLang }
    });
    const raw = await httpsRequestJson(TRANSLATE_API_URL, { body: payload, timeout: 60000 });
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error("翻译响应解析失败");
    }
    if (!data || data.header?.ret_code !== "succ" || !Array.isArray(data.auto_translation)) {
      throw new Error((data && data.message) || "翻译服务返回异常");
    }
    for (let i = 0; i < slice.length; i += 1) {
      translated[start + i] = String(data.auto_translation[i] ?? "");
    }
  }
  return translated;
}

function isVisionAvailable() {
  if (process.platform === "win32") {
    // Windows 系统 OCR 走内置 PowerShell + WinRT，Windows 10+ 必有。
    try {
      const probe = spawnSync("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { timeout: 15000 });
      return probe.status === 0;
    } catch (_) {
      return false;
    }
  }
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    const result = spawnSync("which", ["swift"], { encoding: "utf8", timeout: 5000 });
    return result.status === 0
      && typeof result.stdout === "string"
      && result.stdout.trim() !== "";
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Python 探测（仅供 Windows 微信 OCR 过渡链路使用；ONNX OCR / Vision 均无 Python）
// ---------------------------------------------------------------------------

function pythonCandidates() {
  if (process.platform === "win32") {
    return ["python", "python3", "py"];
  }
  // GUI 应用不继承 shell 的 PATH，需补充常见绝对路径
  return [
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
    "python3",
    "python"
  ];
}

// ---------------------------------------------------------------------------
// ONNX OCR（RapidOCR 引擎的去 Python 形态，三端通用）
// 运行时包 = npmmirror 上的公开 tarball，下载解压为平铺 node_modules + 模型
// ---------------------------------------------------------------------------

const ONNX_RUNTIME_VERSION = 1;
function getOnnxRuntimeDir() {
  return path.join(getRuntimeCacheRoot(), "onnx-runtime");
}
const ONNX_PACKAGES = [
  { name: "onnxruntime-node", version: "1.17.3-rev.1", shasum: "4ca954232525074915a1f80e84d9933b829dd34c", trimPlatformBin: true },
  { name: "onnxruntime-common", version: "1.17.3", shasum: "aadc456477873a540ee3d611ae9cd4f3de7c43e5" },
  { name: "@gutenye/ocr-common", version: "1.4.8", shasum: "81ff93715896ebe45ab4c84a620d74ce58fa19e0" },
  { name: "@techstark/opencv-js", version: "4.9.0-release.3", shasum: "efcf5b33611a05f3f3eb5b180e6582a064f4b5d1" },
  { name: "js-clipper", version: "1.0.1", shasum: "4d6b07434a4408e7c129e32201ce66d21474ed21" },
  { name: "tiny-invariant", version: "1.3.3", shasum: "46680b7a873a0d5d10005995eb90a70d74d60127" },
  { name: "pngjs", version: "7.0.0", shasum: "a8b7446020ebbc6ac739db6c5415a65d17090e26" },
  { name: "jpeg-js", version: "0.4.4", shasum: "a9f1c6f1f9f0fa80cdb3484ed9635054d28936aa" },
  { name: "@gutenye/ocr-models", version: "1.4.2", shasum: "06c61c34dcda863a0babe9b033721613b87457c8", assetsOnly: true }
];
const ONNX_ASSETS = ["ch_PP-OCRv4_det_infer.onnx", "ch_PP-OCRv4_rec_infer.onnx", "ppocr_keys_v1.txt"];
const ONNX_REGISTRY_BASE = "https://registry.npmmirror.com";

function onnxModelsPaths() {
  return {
    detectionPath: path.join(getOnnxRuntimeDir(), "assets", "ch_PP-OCRv4_det_infer.onnx"),
    recognitionPath: path.join(getOnnxRuntimeDir(), "assets", "ch_PP-OCRv4_rec_infer.onnx"),
    dictionaryPath: path.join(getOnnxRuntimeDir(), "assets", "ppocr_keys_v1.txt")
  };
}

function checkOnnxRuntime() {
  const meta = readJsonFile(path.join(getOnnxRuntimeDir(), ".native-ocr-onnx.json"));
  const installed = Boolean(
    meta && meta.version === ONNX_RUNTIME_VERSION
    && fs.existsSync(path.join(getOnnxRuntimeDir(), "node_modules", "@gutenye", "ocr-common", "package.json"))
    && fs.existsSync(path.join(getOnnxRuntimeDir(), "onnx_ocr_server.mjs"))
    && ONNX_ASSETS.every((file) => fs.existsSync(path.join(getOnnxRuntimeDir(), "assets", file)))
  );
  return {
    installed,
    ready: installed,
    version: (meta && meta.version) || "",
    latestVersion: ONNX_RUNTIME_VERSION,
    path: getOnnxRuntimeDir(),
    models: onnxModelsPaths()
  };
}

function isOnnxOcrAvailable() {
  return checkOnnxRuntime().ready;
}

function extractTarBuffer(tarBuffer, destination, { entryFilter, mapPath } = {}) {
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const name = parseTarString(tarBuffer, offset, 100);
    if (!name) break;
    const prefix = parseTarString(tarBuffer, offset + 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const mode = parseTarOctal(tarBuffer, offset + 100, 8);
    const size = parseTarOctal(tarBuffer, offset + 124, 12);
    const type = parseTarString(tarBuffer, offset + 156, 1) || "0";
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    const rel = entryName.startsWith("package/") ? entryName.slice("package/".length) : entryName;
    if (rel && type === "0" && !rel.endsWith("/") && (!entryFilter || entryFilter(rel))) {
      const mapped = mapPath ? mapPath(rel) : rel;
      if (mapped && isSafeRelativePath(mapped)) {
        const target = path.join(destination, mapped);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, tarBuffer.subarray(bodyStart, bodyEnd));
        if (mode) {
          try {
            fs.chmodSync(target, mode);
          } catch (_) {
            // Ignore chmod failures on filesystems that do not support it.
          }
        }
      }
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
}

let onnxInstallPromise = null;

async function installOnnxRuntime(onProgress) {
  if (onnxInstallPromise) return onnxInstallPromise;
  onnxInstallPromise = (async () => {
    fs.mkdirSync(getOnnxRuntimeDir(), { recursive: true });
    const doneBytes = { value: 0 };
    for (let index = 0; index < ONNX_PACKAGES.length; index += 1) {
      const pkg = ONNX_PACKAGES[index];
      emitProgress(onProgress, {
        phase: "download",
        message: `获取 ${pkg.name}`,
        percent: Math.round((index / ONNX_PACKAGES.length) * 100)
      });
      const metadata = await fetchJson(`${ONNX_REGISTRY_BASE}/${pkg.name}/${pkg.version}`);
      const tarball = metadata && metadata.dist && metadata.dist.tarball;
      if (!tarball) {
        throw new Error(`无法解析 ${pkg.name} 的下载地址`);
      }
      const tmpTgz = path.join(getRuntimeCacheRoot(), `onnx-${pkg.name.replace(/[^\w.-]/g, "_")}-${pkg.version}.tgz`);
      const previousTotal = doneBytes.value;
      await downloadFile(tarball, tmpTgz, pkg.name, (progress) => {
        if (progress.total) {
          doneBytes.value = previousTotal + (progress.downloaded || 0);
          emitProgress(onProgress, {
            phase: "download",
            message: `下载 ${pkg.name}`,
            percent: Math.round(((index + (progress.downloaded || 0) / progress.total) / ONNX_PACKAGES.length) * 100)
          });
        }
      });
      const shasum = crypto.createHash("sha1").update(fs.readFileSync(tmpTgz)).digest("hex");
      if (metadata.dist && metadata.dist.shasum && shasum !== metadata.dist.shasum) {
        fs.rmSync(tmpTgz, { force: true });
        throw new Error(`${pkg.name} 下载校验失败`);
      }
      if (pkg.shasum && shasum !== pkg.shasum) {
        fs.rmSync(tmpTgz, { force: true });
        throw new Error(`${pkg.name} 版本与清单不一致（sha1 校验失败），请更新插件`);
      }
      emitProgress(onProgress, { phase: "extract", message: `解包 ${pkg.name}`, percent: Math.round(((index + 0.5) / ONNX_PACKAGES.length) * 100) });
      const tarBuffer = zlib.gunzipSync(fs.readFileSync(tmpTgz));
      if (pkg.assetsOnly) {
        for (const asset of ONNX_ASSETS) {
          extractTarBuffer(tarBuffer, getOnnxRuntimeDir(), {
            entryFilter: (rel) => rel === `assets/${asset}`,
            mapPath: (rel) => `assets/${path.basename(rel)}`
          });
        }
      } else {
        const platformBinPrefix = `bin/napi-v3/${process.platform}/${process.arch}`;
        extractTarBuffer(tarBuffer, path.join(getOnnxRuntimeDir(), "node_modules", pkg.name), {
          entryFilter: pkg.trimPlatformBin
            ? (rel) => !rel.startsWith("bin/") || rel.startsWith(platformBinPrefix)
            : undefined
        });
      }
      fs.rmSync(tmpTgz, { force: true });
    }
    fs.copyFileSync(
      path.join(__dirname, "bin", "onnx_ocr_backend.mjs"),
      path.join(getOnnxRuntimeDir(), "onnx_ocr_backend.mjs")
    );
    fs.copyFileSync(
      path.join(__dirname, "bin", "onnx_ocr_server.mjs"),
      path.join(getOnnxRuntimeDir(), "onnx_ocr_server.mjs")
    );
    fs.writeFileSync(path.join(getOnnxRuntimeDir(), ".native-ocr-onnx.json"), JSON.stringify({
      version: ONNX_RUNTIME_VERSION,
      installedAt: new Date().toISOString()
    }, null, 2));
    emitProgress(onProgress, { phase: "done", percent: 100 });
    return checkOnnxRuntime();
  })();
  try {
    return await onnxInstallPromise;
  } finally {
    onnxInstallPromise = null;
  }
}

let onnxServerState = null;

function killOnnxServer() {
  if (onnxServerState) {
    try {
      onnxServerState.proc.kill();
    } catch (_) {
      // Ignore kill failures.
    }
    onnxServerState = null;
  }
}

// ONNX 依赖 ESM 原生模块，渲染进程 preload 的动态 import() 走浏览器解析
// （报 process is not defined），因此放在 Electron 自带 Node 的子进程里跑：
// process.execPath + ELECTRON_RUN_AS_NODE=1，无需系统安装 Node。
function ensureOnnxServer() {
  if (onnxServerState && onnxServerState.proc.exitCode === null) {
    return onnxServerState;
  }
  const scriptPath = path.join(getOnnxRuntimeDir(), "onnx_ocr_server.mjs");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("ONNX OCR 服务脚本缺失，请重新下载引擎");
  }
  // 启动前同步最新服务脚本：识别逻辑修复不依赖模型重下载
  try {
    for (const name of ["onnx_ocr_server.mjs", "onnx_ocr_backend.mjs", "onnx_table_split.mjs"]) {
      const src = path.join(__dirname, "bin", name);
      const dst = path.join(getOnnxRuntimeDir(), name);
      if (!fs.existsSync(src)) continue;
      if (!fs.existsSync(dst) || fs.readFileSync(src, "utf8") !== fs.readFileSync(dst, "utf8")) {
        fs.copyFileSync(src, dst);
      }
    }
  } catch (_) {
    // 同步失败沿用已安装脚本
  }
  const proc = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    }
  });
  const state = {
    proc,
    pending: new Map(),
    nextId: 1,
    ready: false,
    stdoutBuffer: "",
    stderrTail: ""
  };
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    state.stdoutBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = state.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = state.stdoutBuffer.slice(0, newlineIndex).trim();
      state.stdoutBuffer = state.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (message && message.event === "ready") {
        state.ready = true;
        continue;
      }
      if (message && message.event === "fatal") {
        state.fatalError = message.error || "ONNX OCR 服务启动失败";
        continue;
      }
      if (message && state.pending.has(message.id)) {
        const entry = state.pending.get(message.id);
        state.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message);
        else entry.reject(new Error(message.error || "ONNX OCR 识别失败"));
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    state.stderrTail = (state.stderrTail + chunk).slice(-800);
  });
  const failAll = (error) => {
    for (const entry of state.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    state.pending.clear();
    if (onnxServerState === state) {
      onnxServerState = null;
    }
  };
  proc.on("exit", () => failAll(new Error(state.fatalError || "ONNX OCR 服务进程已退出")));
  proc.on("error", (error) => failAll(error));
  onnxServerState = state;
  return state;
}

function waitOnnxServerReady(state, timeoutMs = 90000) {
  if (state.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (state.ready) {
        resolve();
        return;
      }
      if (state.proc.exitCode !== null) {
        reject(new Error(state.fatalError || "ONNX OCR 服务进程启动失败"));
        return;
      }
      if (state.fatalError) {
        reject(new Error(state.fatalError));
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("ONNX OCR 服务启动超时"));
        return;
      }
      setTimeout(poll, 120);
    };
    poll();
  });
}

function onnxServerRecognize(state, imagePath, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = state.nextId;
    state.nextId += 1;
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error("ONNX OCR 识别超时"));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer });
    state.proc.stdin.write(`${JSON.stringify({ id, imagePath })}\n`);
  });
}

async function recognizeOnnxOcr(source) {
  const check = checkOnnxRuntime();
  if (!check.ready) {
    throw new Error("ONNX OCR 引擎未下载，请先下载引擎");
  }
  let tempFile = "";
  try {
    const imagePath = typeof source === "string" && source.startsWith("data:image/")
      ? (tempFile = dataUrlToTempFile(source))
      : assertImagePath(source);
    const state = ensureOnnxServer();
    await waitOnnxServerReady(state);
    const message = await onnxServerRecognize(state, imagePath);
    const width = Number(message.width) || 1;
    const height = Number(message.height) || 1;
    const items = Array.isArray(message.items) ? message.items : [];
    return {
      engine: "rapidocr",
      text: items.map((item) => item.text).join("\n"),
      lines: items.map((item) => {
        const polygon = Array.isArray(item.box) ? item.box : [];
        if (!polygon.length) {
          return { text: item.text };
        }
        const xs = polygon.map((point) => point[0]);
        const ys = polygon.map((point) => point[1]);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        return {
          text: item.text,
          box: {
            x: left / width,
            y: 1 - bottom / height,
            w: (right - left) / width,
            h: (bottom - top) / height
          }
        };
      }),
      raw: message
    };
  } finally {
    if (tempFile) {
      try {
        fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
      } catch (_) {
        // Ignore temp cleanup failures.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 微信 OCR（Windows）：纯 Python 调用微信 PC 自带 OCR（社区 wechat-ocr 包）
// 依赖：Windows + Python + pip install wechat-ocr + 微信 PC 3.9.x
// 协议与 rapid_ocr_server 完全一致（JSON-line stdin/stdout）
// ---------------------------------------------------------------------------

window.nativeOcr = {
  checkRuntime,
  installRuntime,
  recognize,
  recognizeVision,
  isVisionAvailable,
  recognizeOnnxOcr,
  isOnnxOcrAvailable,
  installOnnxRuntime,
  getPlatform() {
    return process.platform;
  },
  translateText,
  translateSegments,
  getImageFromAction,
  readImageDataUrl(imagePath) {
    const resolved = assertImagePath(imagePath);
    const ext = path.extname(resolved).toLowerCase();
    const mimeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".tif": "image/tiff",
      ".tiff": "image/tiff"
    };
    return `data:${mimeMap[ext] || "application/octet-stream"};base64,${fs.readFileSync(resolved).toString("base64")}`;
  },
  copyText(text) {
    clipboard.writeText(String(text || ""));
    return true;
  }
};

try {
  if (window.ztools && window.ztools.onPluginEnter) {
    window.ztools.onPluginEnter((action) => {
      const image = getImageFromAction(action);
      if (image) publishImage(image);
    });
  }
} catch (_) {
  // Ignore host API failures.
}
