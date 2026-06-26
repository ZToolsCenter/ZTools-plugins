const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { fileURLToPath } = require('url');
const { clipboard, nativeImage } = require('electron');

const _getHostTools = () => {
  if (typeof window === 'undefined') return null;

  const api = window.hostTools
    || window.ztools
    || window.utools
    || (typeof globalThis !== 'undefined' ? (globalThis.ztools || globalThis.utools) : null)
    || null;

  if (api) {
    window.hostTools = api;
  }

  return api;
};

const _getHostName = () => {
  const hostTools = _getHostTools();

  try {
    if (hostTools && typeof hostTools.getAppName === 'function') {
      const name = hostTools.getAppName();
      if (name) return String(name);
    }
  } catch (e) {
    console.warn('[preload] 获取宿主名称失败:', e);
  }

  if (typeof window !== 'undefined') {
    if (window.ztools) return 'ZTools';
    if (window.utools) return 'uTools';
  }

  return '宿主';
};

const _getHostPath = (name) => {
  const hostTools = _getHostTools();
  try {
    if (hostTools && typeof hostTools.getPath === 'function') return hostTools.getPath(name);
  } catch (e) {
    console.warn('[preload] 获取宿主路径失败:', e);
  }

  return null;
};

const _setHostExpendHeight = (height) => {
  const hostTools = _getHostTools();
  try {
    if (hostTools && typeof hostTools.setExpendHeight === 'function') {
      hostTools.setExpendHeight(height);
    }
  } catch (e) {
    console.warn('[preload] 设置宿主窗口高度失败:', e);
  }
};

window.hostTools = _getHostTools();
window.getHostName = _getHostName;

const MIME_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
let _systemFontsCache = null;
let _systemFontsPromise = null;

// ── 文件操作 ──
window.readImageFile = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = MIME_MAP[ext] || 'image/png';
  return 'data:' + mime + ';base64,' + buffer.toString('base64');
};

// ── 系统字体（同步版本，向后兼容）──
window.getSystemFonts = () => {
  if (_systemFontsCache) return _systemFontsCache.slice();

  try {
    _systemFontsCache = _loadSystemFonts();
  } catch (e) {
    console.error('[preload] 获取系统字体失败:', e);
    _systemFontsCache = [];
  }

  return _systemFontsCache.slice();
};

// ── 系统字体（异步版本，不阻塞UI）──
window.getSystemFontsAsync = () => {
  if (_systemFontsCache) return Promise.resolve(_systemFontsCache.slice());
  if (_systemFontsPromise) return _systemFontsPromise;

  _systemFontsPromise = new Promise((resolve) => {
    setTimeout(() => {
      try {
        _systemFontsCache = _loadSystemFonts();
      } catch (e) {
        console.error('[preload] 异步获取系统字体失败:', e);
        _systemFontsCache = [];
      }
      resolve(_systemFontsCache.slice());
    }, 0);
  });

  return _systemFontsPromise;
};

const _loadSystemFonts = () => {
  const families = new Map();

  _getSystemFontFiles().forEach((filePath) => {
    try {
      _readFontFamilies(filePath).forEach((family) => {
        const key = _normalizeFontName(family);
        if (key && !families.has(key)) families.set(key, family);
      });
    } catch (e) {
      // 个别系统字体可能是旧格式或权限受限，跳过不影响其它字体。
    }
  });

  return Array.from(families.values()).sort((a, b) => (
    a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
  ));
};

const _getSystemFontFiles = () => {
  const files = new Set();
  const fontDirs = _getSystemFontDirs();

  fontDirs.forEach((dir) => _collectFontFiles(dir, files));
  _getRegisteredFontFiles(fontDirs).forEach((filePath) => {
    if (_isFontFile(filePath) && fs.existsSync(filePath)) files.add(filePath);
  });

  return Array.from(files);
};

const _getSystemFontDirs = () => {
  const dirs = [];
  const homeDir = os.homedir();

  if (process.platform === 'win32') {
    const windowsDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    dirs.push(
      path.join(windowsDir, 'Fonts'),
      path.join(localAppData, 'Microsoft', 'Windows', 'Fonts')
    );
  } else if (process.platform === 'darwin') {
    dirs.push(
      '/System/Library/Fonts',
      '/Library/Fonts',
      path.join(homeDir, 'Library', 'Fonts')
    );
  } else {
    dirs.push(
      '/usr/share/fonts',
      '/usr/local/share/fonts',
      path.join(homeDir, '.fonts'),
      path.join(homeDir, '.local', 'share', 'fonts')
    );
  }

  const seen = new Set();
  return dirs.filter((dir) => {
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key) || !fs.existsSync(dir)) return false;
    seen.add(key);
    return true;
  });
};

