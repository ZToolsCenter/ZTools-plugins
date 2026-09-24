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
 *   } = require('../../core/src/preloadHelpers.js');
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
const { execFileSync, execSync } = require('child_process');
const { clipboard, nativeImage } = require('electron');

// ── 平台检测 ──

const _isWindows = process.platform === 'win32';
const _isMacOS = process.platform === 'darwin';
const _isLinux = process.platform === 'linux';

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2', '.eot']);

/**
 * 允许写入磁盘的扩展名白名单。
 *
 * 本应用的写盘需求只有两类：导出图片（png/jpg/jpeg/webp）与导出 ORA 工程（ora）。
 * 限定扩展名可以避免这个接口被用作「投放任意可执行文件」的通道 ——
 * 即使某个路径被授权，也不应允许写出 .dll/.cmd/.ps1/.lnk 这类可执行内容。
 */
const WRITABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.ora']);

// ── 路径白名单 ──
//
// 历史问题：readBinaryFile / writeBinaryFile / installFont 直接接受任意绝对路径，
// preload 又把它们挂在页面 window 上，于是渲染进程里任何一处注入（第三方脚本、
// 被污染的粘贴内容等）都能升级为本机任意文件读写。
//
// 这里改为「先授权、后访问」：只有用户通过宿主文件对话框主动选出的路径才进入
// 白名单，文件 API 一律拒绝白名单之外的路径。
// 白名单只存在于 preload 的闭包中，页面无法直接读写它。

/**
 * 已授权路径集合（规范化后的绝对路径）。
 *
 * 只由用户通过宿主对话框主动选出的具体文件进入，是读写共用的授权。
 */
const _allowedPaths = new Set();

/**
 * 已授权「只读」目录集合（规范化后的绝对路径）。
 *
 * 只参与**读取**判定。字体枚举之类的场景需要读取目录内的文件，
 * 但并不代表该目录可写。
 *
 * 历史问题：本集合曾同时用于读与写，而系统字体目录正是通过
 * getFontsDirectory() 进入这里。于是页面只要调用一次字体枚举，
 * 就顺带拿到了字体目录的写权限（macOS/Linux 上 ~/Library/Fonts、
 * ~/.fonts 对当前用户可写），可投放任意扩展名的文件。
 * 「只读用途的目录」与「可写目录」是两种不同授权，必须分开。
 */
const _allowedReadDirs = new Set();

/**
 * 规范化路径用于白名单比对。
 *
 * 必须先 resolve 再判断：`a/../b` 这类写法在字符串层面与 `b` 不同，
 * 但指向同一个文件，只做字符串前缀匹配会被绕过。
 *
 * Windows 下文件系统大小写不敏感，统一转小写比对，避免同一路径因大小写
 * 差异被误判为未授权（误拒是安全问题，误放才是漏洞）。
 *
 * @param {string} filePath
 * @returns {string} 规范化后的路径；无法解析时返回空字符串
 */
const _normalizeFsPath = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return '';
  try {
    const cleaned = filePath.replace(/^file:\/\//, '');
    // 去掉 Windows 长路径前缀（\\?\C:\... → C:\...）
    const withoutPrefix = cleaned.replace(/^\\\\\?\\/, '');
    const resolved = path.resolve(withoutPrefix);
    return _isWindows ? resolved.toLowerCase() : resolved;
  } catch (e) {
    return '';
  }
};

/**
 * 把路径加入白名单（仅由宿主对话框 / 宿主目录回调调用）。
 * @param {string} filePath
 * @returns {boolean} 是否成功登记
 */
const _allowPath = (filePath) => {
  const normalized = _normalizeFsPath(filePath);
  if (!normalized) return false;
  _allowedPaths.add(normalized);
  return true;
};

/**
 * 判断规范化路径是否落在给定目录集合内。
 * 用 path.relative 而不是字符串 startsWith：后者会把
 * `C:\Users\me-evil` 误判为在 `C:\Users\me` 之内。
 * @param {Set<string>} dirs
 * @param {string} normalizedPath
 * @returns {boolean}
 */
