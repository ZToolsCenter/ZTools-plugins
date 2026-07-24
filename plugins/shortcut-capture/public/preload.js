const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { clipboard, ipcRenderer, nativeImage } = require("electron");

const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
const EDITOR_KEY_PREFIX = "shortcut-capture:editor:";
const EDITOR_CLOSE_CHANNEL = "shortcut-capture-editor-close";
const EDITOR_TOOLBAR_MIN_WIDTH = 620;
const EDITOR_MAX_VISIBLE_ASPECT = 5;
const EDITOR_BOTTOM_SHADOW_SPACE = 18;

function notify(message, type = "error") {
  if (typeof ztools.showNotification === "function") {
    ztools.showNotification(message, type);
  } else {
    console.error(message);
  }
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("无效的图片数据");
  }
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("图片数据不是 base64 Data URL");
  }
  const subtype = match[1].toLowerCase();
  const ext = subtype === "jpeg" ? ".jpg" : subtype === "svg+xml" ? ".svg" : `.${subtype}`;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("图片数据为空或过大");
  }
  return { subtype, ext, buffer };
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

function firstImage(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return value;
    if (fs.existsSync(value)) return value;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = firstImage(item);
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
      const image = firstImage(item);
      if (image) return image;
    }
  }
  return "";
}

function dataUrlFromFile(imagePath) {
  const resolved = assertImagePath(imagePath);
  const ext = path.extname(resolved).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".gif": "image/gif"
  };
  return `data:${mimeMap[ext] || "application/octet-stream"};base64,${fs.readFileSync(resolved).toString("base64")}`;
}

function normalizeImagePayload(payload) {
  const image = firstImage(payload);
  if (!image) throw new Error("未找到图片");
  return image.startsWith("data:image/") ? image : dataUrlFromFile(image);
}

function defaultFileName() {
  const date = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-") + "-" + pad(date.getMilliseconds(), 3);
  return `screenshot-${stamp}.png`;
}

function imageSize(dataUrl) {
  const image = nativeImage.createFromDataURL(dataUrl);
  const size = image.getSize();
  if (!size.width || !size.height) return { width: 800, height: 600 };
  return size;
}

function imageInfo(dataUrl) {
  const { buffer, ext } = parseDataUrl(dataUrl);
  const size = imageSize(dataUrl);
  return {
    width: size.width,
    height: size.height,
    bytes: buffer.length,
    ext
  };
}

function displayScaleFactor(display) {
  const explicitScale = Number(display && display.scaleFactor);
  if (Number.isFinite(explicitScale) && explicitScale > 1) return explicitScale;

  const bounds = display && display.bounds;
  const size = display && display.size;
  if (bounds && size && bounds.width > 0 && bounds.height > 0) {
    const widthScale = Number(size.width) / Number(bounds.width);
    const heightScale = Number(size.height) / Number(bounds.height);
    const inferredScale = Math.max(widthScale, heightScale);
    if (Number.isFinite(inferredScale) && inferredScale > 1) return inferredScale;
  }

  const deviceScale = Number(window.devicePixelRatio);
  if (Number.isFinite(deviceScale) && deviceScale > 1) return deviceScale;

  return Number.isFinite(explicitScale) && explicitScale > 0 ? explicitScale : 1;
}

function copyImage(dataUrl) {
  if (typeof ztools.copyImage === "function") {
    ztools.copyImage(dataUrl);
    return true;
  }
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("图片数据无效");
  clipboard.writeImage(image);
  return true;
}

function saveDataUrl(dataUrl, savePath) {
  const { buffer } = parseDataUrl(dataUrl);
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, buffer);
  return savePath;
}

function showSaveDialog(defaultPath) {
  if (typeof ztools.showSaveDialog !== "function") return defaultPath;
  const result = ztools.showSaveDialog({
    title: "保存截图",
    defaultPath,
    buttonLabel: "保存",
    filters: [{ name: "Images", extensions: ["png"] }]
  });
  if (typeof result === "string") return result;
  if (result && typeof result.filePath === "string") return result.filePath;
  return "";
}