const _collectFontFiles = (dir, files, depth = 0) => {
  if (depth > 8) return;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }

  entries.forEach((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _collectFontFiles(filePath, files, depth + 1);
    } else if (entry.isFile() && _isFontFile(entry.name)) {
      files.add(filePath);
    }
  });
};

const _getRegisteredFontFiles = (fontDirs) => {
  if (process.platform !== 'win32') return [];

  const files = new Set();
  const registryKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ];

  registryKeys.forEach((key) => {
    let output = '';
    try {
      output = execFileSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true });
    } catch (e) {
      return;
    }

    output.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s+.+?\s+REG_\w+\s+(.+?)\s*$/);
      if (!match) return;

      const rawPath = _expandEnvPath(match[1].trim());
      if (!_isFontFile(rawPath)) return;

      if (path.isAbsolute(rawPath)) {
        files.add(rawPath);
        return;
      }

      fontDirs.forEach((dir) => files.add(path.join(dir, rawPath)));
    });
  });

  return Array.from(files);
};

const _expandEnvPath = (value) => {
  return String(value || '').replace(/%([^%]+)%/g, (_, name) => (
    process.env[name] || process.env[name.toUpperCase()] || ''
  ));
};

const _readFontFamilies = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const families = [];

  _getFontOffsets(buffer).forEach((offset) => {
    const family = _readSfntFamily(buffer, offset);
    if (family) families.push(family);
  });

  return families;
};

const _getFontOffsets = (buffer) => {
  if (buffer.length < 12) return [];

  if (buffer.toString('ascii', 0, 4) === 'ttcf') {
    const count = _readUInt32(buffer, 8);
    const offsets = [];
    for (let i = 0; i < count; i++) {
      const offset = _readUInt32(buffer, 12 + i * 4);
      if (offset > 0 && offset < buffer.length) offsets.push(offset);
    }
    return offsets;
  }

  return [0];
};

const _readSfntFamily = (buffer, sfntOffset) => {
  if (!_isSfnt(buffer, sfntOffset)) return null;

  const numTables = _readUInt16(buffer, sfntOffset + 4);
  const tableDir = sfntOffset + 12;
  let nameOffset = 0;
  let nameLength = 0;

  for (let i = 0; i < numTables; i++) {
    const recordOffset = tableDir + i * 16;
    if (recordOffset + 16 > buffer.length) break;
    if (buffer.toString('ascii', recordOffset, recordOffset + 4) !== 'name') continue;

    nameOffset = _readUInt32(buffer, recordOffset + 8);
    nameLength = _readUInt32(buffer, recordOffset + 12);
    break;
  }

  if (!nameOffset || nameOffset + 6 > buffer.length) return null;
  return _pickFontFamilyName(_readNameRecords(buffer, nameOffset, nameLength));
};

const _isSfnt = (buffer, offset) => {
  if (offset + 12 > buffer.length) return false;
  const tag = buffer.toString('ascii', offset, offset + 4);
  const version = _readUInt32(buffer, offset);
  return version === 0x00010000 || tag === 'OTTO' || tag === 'true' || tag === 'typ1';
};

const _readNameRecords = (buffer, tableOffset, tableLength) => {
  const count = _readUInt16(buffer, tableOffset + 2);
  const stringBase = tableOffset + _readUInt16(buffer, tableOffset + 4);
  const tableEnd = tableLength ? Math.min(buffer.length, tableOffset + tableLength) : buffer.length;
  const records = [];

  for (let i = 0; i < count; i++) {
    const recordOffset = tableOffset + 6 + i * 12;
    if (recordOffset + 12 > buffer.length) break;

    const platformID = _readUInt16(buffer, recordOffset);
    const languageID = _readUInt16(buffer, recordOffset + 4);
    const nameID = _readUInt16(buffer, recordOffset + 6);
    if (nameID !== 16 && nameID !== 1 && nameID !== 21) continue;

    const length = _readUInt16(buffer, recordOffset + 8);
    const offset = _readUInt16(buffer, recordOffset + 10);
    const start = stringBase + offset;
    const end = start + length;
    if (start < stringBase || end > tableEnd || end > buffer.length) continue;

    const name = _cleanFontName(_decodeFontName(buffer.slice(start, end), platformID));
    if (name) records.push({ name, nameID, platformID, languageID });
  }

  return records;
};

const _pickFontFamilyName = (records) => {
  for (const nameID of [16, 1, 21]) {
    const candidates = records.filter((record) => record.nameID === nameID);
    const cjk = candidates.find((record) => _isChineseLanguage(record.languageID) && _hasCjk(record.name))
      || candidates.find((record) => _hasCjk(record.name));
    if (cjk) return cjk.name;

    const english = candidates.find((record) => record.languageID === 0x0409);
    if (english) return english.name;

    const windows = candidates.find((record) => record.platformID === 3);
    if (windows) return windows.name;

    if (candidates[0]) return candidates[0].name;
  }

  return null;
};