const _isInsideDirs = (dirs, normalizedPath) => {
  for (const dir of dirs) {
    if (normalizedPath === dir) return true;
    const rel = path.relative(dir, normalizedPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
};

/**
 * 校验路径是否可读（用户已授权）。
 *
 * 可读来源有两类：对话框选定的具体文件（_allowedPaths），
 * 以及为只读用途登记的目录（_allowedReadDirs，如字体目录）。
 * @param {string} filePath
 * @returns {boolean}
 */
const _isPathAllowedForRead = (filePath) => {
  const normalized = _normalizeFsPath(filePath);
  if (!normalized) return false;
  if (_allowedPaths.has(normalized)) return true;
  return _isInsideDirs(_allowedReadDirs, normalized);
};

/**
 * 校验路径是否可写。
 *
 * 写入**只认用户通过保存对话框选定的具体文件**（_allowedPaths），
 * 不再接受任何目录级授权 —— 目录级放行会顺带把「只读用途的目录」
 * 变成可写通道（见 _allowedReadDirs 的说明）。
 * @param {string} filePath
 * @returns {boolean}
 */
const _isPathAllowedForWrite = (filePath) => {
  const normalized = _normalizeFsPath(filePath);
  if (!normalized) return false;
  return _allowedPaths.has(normalized);
};

/**
 * 净化对话框建议文件名，防止路径逃逸。
 *
 * 该值由页面完全控制，会被拼进 `path.join(home, 'Desktop', name)`。
 * 而 path.join 会「吃掉」`..`：传入
 * `..\\..\\..\\..\\Windows\\System32\\pwn.png` 会得到
 * `C:\\Windows\\System32\\pwn.png`，对话框便以该路径为默认名弹出。
 * 用户以为在「保存图片」按回车，实际就把攻击者指定的路径授权进了白名单。
 *
 * 这里只取最后一段文件名，并剥离控制字符与 Windows 保留字符，
 * 使结果恒为「Desktop 下的一个普通文件名」。
 *
 * @param {*} suggestedName - 页面传入的建议名
 * @param {string} fallback - 净化后为空时的兜底名
 * @returns {string}
 */
const _sanitizeSuggestedName = (suggestedName, fallback) => {
  if (typeof suggestedName !== 'string') return fallback;

  // basename 同时兼容 Windows 与 POSIX 分隔符：先把反斜杠统一成斜杠，
  // 否则在非 Windows 平台上 '..\\..\\pwn.png' 会被当成单个文件名而漏过。
  const unified = suggestedName.replace(/\\/g, '/');
  const base = path.basename(unified);

  // 去掉控制字符、Windows 非法字符与首尾空白/点（'..' 与尾部点会被系统特殊处理）
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  return cleaned || fallback;
};

/**
 * 构造「保存对话框」的默认路径。
 *
 * 除净化文件名外，这里再断言一次结果确实位于目标目录内：
 * 净化逻辑若将来被改动或绕过，这道断言能兜住 —— 默认路径出现在
 * 非预期目录时不静默放行，而是退回目录本身。
 *
 * @param {string} suggestedName - 页面传入的建议名
 * @param {string} fallback - 兜底文件名
 * @returns {string} 位于 ~/Desktop 下的绝对路径
 */
const _buildDefaultSavePath = (suggestedName, fallback) => {
  const safeName = _sanitizeSuggestedName(suggestedName, fallback);
  const dir = path.join(os.homedir(), 'Desktop');
  const candidate = path.join(dir, safeName);

  // 断言：父目录必须就是预期目录。不满足时退化为目录内的兜底名。
  if (path.dirname(candidate) !== dir) {
    return path.join(dir, fallback);
  }
  return candidate;
};

/**
 * 从宿主对话框返回值中提取路径并登记白名单。
 * 对话框返回值形态不固定（字符串 / 数组 / { filePaths } / { filePath }），
 * 这里统一处理，避免各调用点各写一份。
 * @param {*} result - 宿主对话框返回值
 * @returns {string|null} 提取到的首个路径（已授权）
 */
const _extractAndAllowDialogPath = (result) => {
  if (!result) return null;

  let candidate = null;
  if (typeof result === 'string') candidate = result;
  else if (Array.isArray(result) && result.length > 0) candidate = result[0];
  else if (result.filePaths && Array.isArray(result.filePaths) && result.filePaths.length > 0) candidate = result.filePaths[0];
  else if (typeof result.filePath === 'string') candidate = result.filePath;

  if (!candidate || typeof candidate !== 'string') return null;

  const cleaned = candidate.startsWith('file://') ? candidate.replace('file://', '') : candidate;
  _allowPath(cleaned);
  return cleaned;
};

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

/**
 * 校验文件内容是否真的是字体（sfnt / WOFF 魔数）。
 *
 * 只按扩展名判断是不够的：把任意二进制改名成 .woff 即可通过，
 * 再经 installFont 复制进系统字体目录，等于提供了一条任意文件投放通道。
 * 这里读前 4 字节核对字体格式魔数，内容不符即拒。
 *
 * 合法魔数：
 *   00 01 00 00  TrueType（sfnt）
 *   'OTTO'        CFF/OpenType
 *   'true'        旧版 TrueType（macOS）
 *   'ttcf'        TrueType 集合
 *   'wOFF'        WOFF 1.0
 *   'wOF2'        WOFF 2.0
 * 注：EOT 无统一魔数，仅靠扩展名，属历史遗留格式，此处不做内容校验。
 *
 * @param {string} filePath
 * @returns {boolean}
 */
const _hasFontMagic = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  // EOT 无可靠魔数，跳过内容校验（保留扩展名判定）
  if (ext === '.eot') return true;

  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(4);
      const read = fs.readSync(fd, header, 0, 4, 0);
      if (read < 4) return false;

      const tag = header.toString('latin1');
      if (tag === 'OTTO' || tag === 'true' || tag === 'ttcf' || tag === 'wOFF' || tag === 'wOF2') {
        return true;
      }
      return header[0] === 0x00 && header[1] === 0x01 && header[2] === 0x00 && header[3] === 0x00;
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return false;
  }
};

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

