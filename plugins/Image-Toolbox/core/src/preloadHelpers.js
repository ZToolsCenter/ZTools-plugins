/**
 * preloadHelpers.js
 * 跨平台 preload 公共逻辑提取。
 *
 * 两个平台的 preload.js 共享约 600+ 行相同代码，本模块提取了其中
 * 所有平台无关的函数，平台特定逻辑（API 查找优先级等）由各平台文件注入。
 *
 * 使用方式（在 preload.js 中）：
 *   const {
 *     initPreload,
 *     setupImageDialog,
 *     setupClipboard,
 *     setupExternalLink,
 *     setupStorage,
 *     setupWindowControl,
 *     setupFontTools,
 *     setupUserAPI,
 *     setupMiscAPIs,
 *   } = require('../../../core/src/preloadHelpers.js');
 *
 *   // 提供平台特定函数
 *   const platform = {
 *     getName: () => 'uTools' | 'ZTools',
 *     getApiKeys: () => ['hostTools', 'utools'] | ['hostTools', 'ztools', 'utools'],
 *     getUserFnName: () => 'getUtoolsUser' | 'getZtoolsUser',
 *     getContactUrl: () => '...',
 *     onPluginEnter: (cb) => { ... },
 *     onPluginOut: (cb) => { ... },
 *     openExternal: (url) => { ... },
 *   };
 *
 *   // 初始化所有功能
 *   initPreload(api, platform);
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { clipboard, nativeImage } = require('electron');

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2', '.eot']);

// ── 工具函数 ──

const _readUInt16 = (buffer, offset) => {
  return offset + 2 <= buffer.length ? buffer.readUInt16BE(offset) : 0;
};

const _readUInt32 = (buffer, offset) => {
  return offset + 4 <= buffer.length ? buffer.readUInt32BE(offset) : 0;
};

const _readBuffer = (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.length > 0 ? buffer : null;
  } catch (e) {
    return null;
  }
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

const _decodeUtf16BE = (buffer) => {
  const length = buffer.length - (buffer.length % 2);
  const swapped = Buffer.alloc(length); // 使用 alloc 替代 allocUnsafe，避免未初始化内存泄漏
  for (let i = 0; i < length; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString('utf16le');
};

// ── 字体检测函数 ──

const _isMicrosoftFont = (fileName) => {
  const name = (fileName || '').toLowerCase();
  const microsoftPatterns = [
    /calibri/i, /times/i, /arial/i, /verdana/i, /trebuchet/i, /comic\s*sans/i,
    /georgia/i, /impact/i, /courier\s*new/i, /palatino/i, /lucida/i, /segoe/i,
    /cambria/i, /consolas/i, /corbel/i, /constantia/i, /franklin/i, /gabriola/i,
    /inkfree/i, /javani/i, /kristen/i, /leelawadee/i, /lucida\s*console/i,
    /lucida\s*handwriting/i, /lucida\s*sans/i, /microsoft/i, /segoe/i,
    /stencil/i, /sym\+\.ttf/i, /sym\+\.otf/i,
  ];

  const isMicrosoftFont = microsoftPatterns.some(pattern => pattern.test(name));
  if (isMicrosoftFont) return true;

  const isLikelyMicrosoftFont = /\.(ttf|otf)$/i.test(name) && name.length < 30;
  if (isLikelyMicrosoftFont) return true;

  return false;
};

const _isLikelyMicrosoftFont = (path) => {
  const normalizedPath = (path || '').toLowerCase();

  if (/^\s*microsoft/i.test(normalizedPath)) return false;
  if (/^\s*(c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z):/i.test(normalizedPath)) return false;
  if (/fonts(?:\s|\/|\\\\|\\|%5c|\/|%2f)/i.test(normalizedPath)) return false;
  if (/microsoft|windows/i.test(normalizedPath)) return false;
  if (/fonts(?:\s|\/|\\\\|\\|%5c|\/|%2f)/i.test(normalizedPath)) return false;
  if (/windows/i.test(normalizedPath)) return false;

  return true;
};

const _isCFFFont = (buffer) => {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00;
};

const _readNameRecord = (tableData, tag) => {
  try {
    const numRecords = tableData.readUInt16BE(6);
    const stringDataOffset = tableData.readUInt16BE(8);

    for (let i = 0; i < numRecords; i++) {
      const recordOffset = 10 + i * 16;
      const platformID = tableData.readUInt16BE(recordOffset);
      const encodingID = tableData.readUInt16BE(recordOffset + 2);
      const languageID = tableData.readUInt16BE(recordOffset + 4);
      const nameID = tableData.readUInt16BE(recordOffset + 6);
      const length = tableData.readUInt16BE(recordOffset + 8);
      const offset = tableData.readUInt16BE(recordOffset + 10);

      if (tag === 'fontFamily' && nameID === 1 && platformID === 3 && encodingID === 1) {
        const recordStart = stringDataOffset + offset;
        if (recordStart + length <= tableData.length) {
          if (_isCFFFont) {
            const rawBuffer = tableData.slice(recordStart, recordStart + length);
            return _decodeUtf16BE(rawBuffer);
          }
          return tableData.toString('utf16be', recordStart, recordStart + length);
        }
      }

      if (tag === 'preferredFamily' && nameID === 16 && platformID === 3 && encodingID === 1) {
        const recordStart = stringDataOffset + offset;
        if (recordStart + length <= tableData.length) {
          if (_isCFFFont) {
            const rawBuffer = tableData.slice(recordStart, recordStart + length);
            return _decodeUtf16BE(rawBuffer);
          }
          return tableData.toString('utf16be', recordStart, recordStart + length);
        }
      }
    }
  } catch (e) {
    return '';
  }
  return '';
};

const _hasMicrosoftLicense = (nameTableData) => {
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

const _isCFFTable = (table) => {
  return typeof table === 'object' && table !== null && !Array.isArray(table) &&
    Object.keys(table).some(key => key.toLowerCase().includes('cmap') ||
    key.toLowerCase().includes('glyph') || key.toLowerCase().includes('charstring'));
};

const _detectCFFFont = (buffer) => {
  try {
    const numTables = _readUInt16(buffer, 4);
    if (numTables === 0) return false;

    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag = buffer.toString('ascii', tableOffset, tableOffset + 4);
      if (tag === 'CFF ' || tag === 'CFF2') return true;
    }
  } catch (e) {
    return false;
  }
  return false;
};

const _getFontNameFromBuffer = (buffer, filePath) => {
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

const _readFontNameUsingCFF = (buffer) => {
  try {
    const numTables = _readUInt16(buffer, 4);
    if (numTables === 0) return null;

    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag = buffer.toString('ascii', tableOffset, tableOffset + 4);
      if (tag === 'name') {
        const tableLength = _readUInt32(buffer, tableOffset + 4);
        const tableOffset2 = _readUInt32(buffer, tableOffset + 8);
        const nameTableData = buffer.slice(tableOffset2, tableOffset2 + tableLength);
        return _extractFontName(nameTableData);
      }
    }
  } catch (e) {
    return null;
  }
  return null;
};

const _readFontNameUsingOffsetTable = (buffer) => {
  try {
    const numTables = _readUInt16(buffer, 4);
    if (numTables === 0) return null;

    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag = buffer.toString('ascii', tableOffset, tableOffset + 4);
      if (tag === 'name') {
        const tableLength = _readUInt32(buffer, tableOffset + 4);
        const tableOffset2 = _readUInt32(buffer, tableOffset + 8);
        const nameTableData = buffer.slice(tableOffset2, tableOffset2 + tableLength);
        return _extractFontName(nameTableData);
      }
    }
  } catch (e) {
    return null;
  }
  return null;
};

const _extractFontName = (nameTableData) => {
  try {
    const numRecords = nameTableData.readUInt16BE(6);
    const stringDataOffset = nameTableData.readUInt16BE(8);

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
          if (_isCFFFont) {
            const rawBuffer = nameTableData.slice(recordStart, recordStart + length);
            const fontName = _decodeUtf16BE(rawBuffer);
            return _hasMicrosoftLicense(nameTableData) ? fontName : null;
          }
          const fontName = nameTableData.toString('utf16be', recordStart, recordStart + length);
          return _hasMicrosoftLicense(nameTableData) ? fontName : null;
        }
        if (nameID === 16 && platformID === 3 && encodingID === 1) {
          if (_isCFFFont) {
            const rawBuffer = nameTableData.slice(recordStart, recordStart + length);
            const fontName = _decodeUtf16BE(rawBuffer);
            return _hasMicrosoftLicense(nameTableData) ? fontName : null;
          }
          const fontName = nameTableData.toString('utf16be', recordStart, recordStart + length);
          return _hasMicrosoftLicense(nameTableData) ? fontName : null;
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
};

// ── 公共初始化函数 ──

const initPreload = (platform) => {
  if (typeof window === 'undefined' || !window.require) return;

  // 设置公共 API
  window.getPluginPath = () => {
    try {
      return path.dirname(__dirname);
    } catch (e) {
      return '';
    }
  };

  // 设置图片对话框
  setupImageDialog(platform);

  // 设置剪贴板
  setupClipboard();

  // 设置外部链接
  setupExternalLink(platform);

  // 设置存储
  setupStorage();

  // 设置窗口控制
  setupWindowControl();

  // 设置字体工具
  setupFontTools(platform);

  // 设置用户 API
  setupUserAPI(platform);

  // 设置杂项 API
  setupMiscAPIs(platform);
};

const setupImageDialog = (platform) => {
  if (typeof window === 'undefined') return;

  window.showOpenImageDialog = () => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.showOpenDialog !== 'function') return null;
    try {
      const result = hostTools.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] }],
      });
      if (result && result.length > 0) {
        const selectedFile = result[0];
        return selectedFile.startsWith('file://') ? selectedFile.replace('file://', '') : selectedFile;
      }
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 打开图片选择失败:`, e);
    }
    return null;
  };

  window.showSaveImageDialog = (suggestedName = 'edited.png') => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.showSaveDialog !== 'function') return null;
    try {
      const defaultPath = path.join(os.homedir(), 'Desktop', suggestedName);
      const result = hostTools.showSaveDialog({
        title: '保存图片',
        defaultPath,
        filters: [
          { name: 'PNG 图片', extensions: ['png'] },
          { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
          { name: 'WebP 图片', extensions: ['webp'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result && result.length > 0) {
        return result[0];
      }
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 保存图片失败:`, e);
    }
    return null;
  };

  window.readImageFile = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      if (!fs.existsSync(cleanedPath)) return null;
      const data = fs.readFileSync(cleanedPath);
      if (!data || data.length === 0) return null;
      const mimeType = _detectImageMime(data);
      const base64 = data.toString('base64');
      return `data:${mimeType};base64,${base64}`;
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 读取图片文件失败:`, e);
      return null;
    }
  };

  window.writeImageFile = (filePath, dataUrl) => {
    if (!filePath || typeof filePath !== 'string') return false;
    if (!dataUrl || typeof dataUrl !== 'string') return false;
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      const fs = require('fs');
      const path = require('path');
      fs.mkdirSync(path.dirname(cleanedPath), { recursive: true });
      const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      if (base64Match) {
        const base64Data = base64Match[2];
        fs.writeFileSync(cleanedPath, Buffer.from(base64Data, 'base64'));
        return true;
      }
      return false;
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 保存图片失败:`, e);
      return false;
    }
  };
};

const setupClipboard = () => {
  if (typeof window === 'undefined') return;

  window.copyImageToClipboard = (dataUrl) => {
    if (!dataUrl) return false;
    try {
      const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      if (base64Match) {
        const imageBuffer = Buffer.from(base64Match[2], 'base64');
        const image = nativeImage.createFromBuffer(imageBuffer);
        clipboard.writeImage(image);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[preload] 复制图片到剪贴板失败:', e);
      return false;
    }
  };
};

const setupExternalLink = (platform) => {
  if (typeof window === 'undefined') return;

  window.openHostExternal = (url) => {
    if (!url) return false;
    try {
      const hostTools = getHostTools();
      if (hostTools && typeof hostTools.shellOpenExternal === 'function') {
        hostTools.shellOpenExternal(url);
        return true;
      }
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 打开外部链接失败:`, e);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  };
};

const setupStorage = () => {
  if (typeof window === 'undefined') return;

  window.getHostStorage = () => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.dbStorage !== 'object' || hostTools.dbStorage === null) {
      return null;
    }
    return {
      getItem: (key) => {
        try {
          return hostTools.dbStorage.getItem(key);
        } catch (e) {
          console.warn('[preload] 获取存储失败:', e);
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          hostTools.dbStorage.setItem(key, value);
          return true;
        } catch (e) {
          console.warn('[preload] 设置存储失败:', e);
          return false;
        }
      },
      removeItem: (key) => {
        try {
          hostTools.dbStorage.removeItem(key);
          return true;
        } catch (e) {
          console.warn('[preload] 删除存储失败:', e);
          return false;
        }
      },
    };
  };
};

const setupWindowControl = () => {
  if (typeof window === 'undefined') return;

  window.setPluginWindowHeight = (height) => {
    try {
      const hostTools = getHostTools();
      if (hostTools && typeof hostTools.setExpendHeight === 'function') {
        hostTools.setExpendHeight(height);
        return true;
      }
    } catch (e) {
      console.warn('[preload] 设置窗口高度失败:', e);
    }
    return false;
  };

  window.setPluginWindowTitle = (title) => {
    try {
      const hostTools = getHostTools();
      if (hostTools && typeof hostTools.setMainWindowTitle === 'function') {
        hostTools.setMainWindowTitle(title);
        return true;
      }
    } catch (e) {
      console.warn('[preload] 设置窗口标题失败:', e);
    }
    return false;
  };
};

const setupFontTools = (platform) => {
  if (typeof window === 'undefined') return;

  window.getSystemFonts = () => {
    try {
      const result = execFileSync('fc-list', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
      const fonts = new Set();
      const lines = result.split('\n');
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
      console.warn('[preload] 获取系统字体失败:', e);
      return [];
    }
  };

  window.getSystemFontsAsync = () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          resolve(window.getSystemFonts());
        } catch (e) {
          console.warn('[preload] 异步获取系统字体失败:', e);
          resolve([]);
        }
      }, 0);
    });
  };

  window.getFontsDirectory = () => {
    try {
      const result = execFileSync('fc-list', ['-s'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
      const fonts = new Set();
      const lines = result.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && trimmed.length > 0) {
          fonts.add(trimmed);
        }
      }
      return Array.from(fonts);
    } catch (e) {
      console.warn('[preload] 获取字体目录失败:', e);
      return [];
    }
  };

  window.detectFontName = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      if (!fs.existsSync(cleanedPath)) return null;
      const fontBuffer = _readBuffer(cleanedPath);
      if (!fontBuffer) return null;
      return _getFontNameFromBuffer(fontBuffer, cleanedPath);
    } catch (e) {
      console.warn('[preload] 检测字体名称失败:', e);
      return null;
    }
  };

  window.isFontInstalled = (fontName) => {
    try {
      const result = execFileSync('fc-list', [fontName], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
      return result.length > 0;
    } catch (e) {
      return false;
    }
  };

  window.installFont = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return false;
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      if (!fs.existsSync(cleanedPath)) return false;
      const userFontsDir = path.join(os.homedir(), '.fonts');
      fs.mkdirSync(userFontsDir, { recursive: true });
      const fileName = path.basename(cleanedPath);
      const destPath = path.join(userFontsDir, fileName);
      fs.copyFileSync(cleanedPath, destPath);
      try {
        execFileSync('fc-cache', ['-f'], { timeout: 10000 });
      } catch (e) {
        console.warn('[preload] 字体缓存更新失败:', e);
      }
      return true;
    } catch (e) {
      console.warn('[preload] 安装字体失败:', e);
      return false;
    }
  };
};

const setupUserAPI = (platform) => {
  if (typeof window === 'undefined') return;

  window.getHostUser = () => {
    const hostTools = getHostTools();
    if (!hostTools) return null;
    try {
      if (typeof hostTools.getUser === 'function') return hostTools.getUser();
      if (typeof hostTools.getUserInfo === 'function') return hostTools.getUserInfo();
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 获取宿主用户失败:`, e);
    }
    return null;
  };
};

const setupMiscAPIs = (platform) => {
  if (typeof window === 'undefined') return;

  window.getImageSourceFromPluginPayload = (type, payload) => {
    if (type === 'img' && payload) {
      const imgPayload = Array.isArray(payload) ? payload : [payload];
      for (const item of imgPayload) {
        const dataURL = (item && typeof item === 'object') ? item.dataURL || item.dataUrl || item.base64 || item.content : null;
        if (dataURL && typeof dataURL === 'string' && dataURL.startsWith('data:')) return dataURL;
      }
      return null;
    }
    if (type === 'files' || type === 'file') {
      const files = Array.isArray(payload) ? payload : [payload];
      for (const fileInfo of files) {
        if (fileInfo && fileInfo.path) {
          const cleanedPath = fileInfo.path.replace(/^file:\/\//, '');
          if (fs.existsSync(cleanedPath)) {
            try {
              const data = fs.readFileSync(cleanedPath);
              const mimeType = _detectImageMime(data);
              const base64 = data.toString('base64');
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

const getHostTools = () => {
  if (typeof window === 'undefined') return null;
  const api = window.hostTools
    || window.utools
    || window.ztools
    || (typeof globalThis !== 'undefined' ? (globalThis.utools || globalThis.ztools) : null)
    || null;
  if (api) {
    window.hostTools = api;
    if (!window.utools && window.ztools === api) {
      window.utools = api;
    }
  }
  return api;
};

const getHostPath = (name) => {
  const hostTools = getHostTools();
  try {
    if (hostTools && typeof hostTools.getPath === 'function') return hostTools.getPath(name);
  } catch (e) {
    console.warn('[preload] 获取宿主路径失败:', e);
  }
  return '';
};

const getHostAppVersion = () => {
  const hostTools = getHostTools();
  try {
    if (hostTools && typeof hostTools.getAppVersion === 'function') return hostTools.getAppVersion();
    if (hostTools && typeof hostTools.getVersion === 'function') return hostTools.getVersion();
    if (hostTools && typeof hostTools.getPluginVersion === 'function') return hostTools.getPluginVersion();
  } catch (e) {
    console.warn('[preload] 获取宿主版本失败:', e);
  }
  return 'unknown';
};

const getHostVersion = () => getHostAppVersion();

const getHostAppInfo = () => {
  const hostTools = getHostTools();
  if (!hostTools) return { name: _getHostName(), version: 'unknown', platform: process.platform };
  try {
    if (typeof hostTools.getAppVersion === 'function') return { name: _getHostName(), version: hostTools.getAppVersion(), platform: process.platform };
    if (typeof hostTools.getVersion === 'function') return { name: _getHostName(), version: hostTools.getVersion(), platform: process.platform };
  } catch (e) {
    console.warn('[preload] 获取宿主信息失败:', e);
  }
  return { name: _getHostName(), version: 'unknown', platform: process.platform };
};

const _getHostName = () => {
  const hostTools = getHostTools();
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

// 导出所有公共函数
module.exports = {
  initPreload,
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
  _getHostName,
};
