var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// core/src/preloadHelpers.cjs
var require_preloadHelpers = __commonJS({
  "core/src/preloadHelpers.cjs"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var os = require("os");
    var { execFileSync, execSync } = require("child_process");
    var { clipboard, nativeImage } = require("electron");
    var _isWindows = process.platform === "win32";
    var _isMacOS = process.platform === "darwin";
    var _isLinux = process.platform === "linux";
    var FONT_EXTENSIONS = /* @__PURE__ */ new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2", ".eot"]);
    var WRITABLE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".ora"]);
    var _allowedPaths = /* @__PURE__ */ new Set();
    var _allowedReadDirs = /* @__PURE__ */ new Set();
    var _normalizeFsPath = (filePath) => {
      if (!filePath || typeof filePath !== "string") return "";
      try {
        const cleaned = filePath.replace(/^file:\/\//, "");
        const withoutPrefix = cleaned.replace(/^\\\\\?\\/, "");
        const resolved = path.resolve(withoutPrefix);
        return _isWindows ? resolved.toLowerCase() : resolved;
      } catch (e) {
        return "";
      }
    };
    var _allowPath = (filePath) => {
      const normalized = _normalizeFsPath(filePath);
      if (!normalized) return false;
      _allowedPaths.add(normalized);
      return true;
    };
    var _isInsideDirs = (dirs, normalizedPath) => {
      for (const dir of dirs) {
        if (normalizedPath === dir) return true;
        const rel = path.relative(dir, normalizedPath);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
      }
      return false;
    };
    var _isPathAllowedForRead = (filePath) => {
      const normalized = _normalizeFsPath(filePath);
      if (!normalized) return false;
      if (_allowedPaths.has(normalized)) return true;
      return _isInsideDirs(_allowedReadDirs, normalized);
    };
    var _isPathAllowedForWrite = (filePath) => {
      const normalized = _normalizeFsPath(filePath);
      if (!normalized) return false;
      return _allowedPaths.has(normalized);
    };
    var _sanitizeSuggestedName = (suggestedName, fallback) => {
      if (typeof suggestedName !== "string") return fallback;
      const unified = suggestedName.replace(/\\/g, "/");
      const base = path.basename(unified);
      const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[<>:"|?*]/g, "").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
      return cleaned || fallback;
    };
    var _buildDefaultSavePath = (suggestedName, fallback) => {
      const safeName = _sanitizeSuggestedName(suggestedName, fallback);
      const dir = path.join(os.homedir(), "Desktop");
      const candidate = path.join(dir, safeName);
      if (path.dirname(candidate) !== dir) {
        return path.join(dir, fallback);
      }
      return candidate;
    };
    var _extractAndAllowDialogPath = (result) => {
      if (!result) return null;
      let candidate = null;
      if (typeof result === "string") candidate = result;
      else if (Array.isArray(result) && result.length > 0) candidate = result[0];
      else if (result.filePaths && Array.isArray(result.filePaths) && result.filePaths.length > 0) candidate = result.filePaths[0];
      else if (typeof result.filePath === "string") candidate = result.filePath;
      if (!candidate || typeof candidate !== "string") return null;
      const cleaned = candidate.startsWith("file://") ? candidate.replace("file://", "") : candidate;
      _allowPath(cleaned);
      return cleaned;
    };
    var _extractDialogPaths = (result) => {
      if (!result) return null;
      const cleanList = (list) => list.filter((p) => typeof p === "string").map((p) => p.startsWith("file://") ? p.replace("file://", "") : p).slice(0, 64);
      if (typeof result === "string") {
        return result.startsWith("file://") ? result.replace("file://", "") : result;
      }
      if (Array.isArray(result)) {
        const paths = cleanList(result);
        return paths.length > 0 ? paths : null;
      }
      if (Array.isArray(result.filePaths) && result.filePaths.length > 0) {
        return { filePaths: cleanList(result.filePaths) };
      }
      if (typeof result.filePath === "string") {
        return { filePath: result.filePath.startsWith("file://") ? result.filePath.replace("file://", "") : result.filePath };
      }
      return null;
    };
    var _readUInt16 = (buffer, offset) => {
      return offset + 2 <= buffer.length ? buffer.readUInt16BE(offset) : 0;
    };
    var _readUInt32 = (buffer, offset) => {
      return offset + 4 <= buffer.length ? buffer.readUInt32BE(offset) : 0;
    };
    var _readBuffer = (filePath) => {
      try {
        const buffer = fs.readFileSync(filePath);
        return buffer.length > 0 ? buffer : null;
      } catch (e) {
        return null;
      }
    };
    var _isFontFile = (filePath) => FONT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
    var _hasFontMagic = (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".eot") return true;
      try {
        const fd = fs.openSync(filePath, "r");
        try {
          const header = Buffer.alloc(4);
          const read = fs.readSync(fd, header, 0, 4, 0);
          if (read < 4) return false;
          const tag = header.toString("latin1");
          if (tag === "OTTO" || tag === "true" || tag === "ttcf" || tag === "wOFF" || tag === "wOF2") {
            return true;
          }
          return header[0] === 0 && header[1] === 1 && header[2] === 0 && header[3] === 0;
        } finally {
          fs.closeSync(fd);
        }
      } catch (e) {
        return false;
      }
    };
    var _detectImageMime = (buffer) => {
      if (!buffer || buffer.length < 4) return "image/png";
      if (buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return "image/png";
      if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
      if (buffer[0] === 71 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 56) return "image/gif";
      if (buffer[0] === 66 && buffer[1] === 77) return "image/bmp";
      if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
      const start = buffer.toString("utf8", 0, Math.min(buffer.length, 256)).trimStart().toLowerCase();
      if (start.startsWith("<svg") || start.startsWith("<?xml")) return "image/svg+xml";
      return "image/png";
    };
    var _decodeUtf16BE = (buffer) => {
      const length = buffer.length - buffer.length % 2;
      const swapped = Buffer.alloc(length);
      for (let i = 0; i < length; i += 2) {
        swapped[i] = buffer[i + 1];
        swapped[i + 1] = buffer[i];
      }
      return swapped.toString("utf16le");
    };
    var _isCFFFont = (buffer) => {
      if (!buffer || buffer.length < 4) return false;
      return buffer[0] === 0 && buffer[1] === 1 && buffer[2] === 0 && buffer[3] === 0;
    };
    var _hasMicrosoftLicense = (nameTableData) => {
      try {
        const numRecords = nameTableData.readUInt16BE(6);
        for (let i = 0; i < numRecords; i++) {
          const recordOffset = 10 + i * 16;
          const nameID = nameTableData.readUInt16BE(recordOffset + 6);
          const length = nameTableData.readUInt16BE(recordOffset + 8);
          const offset = nameTableData.readUInt16BE(recordOffset + 10);
          const stringDataOffset = nameTableData.readUInt16BE(8);
          if (nameID === 134 && length > 0) {
            const recordStart = stringDataOffset + offset;
            if (recordStart + length <= nameTableData.length) {
              return true;
            }
          }
        }
      } catch (e) {
        return false;
      }
      return false;
    };
    var _detectCFFFont = (buffer) => {
      try {
        const numTables = _readUInt16(buffer, 4);
        if (numTables === 0) return false;
        for (let i = 0; i < numTables; i++) {
          const tableOffset = 12 + i * 16;
          const tag = buffer.toString("ascii", tableOffset, tableOffset + 4);
          if (tag === "CFF " || tag === "CFF2") return true;
        }
      } catch (e) {
        return false;
      }
      return false;
    };
    var _getFontNameFromBuffer = (buffer, filePath) => {
      try {
        const isCFF = _isCFFFont(buffer);
        if (!isCFF) {
          return _detectCFFFont(buffer) ? _readFontNameUsingCFF(buffer) : _readFontNameUsingOffsetTable(buffer);
        }
        return _readFontNameUsingCFF(buffer);
      } catch (e) {
        return null;
      }
    };
    var _getSystemFontsWindows = () => {
      try {
        const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $OutputEncoding = [System.Text.Encoding]::UTF8
      $fonts = @()
      $regKeys = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Fonts',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Fonts'
      )
      foreach ($key in $regKeys) {
        if (Test-Path $key) {
          $reg = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
          if ($reg) {
            foreach ($prop in $reg.PSObject.Properties) {
              if ($prop.Name -notmatch '^PS') {
                $name = $prop.Name -replace '\\s*\\(TrueType\\)\\s*$',''
                $name = $name -replace '\\s*\\(OpenType\\)\\s*$',''
                $name = $name -replace '\\s*\\(Regular\\)\\s*$',''
                $name = $name -replace '\\s*\\(Bold\\)\\s*$',''
                $name = $name -replace '\\s*\\(Italic\\)\\s*$',''
                $name = $name -replace '\\s*\\(Bold Italic\\)\\s*$',''
                $name = $name -replace '\\s*\\(Light\\)\\s*$',''
                $name = $name -replace '\\s*\\(Medium\\)\\s*$',''
                $name = $name -replace '\\s*\\(Semibold\\)\\s*$',''
                $name = $name -replace '\\s*\\(Black\\)\\s*$',''
                $name = $name -replace '\\s*\\(Thin\\)\\s*$',''
                $name = $name -replace '\\s*\\(ExtraBold\\)\\s*$',''
                $name = $name -replace '\\s*\\(Condensed\\)\\s*$',''
                $name = $name -replace '\\s*\\(Extended\\)\\s*$',''
                $name = $name.Trim()
                if ($name) { $fonts += $name }
              }
            }
          }
        }
      }
      $fonts | Select-Object -Unique
    `;
        const result = execSync(psScript, {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 1e4,
          shell: "powershell.exe"
        });
        const fonts = /* @__PURE__ */ new Set();
        const lines = result.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && trimmed.length > 0) {
            fonts.add(trimmed);
          }
        }
        return Array.from(fonts);
      } catch (e) {
        console.warn("[preload] Windows 获取系统字体失败:", e);
        return [];
      }
    };
    var _getSystemFontsMacOS = () => {
      try {
        const result = execSync("system_profiler SPFontsDataType", {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 1e4
        });
        const fonts = /* @__PURE__ */ new Set();
        const lines = result.split("\n");
        for (const line of lines) {
          const match = line.match(/^\s*Full Name:\s*(.+)$/);
          if (match && match[1]) {
            const fontName = match[1].trim();
            if (fontName.length > 0 && !fonts.has(fontName)) {
              fonts.add(fontName);
            }
          }
        }
        return Array.from(fonts);
      } catch (e) {
        console.warn("[preload] macOS 获取系统字体失败:", e);
        return [];
      }
    };
    var _getSystemFontsLinux = () => {
      try {
        const result = execFileSync("fc-list", {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 5e3
        });
        const fonts = /* @__PURE__ */ new Set();
        const lines = result.split("\n");
        for (const line of lines) {
          const match = line.match(/^.*:\s+(.+?)\s+-?\s*$/);
          if (match && match[1]) {
            const fontName = match[1].trim();
            if (fontName.length > 0 && !fonts.has(fontName)) {
              fonts.add(fontName);
            }
          }
        }
        return Array.from(fonts);
      } catch (e) {
        console.warn("[preload] Linux 获取系统字体失败:", e);
        return [];
      }
    };
    var _readFontNameUsingCFF = (buffer) => {
      try {
        const numTables = _readUInt16(buffer, 4);
        if (numTables === 0) return null;
        for (let i = 0; i < numTables; i++) {
          const tableOffset = 12 + i * 16;
          const tag = buffer.toString("ascii", tableOffset, tableOffset + 4);
          if (tag === "name") {
            const tableLength = _readUInt32(buffer, tableOffset + 4);
            const tableOffset2 = _readUInt32(buffer, tableOffset + 8);
            const nameTableData = buffer.slice(tableOffset2, tableOffset2 + tableLength);
            return _extractFontName(nameTableData, buffer);
          }
        }
      } catch (e) {
        return null;
      }
      return null;
    };
    var _readFontNameUsingOffsetTable = (buffer) => {
      try {
        const numTables = _readUInt16(buffer, 4);
        if (numTables === 0) return null;
        for (let i = 0; i < numTables; i++) {
          const tableOffset = 12 + i * 16;
          const tag = buffer.toString("ascii", tableOffset, tableOffset + 4);
          if (tag === "name") {
            const tableLength = _readUInt32(buffer, tableOffset + 4);
            const tableOffset2 = _readUInt32(buffer, tableOffset + 8);
            const nameTableData = buffer.slice(tableOffset2, tableOffset2 + tableLength);
            return _extractFontName(nameTableData, buffer);
          }
        }
      } catch (e) {
        return null;
      }
      return null;
    };
    var _extractFontName = (nameTableData, buffer) => {
      try {
        const numRecords = nameTableData.readUInt16BE(6);
        const stringDataOffset = nameTableData.readUInt16BE(8);
        const isCFF = buffer ? _isCFFFont(buffer) : false;
        for (let i = 0; i < numRecords; i++) {
          const recordOffset = 10 + i * 16;
          const platformID = nameTableData.readUInt16BE(recordOffset);
          const encodingID = nameTableData.readUInt16BE(recordOffset + 2);
          const languageID = nameTableData.readUInt16BE(recordOffset + 4);
          const nameID = nameTableData.readUInt16BE(recordOffset + 6);
          const length = nameTableData.readUInt16BE(recordOffset + 8);
          const offset = nameTableData.readUInt16BE(recordOffset + 10);
          const recordStart = stringDataOffset + offset;
          if (recordStart + length <= nameTableData.length) {
            if (nameID === 1 && platformID === 3 && encodingID === 1) {
              if (isCFF) {
                const rawBuffer = nameTableData.slice(recordStart, recordStart + length);
                const fontName2 = _decodeUtf16BE(rawBuffer);
                return _hasMicrosoftLicense(nameTableData) ? fontName2 : null;
              }
              const fontName = nameTableData.toString("utf16be", recordStart, recordStart + length);
              return _hasMicrosoftLicense(nameTableData) ? fontName : null;
            }
            if (nameID === 16 && platformID === 3 && encodingID === 1) {
              if (isCFF) {
                const rawBuffer = nameTableData.slice(recordStart, recordStart + length);
                const fontName2 = _decodeUtf16BE(rawBuffer);
                return _hasMicrosoftLicense(nameTableData) ? fontName2 : null;
              }
              const fontName = nameTableData.toString("utf16be", recordStart, recordStart + length);
              return _hasMicrosoftLicense(nameTableData) ? fontName : null;
            }
          }
        }
      } catch (e) {
        return null;
      }
      return null;
    };
    var _requireElectron = () => {
      try {
        return require("electron");
      } catch (e) {
        return null;
      }
    };
    var _isContextIsolationEnabled = (electron) => {
      const el = electron || _requireElectron();
      if (!el) return false;
      try {
        if (typeof process !== "undefined" && typeof process.contextIsolated === "boolean") {
          return process.contextIsolated;
        }
      } catch (e) {
      }
      if (el.__contextIsolationEnabled === true) return true;
      if (el.__contextIsolationEnabled === false) return false;
      return false;
    };
    var _isDevBuild = () => {
      try {
        const version = readPluginVersionFromManifest();
        return typeof version === "string" && version.includes("-");
      } catch (e) {
        return false;
      }
    };
    var _exposeApisToPage = (apiNames, name) => {
      if (typeof window === "undefined") return;
      const electron = _requireElectron();
      const contextBridge = electron && electron.contextBridge;
      if (!contextBridge || typeof contextBridge.exposeInMainWorld !== "function") {
        return;
      }
      if (!_isContextIsolationEnabled(electron)) {
        return;
      }
      const bridged = {};
      const missing = [];
      for (const apiName of apiNames) {
        const api = window[apiName];
        if (api === void 0) {
          missing.push(apiName);
          continue;
        }
        bridged[apiName] = api;
      }
      try {
        contextBridge.exposeInMainWorld("__imageToolboxApi", bridged);
      } catch (e) {
        const detail = e && e.message ? e.message : e;
        if (_isDevBuild()) {
          console.error(`[${name} preload] contextBridge 暴露 API 失败（将回退到直接赋值）:`, detail);
        } else {
          console.warn(`[${name} preload] contextBridge 暴露 API 失败（将回退到直接赋值）:`, detail);
        }
        return;
      }
      window.__imageToolboxApiBridge = bridged;
      if (missing.length > 0 && _bridgingComplete) {
        console.warn(`[${name} preload] 以下 API 未注册，未桥接到页面:`, missing.join(", "));
      }
    };
    var _bridgingComplete = false;
    var _markBridgingComplete = () => {
      _bridgingComplete = true;
    };
    var PAGE_API_NAMES = [
      // 版本 / 宿主信息
      "getPluginPath",
      "getHostAppVersion",
      "getHostName",
      "getHostVersion",
      "getHostAppInfo",
      "getPluginVersion",
      // 文件对话框与读写
      "showOpenImageDialog",
      "showSaveImageDialog",
      "showOpenDialog",
      "showSaveOraDialog",
      "readImageFile",
      "writeImageFile",
      "readBinaryFile",
      "writeBinaryFile",
      // 剪贴板
      "copyImageToClipboard",
      // 外部链接
      "openHostExternal",
      // 存储
      "getHostStorage",
      // 窗口控制
      "setPluginWindowHeight",
      "setPluginWindowTitle",
      // 字体
      "getSystemFonts",
      "getSystemFontsAsync",
      "getFontsDirectory",
      "detectFontName",
      "isFontInstalled",
      "installFont",
      // 用户
      "getHostUser",
      // uTools 一键登录（只暴露这一个能力，不暴露宿主对象本身）
      "fetchUserServerTemporaryToken",
      // 插件载荷
      "getImageSourceFromPluginPayload"
    ];
    var initPreload = (platform) => {
      if (typeof window === "undefined") return;
      window.getPluginPath = () => {
        try {
          return path.dirname(__dirname);
        } catch (e) {
          return "";
        }
      };
      setupImageDialog(platform);
      setupClipboard();
      setupExternalLink(platform);
      setupStorage();
      setupWindowControl();
      setupFontTools(platform);
      setupUserAPI(platform);
      setupMiscAPIs(platform);
      _exposeApisToPage(PAGE_API_NAMES, platform.getName());
    };
    var setupImageDialog = (platform) => {
      if (typeof window === "undefined") return;
      window.showOpenImageDialog = () => {
        const hostTools = getHostTools();
        if (!hostTools || typeof hostTools.showOpenDialog !== "function") return null;
        try {
          const result = hostTools.showOpenDialog({
            properties: ["openFile"],
            filters: [
              { name: "图片和工程文件", extensions: ["ora", "png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"] },
              { name: "OpenRaster 工程文件", extensions: ["ora"] },
              { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"] }
            ]
          });
          const selectedFile = _extractAndAllowDialogPath(result);
          if (selectedFile) {
            return selectedFile;
          }
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 打开图片选择失败:`, e);
        }
        return null;
      };
      window.showSaveImageDialog = (suggestedName = "edited.png", format = null) => {
        const hostTools = getHostTools();
        if (!hostTools || typeof hostTools.showSaveDialog !== "function") return null;
        try {
          const defaultPath = _buildDefaultSavePath(suggestedName, "edited.png");
          const allFilters = {
            png: { name: "PNG 图片", extensions: ["png"] },
            jpg: { name: "JPEG 图片", extensions: ["jpg", "jpeg"] },
            jpeg: { name: "JPEG 图片", extensions: ["jpg", "jpeg"] },
            webp: { name: "WebP 图片", extensions: ["webp"] },
            ora: { name: "OpenRaster 工程文件", extensions: ["ora"] }
          };
          const filters = format && allFilters[format.toLowerCase()] ? [allFilters[format.toLowerCase()], { name: "所有文件", extensions: ["*"] }] : [
            { name: "PNG 图片", extensions: ["png"] },
            { name: "JPEG 图片", extensions: ["jpg", "jpeg"] },
            { name: "WebP 图片", extensions: ["webp"] },
            { name: "OpenRaster 工程文件", extensions: ["ora"] },
            { name: "所有文件", extensions: ["*"] }
          ];
          const result = hostTools.showSaveDialog({
            title: "保存图片",
            defaultPath,
            filters
          });
          const savedPath = _extractAndAllowDialogPath(result);
          if (savedPath) {
            return savedPath;
          }
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 保存图片失败:`, e);
        }
        return null;
      };
      window.readImageFile = (filePath) => {
        if (!filePath || typeof filePath !== "string") return null;
        if (!_isPathAllowedForRead(filePath)) {
          console.warn(`[${platform.getName()} preload] 拒绝读取未授权路径`);
          return null;
        }
        try {
          const cleanedPath = filePath.replace(/^file:\/\//, "");
          if (!fs.existsSync(cleanedPath)) return null;
          const data = fs.readFileSync(cleanedPath);
          if (!data || data.length === 0) return null;
          const mimeType = _detectImageMime(data);
          const base64 = data.toString("base64");
          return `data:${mimeType};base64,${base64}`;
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 读取图片文件失败:`, e);
          return null;
        }
      };
      window.writeImageFile = (filePath, dataUrl) => {
        if (!filePath || typeof filePath !== "string") return false;
        if (!dataUrl || typeof dataUrl !== "string") return false;
        if (!_isPathAllowedForWrite(filePath)) {
          console.warn(`[${platform.getName()} preload] 拒绝写入未授权路径`);
          return false;
        }
        if (!WRITABLE_EXTENSIONS.has(path.extname(filePath.replace(/^file:\/\//, "")).toLowerCase())) {
          console.warn(`[${platform.getName()} preload] 拒绝写入非允许的扩展名`);
          return false;
        }
        try {
          const cleanedPath = filePath.replace(/^file:\/\//, "");
          const dirName = path.dirname(cleanedPath);
          if (dirName && !/^[a-zA-Z]:\\?$/.test(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
          }
          const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
          if (base64Match) {
            const base64Data = base64Match[2];
            fs.writeFileSync(cleanedPath, Buffer.from(base64Data, "base64"));
            return true;
          }
          return false;
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 保存图片失败:`, e);
          return false;
        }
      };
    };
    var setupClipboard = () => {
      if (typeof window === "undefined") return;
      window.copyImageToClipboard = (dataUrl) => {
        if (!dataUrl) return false;
        try {
          const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
          if (base64Match) {
            const imageBuffer = Buffer.from(base64Match[2], "base64");
            const image = nativeImage.createFromBuffer(imageBuffer);
            clipboard.writeImage(image);
            return true;
          }
          return false;
        } catch (e) {
          console.warn("[preload] 复制图片到剪贴板失败:", e);
          return false;
        }
      };
    };
    var setupExternalLink = (platform) => {
      if (typeof window === "undefined") return;
      const ALLOWED_EXTERNAL_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
      window.openHostExternal = (url) => {
        if (!url || typeof url !== "string") return false;
        let parsed;
        try {
          parsed = new URL(url);
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 拒绝打开无法解析的外部链接`);
          return false;
        }
        if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
          console.warn(`[${platform.getName()} preload] 拒绝打开非 http(s) 链接:`, parsed.protocol);
          return false;
        }
        try {
          const hostTools = getHostTools();
          if (hostTools && typeof hostTools.shellOpenExternal === "function") {
            hostTools.shellOpenExternal(url);
            return true;
          }
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 打开外部链接失败:`, e);
        }
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      };
    };
    var setupStorage = () => {
      if (typeof window === "undefined") return;
      window.getHostStorage = () => {
        const hostTools = getHostTools();
        if (!hostTools || typeof hostTools.dbStorage !== "object" || hostTools.dbStorage === null) {
          return null;
        }
        return {
          getItem: (key) => {
            try {
              return hostTools.dbStorage.getItem(key);
            } catch (e) {
              console.warn("[preload] 获取存储失败:", e);
              return null;
            }
          },
          setItem: (key, value) => {
            try {
              hostTools.dbStorage.setItem(key, value);
              return true;
            } catch (e) {
              console.warn("[preload] 设置存储失败:", e);
              return false;
            }
          },
          removeItem: (key) => {
            try {
              hostTools.dbStorage.removeItem(key);
              return true;
            } catch (e) {
              console.warn("[preload] 删除存储失败:", e);
              return false;
            }
          }
        };
      };
    };
    var setupWindowControl = () => {
      if (typeof window === "undefined") return;
      window.setPluginWindowHeight = (height) => {
        try {
          const hostTools = getHostTools();
          if (hostTools && typeof hostTools.setExpendHeight === "function") {
            hostTools.setExpendHeight(height);
            return true;
          }
        } catch (e) {
          console.warn("[preload] 设置窗口高度失败:", e);
        }
        return false;
      };
      window.setPluginWindowTitle = (title) => {
        try {
          const hostTools = getHostTools();
          if (hostTools && typeof hostTools.setMainWindowTitle === "function") {
            hostTools.setMainWindowTitle(title);
            return true;
          }
        } catch (e) {
          console.warn("[preload] 设置窗口标题失败:", e);
        }
        return false;
      };
    };
    var setupFontTools = (platform) => {
      if (typeof window === "undefined") return;
      window.getSystemFonts = () => {
        if (_isWindows) return _getSystemFontsWindows();
        if (_isMacOS) return _getSystemFontsMacOS();
        return _getSystemFontsLinux();
      };
      window.getSystemFontsAsync = () => {
        return new Promise((resolve) => {
          setTimeout(() => {
            try {
              resolve(window.getSystemFonts());
            } catch (e) {
              console.warn("[preload] 异步获取系统字体失败:", e);
              resolve([]);
            }
          }, 0);
        });
      };
      const _allowReadDir = (dir) => {
        const normalized = _normalizeFsPath(dir);
        if (normalized) _allowedReadDirs.add(normalized);
      };
      window.getFontsDirectory = () => {
        if (_isWindows) {
          try {
            const fontsDir = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
            _allowReadDir(fontsDir);
            return [fontsDir];
          } catch {
            return [];
          }
        }
        if (_isMacOS) {
          const dirs = ["/Library/Fonts", "/System/Library/Fonts", path.join(os.homedir(), "Library/Fonts")];
          dirs.forEach(_allowReadDir);
          return dirs;
        }
        try {
          const result = execFileSync("fc-list", ["-s"], { encoding: "utf-8", stdio: "pipe", timeout: 5e3 });
          const fonts = /* @__PURE__ */ new Set();
          const lines = result.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && trimmed.length > 0) {
              fonts.add(trimmed);
              try {
                if (fs.statSync(trimmed).isDirectory()) {
                  _allowReadDir(trimmed);
                }
              } catch (e) {
              }
            }
          }
          return Array.from(fonts);
        } catch (e) {
          console.warn("[preload] 获取字体目录失败:", e);
          return [];
        }
      };
      window.detectFontName = (filePath) => {
        if (!filePath || typeof filePath !== "string") return null;
        if (!_isPathAllowedForRead(filePath)) {
          console.warn("[preload] 拒绝读取未授权字体路径");
          return null;
        }
        try {
          const cleanedPath = filePath.replace(/^file:\/\//, "");
          if (!fs.existsSync(cleanedPath)) return null;
          const fontBuffer = _readBuffer(cleanedPath);
          if (!fontBuffer) return null;
          return _getFontNameFromBuffer(fontBuffer, cleanedPath);
        } catch (e) {
          console.warn("[preload] 检测字体名称失败:", e);
          return null;
        }
      };
      window.isFontInstalled = (fontName) => {
        if (_isWindows) {
          try {
            const fonts = window.getSystemFonts();
            return fonts.some((f) => f.toLowerCase() === (fontName || "").toLowerCase());
          } catch {
            return false;
          }
        }
        if (_isMacOS) {
          try {
            const fonts = window.getSystemFonts();
            return fonts.some((f) => f.toLowerCase() === (fontName || "").toLowerCase());
          } catch {
            return false;
          }
        }
        try {
          const result = execFileSync("fc-list", [fontName], { encoding: "utf-8", stdio: "pipe", timeout: 5e3 });
          return result.length > 0;
        } catch (e) {
          return false;
        }
      };
      window.installFont = (filePath) => {
        if (!filePath || typeof filePath !== "string") return false;
        if (!_isPathAllowedForRead(filePath)) {
          console.warn("[preload] 拒绝安装未授权路径的字体");
          return false;
        }
        if (!_isFontFile(filePath)) {
          console.warn("[preload] 拒绝安装非字体文件");
          return false;
        }
        if (!_hasFontMagic(filePath)) {
          console.warn("[preload] 拒绝安装内容非字体的文件");
          return false;
        }
        try {
          const cleanedPath = filePath.replace(/^file:\/\//, "");
          if (!fs.existsSync(cleanedPath)) return false;
          let userFontsDir;
          if (_isWindows) {
            userFontsDir = path.join(process.env.LOCALAPPDATA || os.homedir(), "Microsoft", "Windows", "Fonts");
          } else if (_isMacOS) {
            userFontsDir = path.join(os.homedir(), "Library", "Fonts");
          } else {
            userFontsDir = path.join(os.homedir(), ".fonts");
          }
          fs.mkdirSync(userFontsDir, { recursive: true });
          const fileName = path.basename(cleanedPath);
          const destPath = path.join(userFontsDir, fileName);
          fs.copyFileSync(cleanedPath, destPath);
          if (_isLinux) {
            try {
              execFileSync("fc-cache", ["-f"], { timeout: 1e4 });
            } catch (e) {
              console.warn("[preload] 字体缓存更新失败:", e);
            }
          }
          return true;
        } catch (e) {
          console.warn("[preload] 安装字体失败:", e);
          return false;
        }
      };
    };
    var setupUserAPI = (platform) => {
      if (typeof window === "undefined") return;
      window.getHostUser = () => {
        const hostTools = getHostTools();
        if (!hostTools) return null;
        try {
          if (typeof hostTools.getUser === "function") return hostTools.getUser();
          if (typeof hostTools.getUserInfo === "function") return hostTools.getUserInfo();
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 获取宿主用户失败:`, e);
        }
        return null;
      };
      window.fetchUserServerTemporaryToken = async () => {
        const hostTools = getHostTools();
        if (!hostTools || typeof hostTools.fetchUserServerTemporaryToken !== "function") {
          return null;
        }
        try {
          return await hostTools.fetchUserServerTemporaryToken();
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 获取临时 token 失败:`, e);
          return null;
        }
      };
    };
    var setupMiscAPIs = (platform) => {
      if (typeof window === "undefined") return;
      const _sanitizeOpenDialogOptions = (options) => {
        if (!options || typeof options !== "object" || Array.isArray(options)) return {};
        const safe = {};
        if (Array.isArray(options.properties)) {
          safe.properties = options.properties.filter((p) => typeof p === "string").slice(0, 8);
        }
        if (Array.isArray(options.filters)) {
          safe.filters = options.filters.filter((f) => f && typeof f === "object").map((f) => ({
            name: String(f.name || "").slice(0, 64),
            extensions: Array.isArray(f.extensions) ? f.extensions.filter((x) => typeof x === "string").map((x) => x.slice(0, 16)).slice(0, 32) : []
          })).slice(0, 8);
        }
        return safe;
      };
      window.showOpenDialog = (options) => {
        const hostTools = getHostTools();
        if (!hostTools || typeof hostTools.showOpenDialog !== "function") return null;
        try {
          const raw = hostTools.showOpenDialog(_sanitizeOpenDialogOptions(options)) || null;
          _extractAndAllowDialogPath(raw);
          return _extractDialogPaths(raw);
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 打开文件对话框失败:`, e);
          return null;
        }
      };
      window.readBinaryFile = (filePath) => {
        if (!filePath || typeof filePath !== "string") return null;
        if (!_isPathAllowedForRead(filePath)) {
          console.warn(`[${platform.getName()} preload] 拒绝读取未授权路径`);
          return null;
        }
        try {
          const cleanedPath = filePath.replace(/^file:\/\//, "");
          if (!fs.existsSync(cleanedPath)) return null;
          const buffer = fs.readFileSync(cleanedPath);
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 读取二进制文件失败:`, e);
          return null;
        }
      };
      window.writeBinaryFile = (filePath, data) => {
        if (!filePath || typeof filePath !== "string") return false;
        if (!_isPathAllowedForWrite(filePath)) {
          console.warn(`[${platform.getName()} preload] 拒绝写入未授权路径`);
          return false;
        }
        if (!WRITABLE_EXTENSIONS.has(path.extname(filePath.replace(/^file:\/\//, "")).toLowerCase())) {
          console.warn(`[${platform.getName()} preload] 拒绝写入非允许的扩展名`);
          return false;
        }
        try {
          const cleanedPath = filePath.replace(/^file:\/\//, "");
          const dirName = path.dirname(cleanedPath);
          if (dirName && !/^[a-zA-Z]:\\?$/.test(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
          }
          let buffer;
          if (typeof data === "string") {
            const base64Match = data.match(/^data:[^;]+;base64,(.+)$/i);
            if (base64Match) {
              buffer = Buffer.from(base64Match[1], "base64");
            } else {
              buffer = Buffer.from(data, "base64");
            }
          } else if (data instanceof ArrayBuffer) {
            buffer = Buffer.from(data);
          } else if (data instanceof Uint8Array) {
            buffer = Buffer.from(data);
          } else {
            return false;
          }
          fs.writeFileSync(cleanedPath, buffer);
          return true;
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 写入二进制文件失败:`, e);
          return false;
        }
      };
      window.showSaveOraDialog = (suggestedName = "project.ora") => {
        const hostTools = getHostTools();
        if (!hostTools || typeof hostTools.showSaveDialog !== "function") return null;
        try {
          const defaultPath = _buildDefaultSavePath(suggestedName, "project.ora");
          const result = hostTools.showSaveDialog({
            title: "保存 ORA 工程文件",
            defaultPath,
            filters: [
              { name: "OpenRaster 工程文件", extensions: ["ora"] },
              { name: "所有文件", extensions: ["*"] }
            ]
          });
          const savedPath = _extractAndAllowDialogPath(result);
          if (savedPath) {
            return savedPath;
          }
        } catch (e) {
          console.warn(`[${platform.getName()} preload] 保存 ORA 文件失败:`, e);
        }
        return null;
      };
      window.getImageSourceFromPluginPayload = (type, payload) => {
        if (type === "img" && payload) {
          if (typeof payload === "string" && payload.startsWith("data:")) {
            return payload;
          }
          const imgPayload = Array.isArray(payload) ? payload : [payload];
          for (const item of imgPayload) {
            const dataURL = item && typeof item === "object" ? item.dataURL || item.dataUrl || item.base64 || item.content : null;
            if (dataURL && typeof dataURL === "string" && dataURL.startsWith("data:")) return dataURL;
          }
          return null;
        }
        if (type === "files" || type === "file") {
          const files = Array.isArray(payload) ? payload : [payload];
          for (const fileInfo of files) {
            if (fileInfo && fileInfo.path) {
              const cleanedPath = fileInfo.path.replace(/^file:\/\//, "");
              if (fs.existsSync(cleanedPath)) {
                try {
                  const data = fs.readFileSync(cleanedPath);
                  const mimeType = _detectImageMime(data);
                  const base64 = data.toString("base64");
                  return `data:${mimeType};base64,${base64}`;
                } catch (e) {
                  console.warn(`[${platform.getName()} preload] 读取图片文件失败:`, e);
                }
              }
            }
          }
        }
        return null;
      };
    };
    var getHostTools = () => {
      if (typeof window === "undefined") return null;
      return window.hostTools || window.ztools || window.utools || (typeof globalThis !== "undefined" ? globalThis.ztools || globalThis.utools : null) || null;
    };
    var getHostPath = (name) => {
      const hostTools = getHostTools();
      try {
        if (hostTools && typeof hostTools.getPath === "function") return hostTools.getPath(name);
      } catch (e) {
        console.warn("[preload] 获取宿主路径失败:", e);
      }
      return "";
    };
    var getHostAppVersion = () => {
      const hostTools = getHostTools();
      try {
        if (hostTools && typeof hostTools.getAppVersion === "function") return hostTools.getAppVersion();
        if (hostTools && typeof hostTools.getVersion === "function") return hostTools.getVersion();
        if (hostTools && typeof hostTools.getPluginVersion === "function") return hostTools.getPluginVersion();
      } catch (e) {
        console.warn("[preload] 获取宿主版本失败:", e);
      }
      return "unknown";
    };
    var findPluginRoot = () => {
      let dir = __dirname;
      for (let depth = 0; depth < 5; depth += 1) {
        try {
          if (fs.existsSync(path.join(dir, "plugin.json"))) return dir;
        } catch (e) {
          return "";
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return "";
    };
    var readPluginVersionFromManifest = () => {
      try {
        const pluginRoot = findPluginRoot();
        if (!pluginRoot) return "";
        const manifestPath = path.join(pluginRoot, "plugin.json");
        if (!fs.existsSync(manifestPath)) return "";
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        return manifest && manifest.version ? String(manifest.version).trim() : "";
      } catch (e) {
        console.warn("[preload] 读取 plugin.json 版本失败:", e);
        return "";
      }
    };
    var getHostVersion = () => getHostAppVersion();
    var getHostAppInfo = () => {
      const hostTools = getHostTools();
      if (!hostTools) return { name: _getHostName(), version: "unknown", platform: process.platform };
      try {
        if (typeof hostTools.getAppVersion === "function") return { name: _getHostName(), version: hostTools.getAppVersion(), platform: process.platform };
        if (typeof hostTools.getVersion === "function") return { name: _getHostName(), version: hostTools.getVersion(), platform: process.platform };
      } catch (e) {
        console.warn("[preload] 获取宿主信息失败:", e);
      }
      return { name: _getHostName(), version: "unknown", platform: process.platform };
    };
    var _getHostName = () => {
      const hostTools = getHostTools();
      try {
        if (hostTools && typeof hostTools.getAppName === "function") {
          const name = hostTools.getAppName();
          if (name) return String(name);
        }
      } catch (e) {
        console.warn("[preload] 获取宿主名称失败:", e);
      }
      return "宿主";
    };
    var createPlatformConfig = (opts) => {
      const { name, apiKeys, userFnName, contactUrl } = opts;
      const getHostTools2 = () => {
        if (typeof window === "undefined") return null;
        for (const key of apiKeys) {
          if (window[key]) return window[key];
        }
        if (typeof globalThis !== "undefined") {
          for (const key of apiKeys) {
            if (globalThis[key]) return globalThis[key];
          }
        }
        return null;
      };
      const getHostAppVersion2 = () => {
        const api = getHostTools2();
        if (api && typeof api.getAppVersion === "function") return api.getAppVersion();
        if (api && typeof api.getVersion === "function") return api.getVersion();
        if (api && typeof api.getPluginVersion === "function") return api.getPluginVersion();
        return "unknown";
      };
      const platform = {
        getName: () => name,
        getApiKeys: () => apiKeys,
        getUserFnName: () => userFnName,
        getContactUrl: () => contactUrl,
        onPluginEnter: (callback) => {
          const api = getHostTools2();
          if (api && typeof api.onPluginEnter === "function") {
            api.onPluginEnter(callback);
          }
          return () => {
          };
        },
        onPluginOut: (callback) => {
          const api = getHostTools2();
          if (api && typeof api.onPluginOut === "function") {
            api.onPluginOut(callback);
          }
          return () => {
          };
        },
        openExternal: (url) => {
          const api = getHostTools2();
          if (api && typeof api.shellOpenExternal === "function") {
            api.shellOpenExternal(url);
            return true;
          }
          if (typeof window !== "undefined") {
            window.open(url, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        }
      };
      return { platform, getHostTools: getHostTools2, getHostAppVersion: getHostAppVersion2 };
    };
    var initPlatformPreload2 = (opts) => {
      const { name, userFnName } = opts;
      const { platform, getHostTools: getHostTools2, getHostAppVersion: getHostAppVersion2 } = createPlatformConfig(opts);
      initPreload(platform);
      window.getHostAppVersion = getHostAppVersion2;
      window.getHostName = () => name;
      window.getPluginVersion = () => {
        const fromManifest = readPluginVersionFromManifest();
        if (fromManifest) return fromManifest;
        const api2 = getHostTools2();
        try {
          if (api2 && typeof api2.getPluginVersion === "function") {
            const version = api2.getPluginVersion();
            if (version) return String(version);
          }
        } catch (e) {
          console.warn(`[${name} preload] 获取插件版本失败:`, e);
        }
        return "";
      };
      window[userFnName] = () => {
        const api2 = getHostTools2();
        if (!api2) return null;
        try {
          if (typeof api2.getUser === "function") return api2.getUser();
          if (typeof api2.getUserInfo === "function") return api2.getUserInfo();
        } catch (e) {
          console.warn(`[${name} preload] 获取宿主用户失败:`, e);
        }
        return null;
      };
      window.__pluginEnterAction = null;
      const api = getHostTools2();
      if (api && typeof api.onPluginEnter === "function") {
        api.onPluginEnter((action) => {
          console.log(`[${name} preload] onPluginEnter:`, action);
          window.__pluginEnterAction = action;
          if (action.code === "image-edit") {
            const source = window.getImageSourceFromPluginPayload ? window.getImageSourceFromPluginPayload(action.type, action.payload) : null;
            if (source) {
              window.__imageSource = source;
            } else if (action.type === "img" && window.__imageSource) {
            }
            if (api && typeof api.setExpendHeight === "function") {
              api.setExpendHeight(560);
            }
          }
        });
      }
      _markBridgingComplete();
      _exposeApisToPage([...PAGE_API_NAMES, userFnName], name);
    };
    module2.exports = {
      initPreload,
      initPlatformPreload: initPlatformPreload2,
      createPlatformConfig,
      setupImageDialog,
      setupClipboard,
      setupExternalLink,
      setupStorage,
      setupWindowControl,
      setupFontTools,
      setupUserAPI,
      setupMiscAPIs,
      getHostTools,
      getHostPath,
      getHostAppVersion,
      getHostVersion,
      getHostAppInfo,
      readPluginVersionFromManifest,
      findPluginRoot,
      _getHostName
    };
  }
});

// clients/ztools/preload.js
var { initPlatformPreload } = require_preloadHelpers();
if (typeof window !== "undefined") {
  initPlatformPreload({
    name: "ZTools",
    // 仅保留 ZTools 自有 API 键：不得把 uTools 的全局对象当作兜底，
    // 否则会把 ZTools API 别名成 window.utools，导致页面侧平台判定错配。
    apiKeys: ["hostTools", "ztools"],
    userFnName: "getZtoolsUser",
    contactUrl: "https://qm.qq.com/q/xdx9hstuGA"
  });
}