/**
 * 判断字体路径是否指向 Microsoft/Windows 系统字体。
 * 函数名语义：返回 true = 很可能是 Microsoft 字体。
 */
const _isLikelyMicrosoftFont = (filePath) => {
  const normalized = (filePath || '').toLowerCase();

  if (/^\s*microsoft/i.test(normalized)) return true;
  if (/microsoft|windows/i.test(normalized)) return true;
  // Windows 盘符路径（如 C:\Windows\Fonts）
  if (/^\s*[a-z]:[\\/]/i.test(normalized)) return true;
  if (/fonts(?:\s|\/|\\\\|\\|%5c|\/|%2f)/i.test(normalized)) return true;

  return false;
};

const _isCFFFont = (buffer) => {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00;
};

const _readNameRecord = (tableData, tag, buffer) => {
  try {
    const numRecords = tableData.readUInt16BE(6);
    const stringDataOffset = tableData.readUInt16BE(8);
    const isCFF = buffer ? _isCFFFont(buffer) : false;

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
          if (isCFF) {
            const rawBuffer = tableData.slice(recordStart, recordStart + length);
            return _decodeUtf16BE(rawBuffer);
          }
          return tableData.toString('utf16be', recordStart, recordStart + length);
        }
      }

      if (tag === 'preferredFamily' && nameID === 16 && platformID === 3 && encodingID === 1) {
        const recordStart = stringDataOffset + offset;
        if (recordStart + length <= tableData.length) {
          if (isCFF) {
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

// ── 跨平台系统字体获取 ──

const _getSystemFontsWindows = () => {
  try {
    // 使用 PowerShell 读取注册表中的已安装字体名称，比逐个解析字体文件快得多
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
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
      shell: 'powershell.exe',
    });
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
    console.warn('[preload] Windows 获取系统字体失败:', e);
    return [];
  }
};

const _getSystemFontsMacOS = () => {
  try {
    const result = execSync('system_profiler SPFontsDataType', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    });
    const fonts = new Set();
    const lines = result.split('\n');
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
    console.warn('[preload] macOS 获取系统字体失败:', e);
    return [];
  }
};

const _getSystemFontsLinux = () => {
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
    console.warn('[preload] Linux 获取系统字体失败:', e);
    return [];
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
        return _extractFontName(nameTableData, buffer);
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
        return _extractFontName(nameTableData, buffer);
      }
    }
  } catch (e) {
    return null;
  }
  return null;
};