const _decodeFontName = (buffer, platformID) => {
  if (platformID === 0 || platformID === 3 || _looksUtf16BE(buffer)) {
    return _decodeUtf16BE(buffer);
  }

  return buffer.toString('latin1');
};

const _decodeUtf16BE = (buffer) => {
  const length = buffer.length - (buffer.length % 2);
  const swapped = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString('utf16le');
};

const _looksUtf16BE = (buffer) => {
  if (buffer.length < 4) return false;
  let zeroBytes = 0;
  for (let i = 0; i < buffer.length; i += 2) {
    if (buffer[i] === 0) zeroBytes++;
  }
  return zeroBytes >= Math.ceil(buffer.length / 4);
};

const _cleanFontName = (value) => {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const _normalizeFontName = (value) => _cleanFontName(value).toLowerCase();

const _isFontFile = (filePath) => FONT_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const _hasCjk = (value) => /[\u2e80-\u9fff]/.test(value);

const _isChineseLanguage = (languageID) => [0x0804, 0x0404, 0x0c04, 0x1004, 0x1404].includes(languageID);

const _readUInt16 = (buffer, offset) => {
  return offset + 2 <= buffer.length ? buffer.readUInt16BE(offset) : 0;
};

const _readUInt32 = (buffer, offset) => {
  return offset + 4 <= buffer.length ? buffer.readUInt32BE(offset) : 0;
};

const _detectImageMime = (buffer) => {
  if (!buffer || buffer.length < 4) return 'image/png';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const start = buffer.toString('utf8', 0, Math.min(buffer.length, 256)).trimStart().toLowerCase();
  if (start.startsWith('<svg') || start.startsWith('<?xml')) return 'image/svg+xml';
  return 'image/png';
};

const _payloadItems = (payload) => {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : [payload];
};

const _toLocalPath = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2048 || /[\r\n]/.test(text)) return null;
  if (/^file:\/\//i.test(text)) {
    try {
      return fileURLToPath(text);
    } catch (e) {
      console.error('[preload] file URL 解析失败:', e);
      return null;
    }
  }
  return text;
};

const _getImagePath = (value) => {
  const filePath = _toLocalPath(value);
  if (!filePath) return null;
  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    if (!MIME_MAP[ext]) return null;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return filePath;
  } catch (e) {
    return null;
  }
};

const _dataURLFromBase64 = (value) => {
  const base64 = value.replace(/\s/g, '');
  try {
    const buffer = Buffer.from(base64, 'base64');
    return 'data:' + _detectImageMime(buffer) + ';base64,' + base64;
  } catch (e) {
    return null;
  }
};

