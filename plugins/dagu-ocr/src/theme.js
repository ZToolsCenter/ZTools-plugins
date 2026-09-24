// 主色解析规则与 ZTools 主进程保持一致：
// 只有 primaryColor === 'custom' 时才使用 customColor，否则按命名主题取色阶。
// 插件页面始终使用浅色画布，因此取浅色色阶，保证白色文字有足够对比。
const PRIMARY_COLOR_MAP = {
  blue: '#0284c7',
  purple: '#7c3aed',
  green: '#059669',
  orange: '#ea580c',
  red: '#dc2626',
  pink: '#db2777'
};

const DERIVED_TOKENS = ['--primary-color', '--primary-hover', '--primary-contrast', '--accent-soft', '--focus-ring'];

export function resolveThemePrimaryColor(theme = {}) {
  const named = String(theme.primaryColor || '');
  const custom = String(theme.customColor || '');
  if (named === 'custom' && /^#[0-9a-f]{6}$/i.test(custom)) return custom.toLowerCase();
  return PRIMARY_COLOR_MAP[named] || PRIMARY_COLOR_MAP.green;
}

function parseHexColor(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

// 主色按钮上的文字需要按亮度自动选黑/白，自定义亮色时不会出现白字发虚。
function contrastColor({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1f2937' : '#ffffff';
}

export function createZtoolsThemeSync({ win = window, doc = document } = {}) {
  const root = doc.documentElement;

  const clearDerivedTokens = () => {
    DERIVED_TOKENS.forEach((token) => root.style.removeProperty(token));
  };

  const applyColor = (color) => {
    const rgb = parseHexColor(color);
    if (!rgb) {
      clearDerivedTokens();
      return;
    }
    const hover = toHex({ r: rgb.r * 0.88, g: rgb.g * 0.88, b: rgb.b * 0.88 });
    root.style.setProperty('--primary-color', toHex(rgb));
    root.style.setProperty('--primary-hover', hover);
    root.style.setProperty('--primary-contrast', contrastColor(rgb));
    root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .10)`);
    root.style.setProperty('--focus-ring', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .28)`);
  };

  // 宿主会注入 --plugin-primary-color（含自定义色判定），优先直接采用它。
  const hostInjectedColor = () => {
    try {
      const value = win.getComputedStyle?.(root)?.getPropertyValue?.('--plugin-primary-color')?.trim();
      return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '';
    } catch {
      return '';
    }
  };

  const applyTheme = (theme = {}) => {
    applyColor(hostInjectedColor() || resolveThemePrimaryColor(theme));
  };

  const host = win.ztools;
  if (typeof host?.getThemeInfo === 'function' && typeof host?.onThemeChange === 'function') {
    applyTheme(host.getThemeInfo());
    host.onThemeChange(applyTheme);
    return clearDerivedTokens;
  }

  return () => {};
}