const _extractFontName = (nameTableData, buffer) => {
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
            const fontName = _decodeUtf16BE(rawBuffer);
            return _hasMicrosoftLicense(nameTableData) ? fontName : null;
          }
          const fontName = nameTableData.toString('utf16be', recordStart, recordStart + length);
          return _hasMicrosoftLicense(nameTableData) ? fontName : null;
        }
        if (nameID === 16 && platformID === 3 && encodingID === 1) {
          if (isCFF) {
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

/**
 * 通过 contextBridge 暴露页面所需 API。
 *
 * contextIsolation 开启时 preload 与页面处在两个不同的 JS 世界：
 * preload 直接给 window.xxx 赋值，页面侧读不到（或读到宿主自己的同名属性），
 * 必须用 contextBridge.exposeInMainWorld 才能跨越隔离层。
 *
 * 这里仍在 preload 内部统一把 API 挂在 window 上（这样未启用隔离的宿主、
 * 以及 setupXXX 之间通过 window.xxx 互相调用都不受影响），最后再把整批
 * API 一次性桥接到主世界。
 *
 * @param {string[]} apiNames - 需要暴露给页面的 API 名称
 * @param {string} name - 平台名称（仅用于日志）
 */
const _exposeApisToPage = (apiNames, name) => {
  if (typeof window === 'undefined') return;

  let contextBridge = null;
  try {
    ({ contextBridge } = require('electron'));
  } catch (e) {
    // 非 Electron 环境（理论上不会走到这里）
  }

  if (!contextBridge || typeof contextBridge.exposeInMainWorld !== 'function') {
    // 未启用 contextIsolation 的宿主：preload 与页面同处一个世界，
    // 直接赋值已经可用，无需桥接。
    return;
  }

  const bridged = {};
  const missing = [];

  for (const apiName of apiNames) {
    const api = window[apiName];
    if (api === undefined) {
      missing.push(apiName);
      continue;
    }
    // contextBridge 只传递函数与可序列化值；此处全是函数，直接传递即可。
    // 不要传入宿主原始对象：那等于把宿主全量 API 重新打包送进页面。
    bridged[apiName] = api;
  }

  try {
    contextBridge.exposeInMainWorld('__imageToolboxApi', bridged);
  } catch (e) {
    console.error(`[${name} preload] contextBridge 暴露 API 失败:`, e);
    return;
  }

  // 把桥接入口本身也挂在 preload 侧的 window 上，方便调试与控制台自查
  window.__imageToolboxApiBridge = bridged;

  // 本函数会被调用两次：initPreload 里一次，initPlatformPreload 末尾再一次
  // （后者才注册 getHostName / getPluginVersion 等平台 API）。
  // 首次调用时这些 API 尚未注册，若此时告警会刷出 5 条「未注册」噪音，
  // 反而掩盖真正的缺失。因此只在最后一次（平台 API 注册完毕后）才告警。
  if (missing.length > 0 && _bridgingComplete) {
    console.warn(`[${name} preload] 以下 API 未注册，未桥接到页面:`, missing.join(', '));
  }
};

/**
 * 平台相关 API 是否已注册完毕。
 *
 * _exposeApisToPage 需要调用两次（基础 API 一次、平台 API 一次），
 * 只有在第二次之后，「API 未注册」的告警才有意义 —— 见该函数内注释。
 */
let _bridgingComplete = false;

/** 标记桥接阶段结束，之后的缺失告警才可信。 */
const _markBridgingComplete = () => {
  _bridgingComplete = true;
};

/**
 * 页面侧可用的 API 名单。
 *
 * 这是「最小暴露面」清单：只包含 core 层实际调用到的函数。
 * 宿主原始对象（window.hostTools / window.utools / window.ztools）不在其中，
 * 页面不再持有宿主全量 API —— 历史上它们是整块挂在页面 window 上的。
 */
const PAGE_API_NAMES = [
  // 版本 / 宿主信息
  'getPluginPath',
  'getHostAppVersion',
  'getHostName',
  'getHostVersion',
  'getHostAppInfo',
  'getPluginVersion',
  // 文件对话框与读写
  'showOpenImageDialog',
  'showSaveImageDialog',
  'showOpenDialog',
  'showSaveOraDialog',
  'readImageFile',
  'writeImageFile',
  'readBinaryFile',
  'writeBinaryFile',
  // 剪贴板
  'copyImageToClipboard',
  // 外部链接
  'openHostExternal',
  // 存储
  'getHostStorage',
  // 窗口控制
  'setPluginWindowHeight',
  'setPluginWindowTitle',
  // 字体
  'getSystemFonts',
  'getSystemFontsAsync',
  'getFontsDirectory',
  'detectFontName',
  'isFontInstalled',
  'installFont',
  // 用户
  'getHostUser',
  // uTools 一键登录（只暴露这一个能力，不暴露宿主对象本身）
  'fetchUserServerTemporaryToken',
  // 插件载荷
  'getImageSourceFromPluginPayload',
];

const initPreload = (platform) => {
  if (typeof window === 'undefined') return;

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

  // 最后统一把白名单内的 API 桥接到页面主世界。
  // initPlatformPreload 还会补充几个平台相关 API，桥接在那边再执行一次，
  // 两次调用是幂等的（后一次覆盖前一次，名单相同）。
  _exposeApisToPage(PAGE_API_NAMES, platform.getName());
};

const setupImageDialog = (platform) => {
  if (typeof window === 'undefined') return;

  window.showOpenImageDialog = () => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.showOpenDialog !== 'function') return null;
    try {
      const result = hostTools.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: '图片和工程文件', extensions: ['ora', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
          { name: 'OpenRaster 工程文件', extensions: ['ora'] },
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
        ],
      });
      // 用户通过对话框选择的路径视为已授权，登记白名单后返回
      const selectedFile = _extractAndAllowDialogPath(result);
      if (selectedFile) {
        return selectedFile;
      }
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 打开图片选择失败:`, e);
    }
    return null;
  };

  window.showSaveImageDialog = (suggestedName = 'edited.png', format = null) => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.showSaveDialog !== 'function') return null;
    try {
      // suggestedName 来自页面，必须净化后才能作为默认路径（见 _buildDefaultSavePath）
      const defaultPath = _buildDefaultSavePath(suggestedName, 'edited.png');

      // 格式过滤器映射
      const allFilters = {
        png:    { name: 'PNG 图片', extensions: ['png'] },
        jpg:    { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
        jpeg:   { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
        webp:   { name: 'WebP 图片', extensions: ['webp'] },
        ora:    { name: 'OpenRaster 工程文件', extensions: ['ora'] },
      };

      // 如果指定了格式，只显示该格式的过滤器（+ 所有文件）
      const filters = format && allFilters[format.toLowerCase()]
        ? [allFilters[format.toLowerCase()], { name: '所有文件', extensions: ['*'] }]
        : [
            { name: 'PNG 图片', extensions: ['png'] },
            { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
            { name: 'WebP 图片', extensions: ['webp'] },
            { name: 'OpenRaster 工程文件', extensions: ['ora'] },
            { name: '所有文件', extensions: ['*'] },
          ];

      const result = hostTools.showSaveDialog({
        title: '保存图片',
        defaultPath,
        filters,
      });
      // 用户通过保存对话框选定的目标路径视为已授权
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
    if (!filePath || typeof filePath !== 'string') return null;
    // 仅允许读取用户已授权的路径（对话框选定的文件，或只读目录如字体目录）
    if (!_isPathAllowedForRead(filePath)) {
      console.warn(`[${platform.getName()} preload] 拒绝读取未授权路径`);
      return null;
    }
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
    // 仅允许写入用户已授权的路径（仅限保存对话框选定的具体文件，
    // 不接受目录级授权，避免把只读用途的目录变成可写通道）
    if (!_isPathAllowedForWrite(filePath)) {
      console.warn(`[${platform.getName()} preload] 拒绝写入未授权路径`);
      return false;
    }
    // 扩展名白名单：即使路径已授权，也不允许写出可执行文件
    if (!WRITABLE_EXTENSIONS.has(path.extname(filePath.replace(/^file:\/\//, '')).toLowerCase())) {
      console.warn(`[${platform.getName()} preload] 拒绝写入非允许的扩展名`);
      return false;
    }
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      const dirName = path.dirname(cleanedPath);
      if (dirName && !/^[a-zA-Z]:\\?$/.test(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
      }
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

  /**
   * 允许交给宿主/浏览器打开的外部协议白名单。
   *
   * shellOpenExternal 会把 URL 交给操作系统处理，file:、ms-*、jar:、
   * search-ms: 等 scheme 可能唤起本机程序。页面侧一旦被注入，
   * 这里就是「让系统执行任意 URI」的原语，因此只放行 http/https。
   */
  const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

  window.openHostExternal = (url) => {
    if (!url || typeof url !== 'string') return false;

    // 先解析再判定协议，不靠字符串前缀匹配（前缀匹配会被
    // 'java\nscript:' 这类走私写法和大小写变体绕过）
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
          console.warn('[preload] 异步获取系统字体失败:', e);
          resolve([]);
        }
      }, 0);
    });
  };

  /**
   * 把目录登记为**只读**可访问目录。
   *
   * 只影响读取判定（_isPathAllowedForRead），不会让目录变成可写 ——
   * 字体枚举是只读用途，不应顺带授予写权限。
   * @param {string} dir
   */
  const _allowReadDir = (dir) => {
    const normalized = _normalizeFsPath(dir);
    if (normalized) _allowedReadDirs.add(normalized);
  };

  window.getFontsDirectory = () => {
    if (_isWindows) {
      try {
        const fontsDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
        // 系统字体目录是只读用途（枚举已安装字体）
        _allowReadDir(fontsDir);
        return [fontsDir];
      } catch { return []; }
    }
    if (_isMacOS) {
      const dirs = ['/Library/Fonts', '/System/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')];
      dirs.forEach(_allowReadDir);
      return dirs;
    }
    try {
      const result = execFileSync('fc-list', ['-s'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
      const fonts = new Set();
      const lines = result.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && trimmed.length > 0) {
          fonts.add(trimmed);
          // fc-list -s 逐行输出目录，理论上都是目录，但仍实测确认后再登记：
          // 若某行不是目录，把它当目录授权会放大可读范围。
          try {
            if (fs.statSync(trimmed).isDirectory()) {
              _allowReadDir(trimmed);
            }
          } catch (e) {
            // 目录不存在或不可访问：跳过登记
          }
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
    // 仅允许读取已授权路径下的字体文件，避免把本机任意文件当作字体解析
    if (!_isPathAllowedForRead(filePath)) {
      console.warn('[preload] 拒绝读取未授权字体路径');
      return null;
    }
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
    if (_isWindows) {
      try {
        const fonts = window.getSystemFonts();
        return fonts.some(f => f.toLowerCase() === (fontName || '').toLowerCase());
      } catch { return false; }
    }
    if (_isMacOS) {
      try {
        const fonts = window.getSystemFonts();
        return fonts.some(f => f.toLowerCase() === (fontName || '').toLowerCase());
      } catch { return false; }
    }
    try {
      const result = execFileSync('fc-list', [fontName], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
      return result.length > 0;
    } catch (e) {
      return false;
    }
  };

  window.installFont = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return false;
    // installFont 会把文件复制进系统用户字体目录，是本文件里权限最高的操作：
    // 只接受用户已授权的源路径，且限字体扩展名，避免被用作任意文件投放通道。
    if (!_isPathAllowedForRead(filePath)) {
      console.warn('[preload] 拒绝安装未授权路径的字体');
      return false;
    }
    if (!_isFontFile(filePath)) {
      console.warn('[preload] 拒绝安装非字体文件');
      return false;
    }
    // 扩展名可伪造，内容必须真的是字体，否则 installFont 会成为
    // 「任意二进制改个扩展名即可写入系统字体目录」的投放通道。
    if (!_hasFontMagic(filePath)) {
      console.warn('[preload] 拒绝安装内容非字体的文件');
      return false;
    }
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      if (!fs.existsSync(cleanedPath)) return false;
      let userFontsDir;
      if (_isWindows) {
        userFontsDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'Windows', 'Fonts');
      } else if (_isMacOS) {
        userFontsDir = path.join(os.homedir(), 'Library', 'Fonts');
      } else {
        userFontsDir = path.join(os.homedir(), '.fonts');
      }
      fs.mkdirSync(userFontsDir, { recursive: true });
      const fileName = path.basename(cleanedPath);
      const destPath = path.join(userFontsDir, fileName);
      fs.copyFileSync(cleanedPath, destPath);
      if (_isLinux) {
        try {
          execFileSync('fc-cache', ['-f'], { timeout: 10000 });
        } catch (e) {
          console.warn('[preload] 字体缓存更新失败:', e);
        }
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

  // uTools 一键登录所需的临时 token。
  // 页面只需要这一个能力，因此单独封装成窄接口暴露，
  // 不再像过去那样把整个宿主 API 对象交给页面自行取用。
  window.fetchUserServerTemporaryToken = async () => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.fetchUserServerTemporaryToken !== 'function') {
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

const setupMiscAPIs = (platform) => {
  if (typeof window === 'undefined') return;

  // ═══ ORA / 通用文件操作 ═══

  // 通用打开文件对话框（返回文件路径数组）
  window.showOpenDialog = (options) => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.showOpenDialog !== 'function') return null;
    try {
      const result = hostTools.showOpenDialog(options) || null;
      // 用户选中的路径登记白名单，后续读取该文件才被允许
      _extractAndAllowDialogPath(result);
      return result;
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 打开文件对话框失败:`, e);
      return null;
    }
  };

  // 读取二进制文件（返回 ArrayBuffer）
  // 仅允许读取用户已授权的路径（对话框选定的文件，或只读目录如字体目录），
  // 防止页面侧任意路径读取。
  window.readBinaryFile = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    if (!_isPathAllowedForRead(filePath)) {
      console.warn(`[${platform.getName()} preload] 拒绝读取未授权路径`);
      return null;
    }
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      if (!fs.existsSync(cleanedPath)) return null;
      const buffer = fs.readFileSync(cleanedPath);
      // 返回 ArrayBuffer
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (e) {
      console.warn(`[${platform.getName()} preload] 读取二进制文件失败:`, e);
      return null;
    }
  };

  // 写入二进制文件（接收 base64 dataURL 或 ArrayBuffer）
  // 仅允许写入用户已授权的路径，且**只认保存对话框选定的具体文件**：
  // 目录级授权会顺带放行目录内的任意文件，把只读用途的目录（如字体目录）
  // 变成任意文件投放通道，因此这里不接受目录授权。
  window.writeBinaryFile = (filePath, data) => {
    if (!filePath || typeof filePath !== 'string') return false;
    if (!_isPathAllowedForWrite(filePath)) {
      console.warn(`[${platform.getName()} preload] 拒绝写入未授权路径`);
      return false;
    }
    // 扩展名白名单：即使路径已授权，也不允许写出可执行文件
    if (!WRITABLE_EXTENSIONS.has(path.extname(filePath.replace(/^file:\/\//, '')).toLowerCase())) {
      console.warn(`[${platform.getName()} preload] 拒绝写入非允许的扩展名`);
      return false;
    }
    try {
      const cleanedPath = filePath.replace(/^file:\/\//, '');
      const dirName = path.dirname(cleanedPath);
      // 仅在目录非盘符根目录时创建，避免 EPERM
      if (dirName && !/^[a-zA-Z]:\\?$/.test(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
      }

      let buffer;
      if (typeof data === 'string') {
        // base64 dataURL
        const base64Match = data.match(/^data:[^;]+;base64,(.+)$/i);
        if (base64Match) {
          buffer = Buffer.from(base64Match[1], 'base64');
        } else {
          // 纯 base64
          buffer = Buffer.from(data, 'base64');
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

  // 保存 ORA 文件对话框
  window.showSaveOraDialog = (suggestedName = 'project.ora') => {
    const hostTools = getHostTools();
    if (!hostTools || typeof hostTools.showSaveDialog !== 'function') return null;
    try {
      // suggestedName 来自页面，必须净化后才能作为默认路径（见 _buildDefaultSavePath）
      const defaultPath = _buildDefaultSavePath(suggestedName, 'project.ora');
      const result = hostTools.showSaveDialog({
        title: '保存 ORA 工程文件',
        defaultPath,
        filters: [
          { name: 'OpenRaster 工程文件', extensions: ['ora'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      // 用户通过保存对话框选定的目标路径视为已授权
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
    if (type === 'img' && payload) {
      // uTools img 匹配指令进入时，payload 是 dataURL 字符串
      if (typeof payload === 'string' && payload.startsWith('data:')) {
        return payload;
      }
      // 兼容 payload 为对象数组的情况
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

/**
 * 查找宿主 API 对象。
 *
 * 只在宿主 API 自身的键上查找（hostTools / ztools / utools），
 * 不回写任何别名：过去这里会把 ZTools API 额外别名成 window.utools，
 * 使页面侧「window.utools 存在即 uTools」的嗅探把 ZTools 误判成 uTools。
 *
 * 同时这里也不再往 window 上补挂 window.hostTools：
 * 那会让页面直接持有宿主全量 API（uTools 的 fs / shell / exec 等），
 * 与「页面只应看到最小 API 面」的目标冲突。宿主本来就在 preload 世界里
 * 提供了这些对象，直接在 preload 侧读取即可，不需要回写。
 */
const getHostTools = () => {
  if (typeof window === 'undefined') return null;
  return window.hostTools
    || window.ztools
    || window.utools
    || (typeof globalThis !== 'undefined' ? (globalThis.ztools || globalThis.utools) : null)
    || null;
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

/**
 * 定位插件根目录（含 plugin.json 的那一层）。
 *
 * 不能用 path.dirname(__dirname)：本文件位于 <插件根>/core/src/ 下，
 * 再向上一层得到的是 <插件根>/core，不是插件根。
 * 这里从本文件所在目录逐级向上查找 plugin.json，因此对
 * <插件根>/core/src/preloadHelpers.js 的实际位置不敏感。
 *
 * @returns {string} 插件根目录，未找到时为空字符串
 */
const findPluginRoot = () => {
  let dir = __dirname;

  for (let depth = 0; depth < 5; depth += 1) {
    try {
      if (fs.existsSync(path.join(dir, 'plugin.json'))) return dir;
    } catch (e) {
      return '';
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return '';
};

/**
 * 读取本插件自身的版本号（面向用户展示的发布版本）。
 *
 * 单一事实来源是插件根目录下的 plugin.json —— 它同时是 uTools / ZTools
 * 应用市场读取的发布版本，因此「关于」页展示它才能与市场版本一致。
 *
 * 注意不要与 getHostAppVersion() 混淆：后者返回的是宿主程序（uTools /
 * ZTools 客户端）自身的版本号。
 *
 * @returns {string} 版本号，读取失败时为空字符串
 */
const readPluginVersionFromManifest = () => {
  try {
    const pluginRoot = findPluginRoot();
    if (!pluginRoot) return '';

    const manifestPath = path.join(pluginRoot, 'plugin.json');
    if (!fs.existsSync(manifestPath)) return '';

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest && manifest.version ? String(manifest.version).trim() : '';
  } catch (e) {
    console.warn('[preload] 读取 plugin.json 版本失败:', e);
    return '';
  }
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
  return '宿主';
};

/**
 * 创建平台 preload 配置（减少 preload.js 之间的重复代码）
 * @param {object} opts - { name, apiKeys, userFnName, contactUrl }
 * @returns {object} platform 配置对象 + getHostTools + getHostAppVersion
 */
const createPlatformConfig = (opts) => {
  const { name, apiKeys, userFnName, contactUrl } = opts;

  const getHostTools = () => {
    if (typeof window === 'undefined') return null;
    for (const key of apiKeys) {
      if (window[key]) return window[key];
    }
    if (typeof globalThis !== 'undefined') {
      for (const key of apiKeys) {
        if (globalThis[key]) return globalThis[key];
      }
    }
    return null;
  };

  const getHostAppVersion = () => {
    const api = getHostTools();
    if (api && typeof api.getAppVersion === 'function') return api.getAppVersion();
    if (api && typeof api.getVersion === 'function') return api.getVersion();
    if (api && typeof api.getPluginVersion === 'function') return api.getPluginVersion();
    return 'unknown';
  };

  const platform = {
    getName: () => name,
    getApiKeys: () => apiKeys,
    getUserFnName: () => userFnName,
    getContactUrl: () => contactUrl,
    onPluginEnter: (callback) => {
      const api = getHostTools();
      if (api && typeof api.onPluginEnter === 'function') {
        api.onPluginEnter(callback);
      }
      return () => {};
    },
    onPluginOut: (callback) => {
      const api = getHostTools();
      if (api && typeof api.onPluginOut === 'function') {
        api.onPluginOut(callback);
      }
      return () => {};
    },
    openExternal: (url) => {
      const api = getHostTools();
      if (api && typeof api.shellOpenExternal === 'function') {
        api.shellOpenExternal(url);
        return true;
      }
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
      }
      return false;
    },
  };

  return { platform, getHostTools, getHostAppVersion };
};

/**
 * 初始化平台 preload（减少 preload.js 之间的重复代码）
 * @param {object} opts - { name, apiKeys, userFnName, contactUrl }
 */
const initPlatformPreload = (opts) => {
  const { name, userFnName } = opts;
  const { platform, getHostTools, getHostAppVersion } = createPlatformConfig(opts);

  initPreload(platform);

  // 注册平台特定 API
  window.getHostAppVersion = getHostAppVersion;
  window.getHostName = () => name;

  // 本插件版本号：优先读 plugin.json（发布版本的权威来源），
  // 读不到时退回宿主 API 暴露的插件版本；都取不到返回空字符串，
  // 由页面侧回退到 APP_VERSION。绝不返回宿主程序版本。
  window.getPluginVersion = () => {
    const fromManifest = readPluginVersionFromManifest();
    if (fromManifest) return fromManifest;

    const api = getHostTools();
    try {
      if (api && typeof api.getPluginVersion === 'function') {
        const version = api.getPluginVersion();
        if (version) return String(version);
      }
    } catch (e) {
      console.warn(`[${name} preload] 获取插件版本失败:`, e);
    }
    return '';
  };

  window[userFnName] = () => {
    const api = getHostTools();
    if (!api) return null;
    try {
      if (typeof api.getUser === 'function') return api.getUser();
      if (typeof api.getUserInfo === 'function') return api.getUserInfo();
    } catch (e) {
      console.warn(`[${name} preload] 获取宿主用户失败:`, e);
    }
    return null;
  };

  // 在 preload 阶段注册 onPluginEnter
  window.__pluginEnterAction = null;

  const api = getHostTools();
  if (api && typeof api.onPluginEnter === 'function') {
    api.onPluginEnter((action) => {
      console.log(`[${name} preload] onPluginEnter:`, action);
      window.__pluginEnterAction = action;

      if (action.code === 'image-edit') {
        const source = window.getImageSourceFromPluginPayload
          ? window.getImageSourceFromPluginPayload(action.type, action.payload)
          : null;

        if (source) {
          window.__imageSource = source;
        } else if (action.type === 'img' && window.__imageSource) {
          // 已有图片源，保持不变
        }

        // 设置窗口高度
        if (api && typeof api.setExpendHeight === 'function') {
          api.setExpendHeight(560);
        }
      }
    });
  }

  // 平台相关 API 注册完毕，重新执行一次桥接，把 getHostName /
  // getHostAppVersion / getPluginVersion 及用户 API 一并送进页面主世界。
  // 平台 API 已注册完毕，此后缺失告警才可信（见 _exposeApisToPage 内注释）
  _markBridgingComplete();
  _exposeApisToPage([...PAGE_API_NAMES, userFnName], name);
};

// 导出所有公共函数
module.exports = {
  initPreload,
  initPlatformPreload,
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
  _getHostName,
};