function getDefaultSavePath() {
  const downloads = typeof ztools.getPath === "function" ? ztools.getPath("downloads") : process.cwd();
  return path.join(downloads, defaultFileName());
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function parseHashData(queryStr) {
  return String(queryStr || "")
    .split("&")
    .filter(Boolean)
    .reduce((acc, item) => {
      const [key, value = ""] = item.split("=");
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function editorStorageKey(key) {
  return EDITOR_KEY_PREFIX + key;
}

function currentEditorKey() {
  const hash = String(window.location.hash || "");
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return "";
  return parseHashData(hash.slice(queryIndex + 1)).key || "";
}

function editorUrl(key) {
  const hash = `#/editor?key=${encodeURIComponent(key)}`;
  const indexPath = path.join(__dirname, "index.html");
  return `${pathToFileURL(indexPath).href}${hash}`;
}

function bindEditorCloseEvent(key) {
  const handler = (_event, payload = {}) => {
    if (!payload || payload.key !== key) return;
    ipcRenderer.removeListener(EDITOR_CLOSE_CHANNEL, handler);
    closePluginSoon(true);
  };
  ipcRenderer.on(EDITOR_CLOSE_CHANNEL, handler);
}

function sendEditorCloseEvent() {
  const key = currentEditorKey();
  if (!key) return false;
  if (typeof ztools.sendToParent === "function") {
    ztools.sendToParent(EDITOR_CLOSE_CHANNEL, { key });
    return true;
  }
  return false;
}

async function createEditorWindow(dataUrl, callback) {
  const point = ztools.getCursorScreenPoint();
  const display = ztools.getDisplayNearestPoint(point);
  const bounds = display && display.bounds ? display.bounds : { x: 0, y: 0, width: 1200, height: 800 };
  const scale = displayScaleFactor(display);
  const size = imageSize(dataUrl);
  const cssWidth = Math.ceil(size.width / scale);
  const cssHeight = Math.ceil(size.height / scale);
  const heightBasedMaxWidth = Math.max(EDITOR_TOOLBAR_MIN_WIDTH, Math.ceil(cssHeight * EDITOR_MAX_VISIBLE_ASPECT));
  const availableContentWidth = Math.min(bounds.width - 80, heightBasedMaxWidth);
  const availableContentHeight = bounds.height - 140;
  const viewScale = Math.min(1, availableContentWidth / cssWidth, availableContentHeight / cssHeight);
  const contentWidth = Math.ceil(cssWidth * viewScale);
  const contentHeight = Math.ceil(cssHeight * viewScale);
  const winWidth = Math.max(EDITOR_TOOLBAR_MIN_WIDTH + 40, contentWidth + 24);
  const winHeight = Math.max(260, contentHeight + 64 + EDITOR_BOTTOM_SHADOW_SPACE);
  const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  ztools.dbStorage.setItem(editorStorageKey(key), {
    dataUrl,
    scale,
    viewScale,
    cssWidth,
    cssHeight,
    createdAt: Date.now()
  });

  const x = clamp(point.x - Math.floor(winWidth / 2), bounds.x, bounds.x + bounds.width - winWidth);
  const y = clamp(point.y - Math.floor(winHeight / 2), bounds.y, bounds.y + bounds.height - winHeight);
  const win = ztools.createBrowserWindow(editorUrl(key), {
    title: "截图工具",
    useContentSize: true,
    width: Math.floor(winWidth),
    height: Math.floor(winHeight),
    x: Math.floor(x),
    y: Math.floor(y),
    minimizable: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    webPreferences: {
      preload: "preload.js",
      zoomFactor: 1,
      devTools: true
    }
  }, () => {
    if (typeof callback === "function") callback(win);
    if (typeof win.setAlwaysOnTop === "function") {
      win.setAlwaysOnTop(true, "floating");
    }
    win.focus();
  });

  bindEditorCloseEvent(key);
  return win;
}

function capture(callback) {
  if (typeof ztools.screenCapture !== "function") {
    throw new Error("当前 ZTools 环境不支持 screenCapture");
  }
  ztools.hideMainWindow();
  ztools.screenCapture((imgBase64) => {
    Promise.resolve()
      .then(() => callback(imgBase64))
      .then((shouldKill = true) => {
        if (shouldKill !== false) closePluginSoon(true);
      }, (error) => {
        closePluginSoon(true);
        throw error;
      });
  });
}

function closePluginSoon(force = false) {
  setTimeout(() => {
    if (typeof ztools.outPlugin === "function") ztools.outPlugin(force);
  }, 50);
}

function killPluginNow() {
  try {
    if (typeof ztools.outPlugin === "function") ztools.outPlugin(true);
  } catch (error) {
    console.error(error);
  }
}

async function openImagePayload(payload) {
  const payloads = typeof payload === "string" ? payload.split("#") : [payload];
  const dataUrl = normalizeImagePayload(payloads[0]);
  await createEditorWindow(dataUrl, (win) => {
    if (payloads.length > 1) {
      const { x, y } = parseHashData(payloads[1]);
      if (x !== undefined && y !== undefined) {
        win.setPosition(parseInt(x, 10), parseInt(y, 10));
      }
    }
  });
}

function runSafely(task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      notify(error.message || String(error));
      closePluginSoon();
    });
}

window.exports = {
  "shortcut-capture": {
    mode: "none",
    args: {
      enter: () => runSafely(() => {
        capture(async (imgBase64) => {
          if (!imgBase64) return true;
          await createEditorWindow(imgBase64);
          return false;
        });
      })
    }
  },
  "shortcut-capture-copy": {
    mode: "none",
    args: {
      enter: () => runSafely(() => {
        capture((imgBase64) => {
          if (imgBase64) copyImage(imgBase64);
        });
      })
    }
  },
  "shortcut-capture-save": {
    mode: "none",
    args: {
      enter: () => runSafely(() => {
        capture((imgBase64) => {
          if (imgBase64) {
            const savePath = showSaveDialog(getDefaultSavePath());
            if (savePath) {
              saveDataUrl(imgBase64, savePath);
              if (typeof ztools.shellShowItemInFolder === "function") {
                ztools.shellShowItemInFolder(savePath);
              }
            }
          }
        });
      })
    }
  },
  "shortcut-capture-image": {
    mode: "none",
    args: {
      enter: ({ payload }) => runSafely(() => openImagePayload(payload))
    }
  }
};

window.shortcutCapture = {
  getImageFromAction(action) {
    return firstImage([
      action && action.payload,
      action && action.inputState && action.inputState.pastedImage,
      action
    ]);
  },
  copyImage,
  saveDataUrl,
  defaultFileName,
  imageInfo,
  readImageDataUrl: dataUrlFromFile,
  openImagePayload,
  editorKeyPrefix: EDITOR_KEY_PREFIX,
  closeWindow(force = false) {
    if (force) {
      if (!sendEditorCloseEvent()) killPluginNow();
      window.close();
      return;
    }
    window.close();
  },
  outPlugin(force = false) {
    if (force) {
      killPluginNow();
      return;
    }
    closePluginSoon(false);
  },
  showSaveDialog,
  getDefaultSavePath,
  shellShowItemInFolder(filePath) {
    if (typeof ztools.shellShowItemInFolder === "function") ztools.shellShowItemInFolder(filePath);
  }
};