const _dataURLFromBytes = (value) => {
  if (!value) return null;
  let buffer = null;
  if (Buffer.isBuffer(value)) {
    buffer = value;
  } else if (value instanceof ArrayBuffer) {
    buffer = Buffer.from(value);
  } else if (ArrayBuffer.isView(value)) {
    buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (!buffer || buffer.length === 0) return null;
  return 'data:' + _detectImageMime(buffer) + ';base64,' + buffer.toString('base64');
};

const _normalizeImageString = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  if (/^data:image\//i.test(text)) return text;
  if (/^image\/[a-z0-9.+-]+;base64,/i.test(text)) return 'data:' + text;

  const imagePath = _getImagePath(text);
  if (imagePath) {
    try {
      return window.readImageFile(imagePath);
    } catch (e) {
      console.error('[preload] 读取 payload 图片文件失败:', e);
      return null;
    }
  }

  if (/^(https?:|blob:)/i.test(text)) return text;

  if (text.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
    return _dataURLFromBase64(text);
  }

  return null;
};

const _normalizeImagePayload = (payload) => {
  for (const item of _payloadItems(payload)) {
    if (typeof item === 'string') {
      const source = _normalizeImageString(item);
      if (source) return source;
      continue;
    }

    if (!item || typeof item !== 'object') continue;

    if (typeof item.toDataURL === 'function') {
      try {
        const source = item.toDataURL();
        if (source) return source;
      } catch (e) {
        console.error('[preload] payload.toDataURL 失败:', e);
      }
    }

    const candidates = [item.path, item.filePath, item.url, item.src, item.dataURL, item.data, item.base64, item.content];
    for (const candidate of candidates) {
      const source = _normalizeImageString(candidate);
      if (source) return source;
    }
  }

  return null;
};

const _escapeHtmlAttr = (value) => {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

const _decodeHtmlAttr = (value) => {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
};

const _extractImageDataURLFromHTML = (html) => {
  if (typeof html !== 'string' || !html) return null;

  const quotedMatch = html.match(/\bsrc\s*=\s*(["'])(data:image\/[a-z0-9.+-]+;base64,[^"']+)\1/i);
  const unquotedMatch = quotedMatch ? null : html.match(/\bsrc\s*=\s*(data:image\/[a-z0-9.+-]+;base64,[^\s>]+)/i);
  const source = quotedMatch ? quotedMatch[2] : unquotedMatch?.[1];
  return source ? _normalizeImageString(_decodeHtmlAttr(source)) : null;
};

const _readImageDataURLFromClipboardHTML = () => {
  try {
    return _extractImageDataURLFromHTML(clipboard.readHTML());
  } catch (e) {
    console.error('[preload] 读取剪贴板 HTML 图片失败:', e);
    return null;
  }
};

window.getImageSourceFromPluginPayload = (type, payload) => {
  if (type === 'file' || type === 'files') {
    return _normalizeImagePayload(payload);
  }

  if (type === 'img') {
    return _readImageDataURLFromClipboardHTML()
      || _normalizeImagePayload(payload)
      || window.readImageFromClipboard();
  }

  return null;
};

window.writeImageFile = (filePath, dataURL) => {
  const matches = dataURL.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!matches) return false;
  const buffer = Buffer.from(matches[2], 'base64');
  fs.writeFileSync(filePath, buffer);
  return true;
};

// ── 剪贴板操作 ──
window.copyImageToClipboard = (dataURL) => {
  const img = nativeImage.createFromDataURL(dataURL);
  try {
    clipboard.write({
      image: img,
      html: '<img src="' + _escapeHtmlAttr(dataURL) + '" alt="image">',
    });
  } catch (e) {
    console.error('[preload] 写入透明剪贴板图片失败，降级为系统图片格式:', e);
    clipboard.writeImage(img);
  }
};

window.readImageFromClipboard = () => {
  const htmlImage = _readImageDataURLFromClipboardHTML();
  if (htmlImage) return htmlImage;

  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return img.toDataURL();
};

// ── 导出文件对话框 ──
window.showSaveImageDialog = (defaultName) => {
  const hostTools = _getHostTools();
  if (!hostTools || typeof hostTools.showSaveDialog !== 'function') return undefined;

  const baseDir = _getHostPath('pictures') || _getHostPath('desktop') || os.homedir();
  return hostTools.showSaveDialog({
    title: '保存图片',
    defaultPath: path.join(baseDir, defaultName || 'edited'),
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
      { name: 'WebP 图片', extensions: ['webp'] },
    ],
  });
};

// ── 打开文件对话框 ──
window.showOpenImageDialog = () => {
  const hostTools = _getHostTools();
  if (!hostTools || typeof hostTools.showOpenDialog !== 'function') return undefined;

  return hostTools.showOpenDialog({
    title: '选择图片',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
    ],
    properties: ['openFile'],
  });
};

// ── 宿主用户信息 ──
window.getHostUser = () => {
  const hostTools = _getHostTools();
  try {
    if (hostTools && typeof hostTools.getUser === 'function') {
      return hostTools.getUser();
    }
  } catch (e) {
    console.error('[preload] 获取宿主用户信息失败:', e);
  }
  return null;
};

window.getZtoolsUser = window.getHostUser;
window.getUtoolsUser = window.getHostUser;

// ── 插件生命周期 ──
let _pluginLifecycleBound = false;

const _handlePluginEnter = ({ code, type, payload }) => {
  if (code === 'image-edit') {
    let imageSource = null;
    try {
      imageSource = window.getImageSourceFromPluginPayload(type, payload);
    } catch (e) {
      console.error('[preload] 解析外部图片失败:', e);
    }

    // 通过 window 对象将图片源传递给前端
    window.__imageSource = imageSource;

    // 动态调整窗口高度
    _setHostExpendHeight(560);
  }
};

const _registerPluginLifecycle = () => {
  if (_pluginLifecycleBound) return;

  const hostTools = _getHostTools();
  if (!hostTools || typeof hostTools.onPluginEnter !== 'function') return;

  hostTools.onPluginEnter(_handlePluginEnter);
  if (typeof hostTools.onPluginOut === 'function') {
    // 插件退出时清理
    hostTools.onPluginOut(() => {
      window.__imageSource = null;
    });
  }

  _pluginLifecycleBound = true;
  console.log('[preload] 已注册插件生命周期:', _getHostName());
};

_registerPluginLifecycle();
setTimeout(_registerPluginLifecycle, 0);
setTimeout(_registerPluginLifecycle, 100);
