const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { clipboard } = require("electron");

const OCR_IMAGE_STORAGE_KEY = "wechat_ocr_image";
const OCR_IMAGE_EVENT = "wechat-ocr-image";
const RUNTIME_REGISTRY_URL = "https://registry.npmmirror.com/@ztools-center/wechat-ocr-native";
const RUNTIME_DIST_PREFIX = "package/dist/";
const RUNTIME_CACHE_ROOT = path.join(os.homedir(), "Library", "Application Support", "ZTools", "wechat-ocr");
const RUNTIME_DIR = path.join(RUNTIME_CACHE_ROOT, "ocr-runtime");
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
        "User-Agent": "ZTools-WeChat-OCR/0.1.0",
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

function getLocalRuntimeInfo(runtimeDir = RUNTIME_DIR) {
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
  const runtimePrefix = RUNTIME_DIR + path.sep;
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
  if (runtimeInstallPromise) return runtimeInstallPromise;
  runtimeInstallPromise = (async () => {
    fs.mkdirSync(RUNTIME_CACHE_ROOT, { recursive: true });
    emitProgress(onProgress, { phase: "metadata", percent: 0 });
    const latest = await fetchLatestRuntime();
    const current = getLocalRuntimeInfo();
    if (current.installed && current.version === latest.version) {
      return checkRuntime();
    }

    const tmpTgz = path.join(RUNTIME_CACHE_ROOT, `wechat-ocr-native-${latest.version}-${Date.now()}.tgz`);
    const tmpRuntimeDir = path.join(RUNTIME_CACHE_ROOT, `.ocr-runtime-${process.pid}-${Date.now()}`);
    const backupDir = path.join(RUNTIME_CACHE_ROOT, `.ocr-runtime-backup-${Date.now()}`);
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
      if (fs.existsSync(RUNTIME_DIR)) {
        fs.renameSync(RUNTIME_DIR, backupDir);
      }
      fs.renameSync(tmpRuntimeDir, RUNTIME_DIR);
      fs.rmSync(backupDir, { recursive: true, force: true });
      emitProgress(onProgress, { phase: "done", version: latest.version, percent: 100 });
      return checkRuntime();
    } catch (error) {
      if (fs.existsSync(backupDir) && !fs.existsSync(RUNTIME_DIR)) {
        try {
          fs.renameSync(backupDir, RUNTIME_DIR);
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
  const local = getLocalRuntimeInfo();
  if (!local.installed) {
    throw new Error("OCR 运行时未下载，请先下载后再识别");
  }
  const entry = path.join(RUNTIME_DIR, "index.js");
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ztools-wechat-ocr-"));
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
  window.__WECHAT_OCR_PENDING_IMAGE__ = image;
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

window.wechatOcr = {
  checkRuntime,
  installRuntime,
  recognize,
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
