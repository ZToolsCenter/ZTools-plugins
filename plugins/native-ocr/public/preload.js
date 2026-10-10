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
// 插件卸载时由 ZTools 自动清理；拿不到该目录时才退回下面的传统缓存位置 —— 那是
// ZTools 托管目录之外的路径，卸载时不会被清理，因此只作最后兜底：一旦托管目录
// 可用就把旧数据搬过去（迁移逻辑见 getRuntimeCacheRoot），另提供 clearModelCache()
// 供用户手动回收 ONNX 模型。
const LEGACY_CACHE_ROOT = path.join(os.homedir(), "Library", "Application Support", "ZTools", "native-ocr"); // macOS
const LEGACY_WIN_CACHE_ROOT = process.env.APPDATA ? path.join(process.env.APPDATA, "ZTools", "native-ocr") : ""; // Windows

function legacyCacheRoot() {
  if (process.platform === "win32" && LEGACY_WIN_CACHE_ROOT) return LEGACY_WIN_CACHE_ROOT;
  return LEGACY_CACHE_ROOT;
}

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
  const legacyRoot = legacyCacheRoot();
  if (!root) root = legacyRoot;
  try {
    // 历史版本可能把运行时写进了回退目录（mac / win 各一套路径），此前只有 mac 做了迁移。
    // 托管目录可用时搬过去：既避免已下载的运行时重复下载，也消除卸载后的残留。
    if (root !== legacyRoot && fs.existsSync(legacyRoot) && !fs.existsSync(root)) {
      fs.mkdirSync(path.dirname(root), { recursive: true });
      fs.renameSync(legacyRoot, root);
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

// 关闭写流并等待句柄真正释放（最多等 2s，避免异常路径卡住）。
// createWriteStream 的 open 是异步的：不等 'close' 就删目标文件，
// 可能删在文件被创建之前，随后半截文件才落盘（Windows 上句柄没释放还删不掉）。
function closeWriteStream(output) {
  return new Promise((resolve) => {
    if (!output || output.closed) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    output.once("close", finish);
    const timer = setTimeout(finish, 2000);
    if (typeof timer.unref === "function") timer.unref();
    try {
      output.destroy();
    } catch (_) {
      finish();
    }
  });
}

async function downloadFile(url, destination, version, onProgress) {
  const res = await getResponse(url);
  const total = Number(res.headers["content-length"] || 0);
  let downloaded = 0;
  const output = fs.createWriteStream(destination);
  try {
    await new Promise((resolve, reject) => {
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
  } catch (error) {
    // 下载失败（网络中断 / 超时）就地清理半截文件：调用方无法安全代劳 ——
    // 目标流的句柄可能还开着、文件甚至可能还没被 open 创建出来。
    await closeWriteStream(output);
    try { fs.rmSync(destination, { force: true }); } catch (_) {}
    throw error;
  }
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
  // 内容比对（与 bin/*.mjs 同步循环同款）：插件升级后运行时目录里可能残留旧脚本，
  // 若只按「文件存在」判断就会一直跑旧版本，改动静默失效。
  const content = fs.readFileSync(scriptPath, "utf8");
  const scriptsDir = path.join(getRuntimeCacheRoot(), "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const target = path.join(scriptsDir, targetName);
  let upToDate = false;
  if (fs.existsSync(target)) {
    try {
      upToDate = fs.readFileSync(target, "utf8") === content;
    } catch (_) {
      upToDate = false;
    }
  }
  if (!upToDate) {
    fs.writeFileSync(target, content);
  }
  cachedRuntimeScripts[targetName] = target;
  return target;
}

function ensureVisionScript(scriptPath) {
  return ensureRuntimeScript(scriptPath, "ztools-native-ocr-vision.swift");
}

let cachedVisionBinary = "";

function ensureVisionBinary(scriptPath) {
  const scriptReal = ensureVisionScript(scriptPath);
  // 二进制名带上脚本内容指纹：源文件改了但旧二进制仍在时，旧的会被复用导致改动静默失效
  // （曾经踩过：改了 ocr-vision.swift 却仍在跑上次编译的二进制）。
  let stamp = "";
  try {
    const content = fs.readFileSync(scriptReal);
    stamp = crypto.createHash("sha1").update(content).digest("hex").slice(0, 10);
  } catch (_) {
    stamp = "nohash";
  }
  const target = `${scriptReal.replace(/\.swift$/, "")}-${stamp}-bin`;
  if (cachedVisionBinary === target && fs.existsSync(target)) {
    return target;
  }
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
        // 逐字符框（Vision boundingBox(for:)）：图文混排用它将整行文本按公式区间切开。
        // 坐标与 line.box 同为「归一化 0..1、原点左下」，由渲染层统一换算。
        if (Array.isArray(item.chars)) {
          line.chars = item.chars.map((ch) => {
            if (!ch || typeof ch !== "object") return { c: "", box: null };
            const cb = ch.box;
            let box = null;
            if (cb && typeof cb === "object") {
              const cx = Number(cb.x);
              const cy = Number(cb.y);
              const cw = Number(cb.w);
              const chh = Number(cb.h);
              if ([cx, cy, cw, chh].every(Number.isFinite)) {
                box = { x: cx, y: cy, w: cw, h: chh };
              }
            }
            return { c: typeof ch.c === "string" ? ch.c : "", box };
          });
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

// Windows 系统 OCR 走内置 PowerShell + WinRT，无 OCR 语言包时引擎不可用。
// 只验证「powershell 能跑」会把英文版 Windows（或未装中文语言包）也判成可用，
// 实际识别中文会失败或极差，所以这里做一次真实探针，查 AvailableRecognizerLanguages。
// 探针与 PS 版本检查合并成同一次调用（避免启动时多一次 powershell 冷启动），
// 输出只用 ASCII 标签，不受中文控制台的代码页影响。
const WIN_VISION_PROBE_SCRIPT = [
  "$psv = $PSVersionTable.PSVersion.Major",
  "$probe = 'ERR'",
  "$langs = ''",
  "try {",
  "  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]",
  "  $langs = (@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) | ForEach-Object { $_.LanguageTag }) -join ','",
  "  $probe = 'OK'",
  "} catch { }",
  "Write-Output ('PSV=' + $psv + ';PROBE=' + $probe + ';LANGS=' + $langs)"
].join("\n");
const WIN_VISION_PROBE_TIMEOUT_MS = 8000;

let lastWindowsVisionProbe = null;

// 返回 { known, powershellAvailable, languages, chinese, message }。
// known=false 表示探针本身没结论（异常 / 超时 / 输出不可解析 / WinRT 查询失败），
// 调用方必须退回旧的乐观判断，绝不能因此把可用环境判成不可用。
function probeWindowsVision() {
  let probe;
  try {
    probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_VISION_PROBE_SCRIPT], {
      encoding: "utf8",
      timeout: WIN_VISION_PROBE_TIMEOUT_MS,
      windowsHide: true
    });
  } catch (_) {
    return {
      known: false,
      powershellAvailable: true,
      languages: [],
      chinese: false,
      message: "无法检测 Windows 系统 OCR，已按兼容策略视为可用"
    };
  }
  // 只有确定 powershell.exe 缺失（ENOENT）才算不可用；超时 / 被终止 / 非零退出
  // 都可能只是慢或被安全软件拦截，按旧判断乐观处理。
  const powershellAvailable = !(probe.error && probe.error.code === "ENOENT");
  const stdout = typeof probe.stdout === "string" ? probe.stdout : "";
  const versionMatch = /PSV=(\d+)/.exec(stdout);
  const probeMatch = /PROBE=([A-Z]+)/.exec(stdout);
  const langsMatch = /LANGS=([^\r\n]*)/.exec(stdout);
  if (probe.status !== 0 || !versionMatch || !probeMatch || !langsMatch || probeMatch[1] !== "OK") {
    return {
      known: false,
      powershellAvailable,
      languages: [],
      chinese: false,
      message: "未能确认 Windows 系统 OCR 语言包，已按兼容策略视为可用"
    };
  }
  const languages = langsMatch[1].split(",").map((tag) => tag.trim()).filter(Boolean);
  const chinese = languages.some((tag) => /^zh/i.test(tag));
  return {
    known: true,
    powershellAvailable: true,
    languages,
    chinese,
    message: languages.length
      ? (chinese ? "" : "Windows 系统 OCR 未安装中文识别语言包，请在「设置 > 时间和语言 > 语言」中添加中文并安装语言包")
      : "Windows 系统 OCR 引擎不可用，请安装 OCR 语言包（设置 > 时间和语言 > 语言）"
  };
}

function isVisionAvailable() {
  if (process.platform === "win32") {
    const probe = probeWindowsVision();
    lastWindowsVisionProbe = probe;
    // 探针没结论 → 退回旧的「powershell 能跑就算可用」，宁可乐观也不制造假阴性
    // （假阴性会让 UI 直接禁用系统 OCR 引擎）。
    if (!probe.known) return probe.powershellAvailable;
    // 探到 WinRT OCR 但一个识别语言都没有，说明引擎确实不可用。
    if (!probe.languages.length) return false;
    // 有 OCR 但缺中文语言包时仍返回 true（引擎可用，只是中文效果差），
    // 提示信息放在 getVisionSupportDetail() 里，不改变本函数的布尔契约。
    return true;
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

// 附件能力（不改变 isVisionAvailable 的布尔契约）：UI 想提示「需安装中文语言包」
// 时可读上一次探针细节；未探针过（非 Windows）返回 null。
function getVisionSupportDetail() {
  return lastWindowsVisionProbe ? { ...lastWindowsVisionProbe } : null;
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
// 标记内容从清单派生：改动 ONNX_PACKAGES 的版本 / sha1 / 增删包，tag 必然变化，
// 不必再靠人工同步一个常量（旧写法只比常量 ONNX_RUNTIME_VERSION，改了清单里的
// shasum 却忘了改常量时，新模型不会下载、旧模型静默残留）。
const ONNX_RUNTIME_TAG = crypto.createHash("sha1").update(JSON.stringify(ONNX_PACKAGES)).digest("hex").slice(0, 12);
const ONNX_MARKER_FILE = ".native-ocr-onnx.json";

function onnxModelsPaths() {
  return {
    detectionPath: path.join(getOnnxRuntimeDir(), "assets", "ch_PP-OCRv4_det_infer.onnx"),
    recognitionPath: path.join(getOnnxRuntimeDir(), "assets", "ch_PP-OCRv4_rec_infer.onnx"),
    dictionaryPath: path.join(getOnnxRuntimeDir(), "assets", "ppocr_keys_v1.txt")
  };
}

function onnxMarkerPath() {
  return path.join(getOnnxRuntimeDir(), ONNX_MARKER_FILE);
}

function onnxMarkerPayload(previous) {
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    version: ONNX_RUNTIME_VERSION,
    tag: ONNX_RUNTIME_TAG,
    installedAt: (previous && previous.installedAt) || new Date().toISOString()
  };
}

function writeOnnxMarker(previous) {
  fs.writeFileSync(onnxMarkerPath(), JSON.stringify(onnxMarkerPayload(previous), null, 2));
}

// 标记只证明「曾经装过」；文件被手动删除、解包不全时同样不可用，两条必须同时满足。
function onnxRuntimeFilesPresent() {
  const dir = getOnnxRuntimeDir();
  const packagesPresent = ONNX_PACKAGES
    .filter((pkg) => !pkg.assetsOnly)
    .every((pkg) => fs.existsSync(path.join(dir, "node_modules", pkg.name, "package.json")));
  return packagesPresent
    && fs.existsSync(path.join(dir, "onnx_ocr_server.mjs"))
    && ONNX_ASSETS.every((file) => fs.existsSync(path.join(dir, "assets", file)));
}

function checkOnnxRuntime() {
  const meta = readJsonFile(onnxMarkerPath());
  const filesPresent = onnxRuntimeFilesPresent();
  // 向后兼容：v1.0.0 的标记只有 { version: 1 }，没有 tag。老用户不该因为新增了 tag
  // 校验就重下 300MB —— 文件齐全说明装的正是当前清单，直接补写 tag 完成迁移。
  if (filesPresent && meta && !meta.tag && meta.version === ONNX_RUNTIME_VERSION) {
    try {
      writeOnnxMarker(meta);
    } catch (_) {
      // 迁移写入失败不影响本次判定（仍按旧 version 规则视为已安装），下次检查再试。
    }
  }
  const markerMatches = Boolean(
    meta && (meta.tag ? meta.tag === ONNX_RUNTIME_TAG : meta.version === ONNX_RUNTIME_VERSION)
  );
  const installed = Boolean(filesPresent && markerMatches);
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
      try {
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
          throw new Error(`${pkg.name} 下载校验失败`);
        }
        if (pkg.shasum && shasum !== pkg.shasum) {
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
      } finally {
        // 与微信 OCR 路径一致：下载中断（网络错误 / 30s 超时）或校验失败都不能留下半截 tgz。
        // 此处单独 try/catch，避免清理失败反过来吞掉真正的下载错误。
        try { fs.rmSync(tmpTgz, { force: true }); } catch (_) {}
      }
    }
    fs.copyFileSync(
      path.join(__dirname, "bin", "onnx_ocr_server.mjs"),
      path.join(getOnnxRuntimeDir(), "onnx_ocr_server.mjs")
    );
    writeOnnxMarker(null);
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
  // 启动前同步最新服务脚本：识别逻辑修复不依赖模型重下载。
  // 动态扫描 bin/*.mjs（避免新增模块后漏同步导致 import 失败），异常时回退静态列表。
  try {
    let scriptNames;
    try {
      scriptNames = fs.readdirSync(path.join(__dirname, "bin")).filter((n) => n.endsWith(".mjs"));
    } catch (_) {
      scriptNames = ["onnx_ocr_server.mjs", "onnx_table_split.mjs", "onnx_text_order.mjs"];
    }
    for (const name of scriptNames) {
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

function onnxServerRecognize(state, imagePath, timeoutMs = 120000, extra = null) {
  return new Promise((resolve, reject) => {
    const id = state.nextId;
    state.nextId += 1;
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error("ONNX OCR 识别超时"));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer });
    // extra 透传额外请求字段（如 op/longSide/conf/iou/textLines），现有 OCR/公式调用不传则行为不变。
    const requestBody = { id, imagePath };
    if (extra && typeof extra === "object") Object.assign(requestBody, extra);
    state.proc.stdin.write(`${JSON.stringify(requestBody)}\n`);
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
    // Bug 4：ONNX 引擎管线只支持 PNG/JPEG/BMP，WebP 解码会落到 jpeg.decode 抛通用错误。
    // 在入口给出明确错误，提示用户切换引擎或转存 PNG。
    if (path.extname(imagePath).toLowerCase() === ".webp") {
      throw new Error("ONNX 引擎暂不支持 WebP，请切换 Vision/微信引擎或转存 PNG");
    }
    // Bug 3：ONNX 子进程可能卡死且永不退出（exitCode === null 但永远不 ready）。
    // 启动/就绪失败时必须杀掉旧进程并清空 onnxServerState，否则下次 ensureOnnxServer
    // 会复用同一个卡死进程，永远起不来。最多快速重试一次再 spawn 健康进程。
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let state;
      try {
        state = ensureOnnxServer();
        await waitOnnxServerReady(state);
      } catch (bootError) {
        // 启动/就绪失败：清理当前这个（可能卡死的）进程，下次循环重新 spawn。
        // 精准杀掉 state.proc，仅当全局状态仍指向它时才置空，避免误杀并发新起的进程。
        try { state && state.proc && state.proc.kill(); } catch (_) {}
        if (onnxServerState === state) onnxServerState = null;
        lastError = bootError;
        continue;
      }
      try {
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
      } catch (recError) {
        // 识别阶段失败：进程仍健康（非启动卡死），不再重试，直接抛出错误。
        lastError = recError;
        break;
      }
    }
    throw lastError;
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
// ONNX 公式识别（LaTeX OCR）：复用 onnx-runtime 的 node_modules 运行环境
// （onnxruntime-node 等），模型为 RapidAI/RapidLaTeXOCR 的 4 个独立文件
// （约 171MB，按需单独下载，与 OCR 模型物理隔离）。服务进程协议与 ONNX OCR
// 完全一致（JSON-line stdin/stdout），因此可直接复用 waitOnnxServerReady /
// onnxServerRecognize 这两个通用辅助函数。
// ---------------------------------------------------------------------------

const ONNX_FORMULA_ASSETS = [
  { name: "image_resizer.onnx", size: 38967751, url: "https://ghfast.top/https://github.com/RapidAI/RapidLaTeXOCR/releases/download/v0.0.0/image_resizer.onnx" },
  { name: "encoder.onnx", size: 89008136, url: "https://ghfast.top/https://github.com/RapidAI/RapidLaTeXOCR/releases/download/v0.0.0/encoder.onnx" },
  { name: "decoder.onnx", size: 50952726, url: "https://ghfast.top/https://github.com/RapidAI/RapidLaTeXOCR/releases/download/v0.0.0/decoder.onnx" },
  { name: "tokenizer.json", size: 24174, url: "https://ghfast.top/https://github.com/RapidAI/RapidLaTeXOCR/releases/download/v0.0.0/tokenizer.json" }
];

function getOnnxFormulaDir() {
  return path.join(getOnnxRuntimeDir(), "assets", "formula");
}

function checkOnnxFormula() {
  const dir = getOnnxFormulaDir();
  const installed = ONNX_FORMULA_ASSETS.every((file) => {
    try {
      return fs.statSync(path.join(dir, file.name)).size === file.size;
    } catch (_) {
      return false;
    }
  });
  return { installed, ready: installed, path: dir };
}

function isOnnxFormulaAvailable() {
  return checkOnnxFormula().ready;
}

// ---------------------------------------------------------------------------
// ONNX MFD（Math Formula Detection）：图文混排二期，定位公式区域
// （Pix2Text mfd-1.5 / CnSTD YoloDetector，MIT）。与公式识别共用 ONNX 运行环境，
// 并复用公式引擎识别裁切出的公式；因此「MFD 完整可用」依赖 运行环境 + 公式模型 + MFD 模型
// 三者齐全。下载/安装逻辑镜像上方 ONNX_FORMULA_ASSETS 一节。
// ---------------------------------------------------------------------------

const ONNX_MFD_ASSETS = [
  { name: "pix2text-mfd-1.5.onnx", size: 80311115, url: "https://hf-mirror.com/breezedeus/pix2text-mfd-1.5/resolve/main/pix2text-mfd-1.5.onnx" }
];

function getOnnxMfdDir() {
  return path.join(getOnnxRuntimeDir(), "assets", "mfd");
}

function checkOnnxMfd() {
  const dir = getOnnxMfdDir();
  const installed = ONNX_MFD_ASSETS.every((file) => {
    try {
      return fs.statSync(path.join(dir, file.name)).size === file.size;
    } catch (_) {
      return false;
    }
  });
  return { installed, ready: installed, path: dir };
}

// 完整可用性：ONNX 运行环境 + 公式模型 + MFD 模型 三者齐全。
function isOnnxMfdAvailable() {
  const runtime = checkOnnxRuntime();
  const formula = checkOnnxFormula();
  const mfd = checkOnnxMfd();
  return Boolean(runtime.ready && formula.ready && mfd.ready);
}

let onnxMfdInstallPromise = null;

async function installOnnxMfd(onProgress) {
  if (onnxMfdInstallPromise) return onnxMfdInstallPromise;
  onnxMfdInstallPromise = (async () => {
    // MFD 复用公式引擎，安装前必须已具备 ONNX 运行环境与公式模型。
    const runtime = checkOnnxRuntime();
    if (!runtime.ready) {
      throw new Error("MFD 公式混排依赖 ONNX 运行环境，请先下载 ONNX OCR 引擎");
    }
    const formula = checkOnnxFormula();
    if (!formula.ready) {
      throw new Error("MFD 公式混排依赖公式识别模型，请先下载公式识别模型");
    }
    const dir = getOnnxMfdDir();
    fs.mkdirSync(dir, { recursive: true });
    for (let index = 0; index < ONNX_MFD_ASSETS.length; index += 1) {
      const file = ONNX_MFD_ASSETS[index];
      emitProgress(onProgress, {
        phase: "download",
        message: `下载 ${file.name}`,
        percent: Math.round((index / ONNX_MFD_ASSETS.length) * 100)
      });
      const tmp = path.join(getRuntimeCacheRoot(), `mfd-${file.name}.tmp`);
      await downloadFile(file.url, tmp, file.name, (progress) => {
        if (progress.total) {
          emitProgress(onProgress, {
            phase: "download",
            message: `下载 ${file.name}`,
            percent: Math.round(
              ((index + (progress.downloaded || 0) / progress.total) / ONNX_MFD_ASSETS.length) * 100
            )
          });
        }
      });
      const size = fs.statSync(tmp).size;
      if (size !== file.size) {
        fs.rmSync(tmp, { force: true });
        throw new Error(`${file.name} 下载校验失败（${size} != ${file.size}）`);
      }
      fs.copyFileSync(tmp, path.join(dir, file.name));
      fs.rmSync(tmp, { force: true });
    }
    emitProgress(onProgress, { phase: "done", percent: 100 });
    return checkOnnxMfd();
  })();
  try {
    return await onnxMfdInstallPromise;
  } finally {
    onnxMfdInstallPromise = null;
  }
}

let onnxFormulaInstallPromise = null;

async function installOnnxFormula(onProgress) {
  if (onnxFormulaInstallPromise) return onnxFormulaInstallPromise;
  onnxFormulaInstallPromise = (async () => {
    // 公式识别依赖 onnx-runtime 的运行环境（onnxruntime-node 等 node_modules）
    const runtime = checkOnnxRuntime();
    if (!runtime.ready) {
      throw new Error("公式识别依赖 ONNX 运行环境，请先下载 ONNX OCR 引擎");
    }
    const dir = getOnnxFormulaDir();
    fs.mkdirSync(dir, { recursive: true });
    for (let index = 0; index < ONNX_FORMULA_ASSETS.length; index += 1) {
      const file = ONNX_FORMULA_ASSETS[index];
      emitProgress(onProgress, {
        phase: "download",
        message: `下载 ${file.name}`,
        percent: Math.round((index / ONNX_FORMULA_ASSETS.length) * 100)
      });
      const tmp = path.join(getRuntimeCacheRoot(), `formula-${file.name}.tmp`);
      await downloadFile(file.url, tmp, file.name, (progress) => {
        if (progress.total) {
          emitProgress(onProgress, {
            phase: "download",
            message: `下载 ${file.name}`,
            percent: Math.round(
              ((index + (progress.downloaded || 0) / progress.total) / ONNX_FORMULA_ASSETS.length) * 100
            )
          });
        }
      });
      const size = fs.statSync(tmp).size;
      if (size !== file.size) {
        fs.rmSync(tmp, { force: true });
        throw new Error(`${file.name} 下载校验失败（${size} != ${file.size}）`);
      }
      fs.copyFileSync(tmp, path.join(dir, file.name));
      fs.rmSync(tmp, { force: true });
    }
    emitProgress(onProgress, { phase: "done", percent: 100 });
    return checkOnnxFormula();
  })();
  try {
    return await onnxFormulaInstallPromise;
  } finally {
    onnxFormulaInstallPromise = null;
  }
}

let onnxFormulaServerState = null;

// 与 ensureOnnxServer 同构，仅脚本与状态变量不同；stdio 协议一致。
function ensureOnnxFormulaServer() {
  if (onnxFormulaServerState && onnxFormulaServerState.proc.exitCode === null) {
    return onnxFormulaServerState;
  }
  const scriptPath = path.join(getOnnxRuntimeDir(), "onnx_formula_server.mjs");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("公式识别服务脚本缺失，请重新下载引擎");
  }
  // 启动前同步最新服务脚本（含新增的 onnx_formula_server.mjs）
  try {
    let scriptNames;
    try {
      scriptNames = fs.readdirSync(path.join(__dirname, "bin")).filter((n) => n.endsWith(".mjs"));
    } catch (_) {
      scriptNames = ["onnx_ocr_server.mjs", "onnx_table_split.mjs", "onnx_text_order.mjs", "onnx_formula_server.mjs", "onnx_gray_resize.mjs", "onnx_image_raw.mjs", "onnx_formula_core.mjs", "onnx_mfd_core.mjs", "onnx_mixed_server.mjs"];
    }
    for (const name of scriptNames) {
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
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
        state.fatalError = message.error || "公式识别服务启动失败";
        continue;
      }
      if (message && state.pending.has(message.id)) {
        const entry = state.pending.get(message.id);
        state.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message);
        else entry.reject(new Error(message.error || "公式识别失败"));
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
    if (onnxFormulaServerState === state) {
      onnxFormulaServerState = null;
    }
  };
  proc.on("exit", () => failAll(new Error(state.fatalError || "公式识别服务进程已退出")));
  proc.on("error", (error) => failAll(error));
  onnxFormulaServerState = state;
  return state;
}

let onnxMixedServerState = null;

// 与 ensureOnnxFormulaServer 同构，仅脚本为 onnx_mixed_server.mjs（MFD+公式合并服务）。
// stdio 协议一致，复用 waitOnnxServerReady / onnxServerRecognize。脚本同步循环会一并拷贝
// 新增的 onnx_image_raw.mjs / onnx_formula_core.mjs / onnx_mfd_core.mjs / onnx_mixed_server.mjs。
function ensureOnnxMixedServer() {
  if (onnxMixedServerState && onnxMixedServerState.proc.exitCode === null) {
    return onnxMixedServerState;
  }
  const scriptPath = path.join(getOnnxRuntimeDir(), "onnx_mixed_server.mjs");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("图文混排服务脚本缺失，请重新下载引擎");
  }
  try {
    let scriptNames;
    try {
      scriptNames = fs.readdirSync(path.join(__dirname, "bin")).filter((n) => n.endsWith(".mjs"));
    } catch (_) {
      scriptNames = [
        "onnx_ocr_server.mjs",
        "onnx_table_split.mjs",
        "onnx_text_order.mjs",
        "onnx_formula_server.mjs",
        "onnx_gray_resize.mjs",
        "onnx_image_raw.mjs",
        "onnx_formula_core.mjs",
        "onnx_mfd_core.mjs",
        "onnx_mixed_server.mjs"
      ];
    }
    for (const name of scriptNames) {
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
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
        state.fatalError = message.error || "图文混排服务启动失败";
        continue;
      }
      if (message && state.pending.has(message.id)) {
        const entry = state.pending.get(message.id);
        state.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message);
        else entry.reject(new Error(message.error || "图文混排识别失败"));
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
    if (onnxMixedServerState === state) {
      onnxMixedServerState = null;
    }
  };
  proc.on("exit", () => failAll(new Error(state.fatalError || "图文混排服务进程已退出")));
  proc.on("error", (error) => failAll(error));
  onnxMixedServerState = state;
  return state;
}

async function recognizeOnnxFormula(source) {
  const runtime = checkOnnxRuntime();
  if (!runtime.ready) {
    throw new Error("公式识别依赖 ONNX 运行环境，请先下载 ONNX OCR 引擎");
  }
  const formula = checkOnnxFormula();
  if (!formula.ready) {
    throw new Error("公式识别模型未下载，请先下载公式识别模型");
  }
  let tempFile = "";
  try {
    const imagePath = typeof source === "string" && source.startsWith("data:image/")
      ? (tempFile = dataUrlToTempFile(source))
      : assertImagePath(source);
    if (path.extname(imagePath).toLowerCase() === ".webp") {
      throw new Error("公式识别暂不支持 WebP，请转存 PNG");
    }
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let state;
      try {
        state = ensureOnnxFormulaServer();
        await waitOnnxServerReady(state);
      } catch (bootError) {
        try { state && state.proc && state.proc.kill(); } catch (_) {}
        if (onnxFormulaServerState === state) onnxFormulaServerState = null;
        lastError = bootError;
        continue;
      }
      try {
        const message = await onnxServerRecognize(state, imagePath);
        const text = String(
          message.text || (message.items && message.items[0] && message.items[0].text) || ""
        );
        return {
          engine: "formula",
          text,
          lines: text ? [{ text }] : [],
          raw: message
        };
      } catch (recError) {
        lastError = recError;
        break;
      }
    }
    throw lastError;
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
// 图文混排：MFD 检测公式区域 + 公式引擎识别 + 与文本行合并
// detectOnnxMfd 仅做公式检测（op:"detect"），recognizeOnnxMixed 走完整合并（op:"mixed"），
// recognizeOnnxFormulas 仅做「检测 + 逐框识别」返回 items 列表（op:"formulas"，供「公式识别」页签一图多公式）。
// 三者均依赖 ONNX 运行环境 + 公式模型 + MFD 模型（MFD 复用公式引擎）。
// source 支持 data:image/... 或路径，复用 dataUrlToTempFile + assertImagePath + 临时清理。
// opts: { textLines, boxes, longSide, conf, iou, boxPad, filterTinyText }
//   - boxPad：公式框裁剪外扩像素数（0–40，默认 2），贯通「混排」「多公式」裁剪链路。
//   - conf/iou：MFD 检测灵敏度（不传则用服务端默认 0.25/0.7）；前端可调低 conf 抑制单字母误检。
//   - filterTinyText：丢弃「识别结果为纯 1–2 字母/数字」的疑似普通文字误检框（默认 true，可 false 关）。
//   - boxes：已检测 MFD 框（来自 detectOnnxMfd）可复用，避免重复推理。
//   - textLines 的 chars（逐字符框）会原样透传，供服务端 splitLinePieces 做行内公式交错切分。
// ---------------------------------------------------------------------------

async function detectOnnxMfd(source, opts) {
  const runtime = checkOnnxRuntime();
  if (!runtime.ready) {
    throw new Error("MFD 公式混排依赖 ONNX 运行环境，请先下载 ONNX OCR 引擎");
  }
  const formula = checkOnnxFormula();
  if (!formula.ready) {
    throw new Error("MFD 公式混排依赖公式识别模型，请先下载公式识别模型");
  }
  const mfd = checkOnnxMfd();
  if (!mfd.ready) {
    throw new Error("MFD 模型未下载，请先下载 MFD 公式检测模型");
  }
  const imagePath = typeof source === "string" && source.startsWith("data:image/")
    ? dataUrlToTempFile(source)
    : assertImagePath(source);
  const tempFile = imagePath !== source ? imagePath : "";
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let state;
      try {
        state = ensureOnnxMixedServer();
        await waitOnnxServerReady(state);
      } catch (bootError) {
        try { state && state.proc && state.proc.kill(); } catch (_) {}
        if (onnxMixedServerState === state) onnxMixedServerState = null;
        lastError = bootError;
        continue;
      }
      try {
        const detectPayload = { op: "detect" };
        if (opts && opts.conf != null) detectPayload.conf = Number(opts.conf);
        if (opts && opts.iou != null) detectPayload.iou = Number(opts.iou);
        const message = await onnxServerRecognize(state, imagePath, 120000, detectPayload);
        if (!message.ok) throw new Error(message.error || "MFD 检测失败");
        return {
          ok: true,
          image: message.image || { w: 0, h: 0 },
          boxes: Array.isArray(message.boxes) ? message.boxes : []
        };
      } catch (recError) {
        lastError = recError;
        break;
      }
    }
    throw lastError;
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

async function recognizeOnnxMixed(source, opts) {
  opts = opts || {};
  const runtime = checkOnnxRuntime();
  if (!runtime.ready) {
    throw new Error("MFD 公式混排依赖 ONNX 运行环境，请先下载 ONNX OCR 引擎");
  }
  const formula = checkOnnxFormula();
  if (!formula.ready) {
    throw new Error("MFD 公式混排依赖公式识别模型，请先下载公式识别模型");
  }
  const mfd = checkOnnxMfd();
  if (!mfd.ready) {
    throw new Error("MFD 模型未下载，请先下载 MFD 公式检测模型");
  }
  const imagePath = typeof source === "string" && source.startsWith("data:image/")
    ? dataUrlToTempFile(source)
    : assertImagePath(source);
  const tempFile = imagePath !== source ? imagePath : "";
  const textLines = Array.isArray(opts.textLines)
    ? opts.textLines
        .filter((t) => t && t.text != null && Array.isArray(t.box) && t.box.length === 4)
        .map((t) => {
          const o = { text: String(t.text), box: t.box.map(Number) };
          if (Array.isArray(t.chars) && t.chars.length) o.chars = t.chars;
          return o;
        })
    : [];
  const boxPad = Number(opts.boxPad);
  const payload = {
    op: "mixed",
    longSide: opts.longSide != null ? Number(opts.longSide) : 768,
    conf: opts.conf != null ? Number(opts.conf) : 0.25,
    iou: opts.iou != null ? Number(opts.iou) : 0.55, // 0.7.9: 0.7 会放过同一公式的重复框，降到 0.55
    boxPad: Number.isFinite(boxPad) ? Math.max(0, Math.min(40, Math.round(boxPad))) : 2,
    filterTinyText: opts.filterTinyText !== false,
    textLines
  };
  // 复用已检测的 MFD 框（来自 detectOnnxMfd），避免服务端重复跑一遍检测。
  if (Array.isArray(opts.boxes) && opts.boxes.length) payload.boxes = opts.boxes;
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let state;
      try {
        state = ensureOnnxMixedServer();
        await waitOnnxServerReady(state);
      } catch (bootError) {
        try { state && state.proc && state.proc.kill(); } catch (_) {}
        if (onnxMixedServerState === state) onnxMixedServerState = null;
        lastError = bootError;
        continue;
      }
      try {
        const message = await onnxServerRecognize(state, imagePath, 120000, payload);
        if (!message.ok) throw new Error(message.error || "图文混排识别失败");
        return {
          ok: true,
          engine: "mixed",
          image: message.image || { w: 0, h: 0 },
          boxes: Array.isArray(message.boxes) ? message.boxes : [],
          segments: Array.isArray(message.segments) ? message.segments : [],
          markdown: typeof message.markdown === "string" ? message.markdown : "",
          raw: message.raw || {}
        };
      } catch (recError) {
        lastError = recError;
        break;
      }
    }
    throw lastError;
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

async function recognizeOnnxFormulas(source, opts) {
  opts = opts || {};
  const runtime = checkOnnxRuntime();
  if (!runtime.ready) {
    throw new Error("MFD 公式混排依赖 ONNX 运行环境，请先下载 ONNX OCR 引擎");
  }
  const formula = checkOnnxFormula();
  if (!formula.ready) {
    throw new Error("MFD 公式混排依赖公式识别模型，请先下载公式识别模型");
  }
  const mfd = checkOnnxMfd();
  if (!mfd.ready) {
    throw new Error("MFD 模型未下载，请先下载 MFD 公式检测模型");
  }
  const imagePath = typeof source === "string" && source.startsWith("data:image/")
    ? dataUrlToTempFile(source)
    : assertImagePath(source);
  const tempFile = imagePath !== source ? imagePath : "";
  const boxPad = Number(opts.boxPad);
  const payload = {
    op: "formulas",
    longSide: opts.longSide != null ? Number(opts.longSide) : 768,
    conf: opts.conf != null ? Number(opts.conf) : 0.25,
    iou: opts.iou != null ? Number(opts.iou) : 0.55, // 0.7.9: 0.7 会放过同一公式的重复框，降到 0.55
    boxPad: Number.isFinite(boxPad) ? Math.max(0, Math.min(40, Math.round(boxPad))) : 2,
    filterTinyText: opts.filterTinyText !== false
  };
  // 复用已检测的 MFD 框（来自 detectOnnxMfd），避免服务端重复跑一遍检测。
  if (Array.isArray(opts.boxes) && opts.boxes.length) payload.boxes = opts.boxes;
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let state;
      try {
        state = ensureOnnxMixedServer();
        await waitOnnxServerReady(state);
      } catch (bootError) {
        try { state && state.proc && state.proc.kill(); } catch (_) {}
        if (onnxMixedServerState === state) onnxMixedServerState = null;
        lastError = bootError;
        continue;
      }
      try {
        const message = await onnxServerRecognize(state, imagePath, 120000, payload);
        if (!message.ok) throw new Error(message.error || "公式识别失败");
        return {
          ok: true,
          engine: "formulas",
          image: message.image || { w: 0, h: 0 },
          items: Array.isArray(message.items) ? message.items : []
        };
      } catch (recError) {
        lastError = recError;
        break;
      }
    }
    throw lastError;
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

// P2-11：手动释放常驻 ONNX 服务进程（ocr/formula/mixed 三个），返回释放的进程数。
// 下次识别会自动重新 spawn（冷启动 2-4s），用于让用户主动归还内存。
function releaseOnnxServers() {
  let released = 0;
  const states = [onnxServerState, onnxFormulaServerState, onnxMixedServerState];
  for (const state of states) {
    if (state && state.proc) {
      try { state.proc.kill(); released += 1; } catch (_) {}
    }
  }
  onnxServerState = null;
  onnxFormulaServerState = null;
  onnxMixedServerState = null;
  return released;
}

// 目录 / 文件占用的字节数（符号链接不计入，避免顺着链接统计到目录外）。
function pathSizeBytes(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (_) {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    try {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) total += pathSizeBytes(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch (_) {
      // 单个条目统计失败不影响整体。
    }
  }
  return total;
}

// 删除单个目标并返回实际释放的字节数；不存在或删除失败都返回 0（不抛错、不中断整体清理）。
function removePathAndMeasure(target) {
  if (!target) return 0;
  const size = pathSizeBytes(target);
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (_) {
    return 0;
  }
  return size;
}

// P2：清理 ONNX 模型缓存（node_modules 依赖 + 全部模型，约 300MB+）+ 下载中断残留的临时包。
// 契约：返回 Promise<{ freedBytes: number }>，freedBytes 是本次真实释放的字节数
// （目录本就不存在 / 删除被拒时为 0）。本函数不会抛出未捕获异常，UI 直接 await 即可。
// 注意：只清 ONNX（含公式 / MFD 模型，它们都在 onnx-runtime 下）；微信 OCR 运行时
// （ocr-runtime）不在「模型缓存」范围内，保持不动。
async function clearModelCache() {
  // 子进程还持有已删除模型的句柄，必须先释放，否则 Windows 上目录删不掉。
  releaseOnnxServers();
  const targets = [getOnnxRuntimeDir()];
  // 历史中断的下载可能把半截包留在缓存根目录（命名与安装流程一致）。
  try {
    for (const name of fs.readdirSync(getRuntimeCacheRoot())) {
      if (/^onnx-.*\.tgz$/.test(name) || /^formula-.*\.tmp$/.test(name) || /^mfd-.*\.tmp$/.test(name)) {
        targets.push(path.join(getRuntimeCacheRoot(), name));
      }
    }
  } catch (_) {
    // 缓存根目录不存在时无需处理临时文件。
  }
  let freedBytes = 0;
  for (const target of targets) {
    freedBytes += removePathAndMeasure(target); // 单个目标失败不中断整体清理
  }
  return { freedBytes };
}

window.nativeOcr = {
  checkRuntime,
  installRuntime,
  recognize,
  recognizeVision,
  isVisionAvailable,
  getVisionSupportDetail,
  recognizeOnnxOcr,
  isOnnxOcrAvailable,
  installOnnxRuntime,
  installOnnxFormula,
  isOnnxFormulaAvailable,
  recognizeOnnxFormula,
  installOnnxMfd,
  isOnnxMfdAvailable,
  detectOnnxMfd,
  recognizeOnnxMixed,
  recognizeOnnxFormulas,
  releaseOnnxServers,
  clearModelCache,
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
