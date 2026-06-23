const FALLBACK_FONT_OPTIONS = [
  { value: 'Microsoft YaHei, PingFang SC, sans-serif', label: '微软雅黑' },
  { value: 'SimSun, STSong, serif', label: '宋体' },
  { value: 'SimHei, STHeiti, sans-serif', label: '黑体' },
  { value: 'KaiTi, STKaiti, serif', label: '楷体' },
  { value: 'Arial, sans-serif', label: 'Arial' },
];

const FONT_USAGE_STORAGE_KEY = 'image-toolbox.font-usage';
const FONT_ALIAS_KEYS = new Map([
  ['microsoft yahei', '微软雅黑'],
  ['microsoft yahei ui', '微软雅黑'],
  ['simsun', '宋体'],
  ['nsimsun', '新宋体'],
  ['simhei', '黑体'],
  ['kaiti', '楷体'],
  ['fangsong', '仿宋'],
  ['stkaiti', '华文楷体'],
  ['stfangsong', '华文仿宋'],
]);

let systemFontOptionsCache = null;

export function getFontOptionsHTML(current) {
  const currentKey = _getFontKey(current);

  return _getFontOptions(current).map((option) => {
    const selected = currentKey && _getFontKey(option.value) === currentKey ? ' selected' : '';
    return `<option value="${_escapeHTML(option.value)}"${selected}>${_escapeHTML(option.label)}</option>`;
  }).join('');
}

export function recordFontUsage(fontFamily) {
  const key = _getFontKey(fontFamily);
  if (!key) return;

  const usage = _readFontUsage();
  const current = usage[key] || { count: 0, lastUsed: 0 };
  usage[key] = {
    count: Math.min((parseInt(current.count, 10) || 0) + 1, Number.MAX_SAFE_INTEGER),
    lastUsed: Date.now(),
  };
  _writeFontUsage(usage);
}

function _getFontOptions(current) {
  const systemOptions = _getSystemFontOptions();
  const sourceOptions = systemOptions.length > 0 ? systemOptions : FALLBACK_FONT_OPTIONS;
  const options = [];
  const seen = new Set();

  _sortFontOptions(sourceOptions).forEach((option) => {
    const key = _getFontKey(option.value);
    if (!key || seen.has(key)) return;

    seen.add(key);
    options.push(option);
  });

  const currentValue = String(current || '').trim();
  const currentKey = _getFontKey(currentValue);
  if (currentValue && currentKey && !seen.has(currentKey)) {
    options.unshift({ value: currentValue, label: currentValue });
  }

  return options;
}

function _getSystemFontOptions() {
  if (systemFontOptionsCache) return systemFontOptionsCache;

  try {
    const fonts = typeof window.getSystemFonts === 'function' ? window.getSystemFonts() : [];
    systemFontOptionsCache = Array.isArray(fonts)
      ? fonts.map((font) => String(font || '').trim()).filter(Boolean).map((font) => ({ value: font, label: font }))
      : [];
  } catch (e) {
    console.error('[fonts] 获取系统字体失败:', e);
    systemFontOptionsCache = [];
  }

  return systemFontOptionsCache;
}

function _sortFontOptions(options) {
  const usage = _readFontUsage();

  return options.slice().sort((a, b) => {
    const usageA = usage[_getFontKey(a.value)] || {};
    const usageB = usage[_getFontKey(b.value)] || {};
    const countA = parseInt(usageA.count, 10) || 0;
    const countB = parseInt(usageB.count, 10) || 0;
    if (countA !== countB) return countB - countA;

    const lastUsedA = parseInt(usageA.lastUsed, 10) || 0;
    const lastUsedB = parseInt(usageB.lastUsed, 10) || 0;
    if (lastUsedA !== lastUsedB) return lastUsedB - lastUsedA;

    return a.label.localeCompare(b.label, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

function _readFontUsage() {
  try {
    const value = localStorage.getItem(FONT_USAGE_STORAGE_KEY);
    const usage = value ? JSON.parse(value) : {};
    return usage && typeof usage === 'object' ? usage : {};
  } catch (e) {
    return {};
  }
}

function _writeFontUsage(usage) {
  try {
    localStorage.setItem(FONT_USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch (e) {
    // localStorage 不可用时仅失去排序记忆，不影响字体选择。
  }
}

function _getFontKey(value) {
  const primary = _normalizeFontValue(_getPrimaryFontName(value));
  return FONT_ALIAS_KEYS.get(primary) || primary;
}

function _getPrimaryFontName(value) {
  return String(value || '').split(',')[0].replace(/^['"]|['"]$/g, '').trim();
}

function _normalizeFontValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function _escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}
