// 主色与深浅色都跟随 ZTools，规则与其主进程保持一致：
// - 只有 primaryColor === 'custom' 时才使用 customColor，否则按命名主题取色阶，深色下取深色一组；
// - 深浅色取宿主的 isDark（宿主设置默认跟随系统）。宿主没有主题接口时（浏览器）深浅色取系统的 prefers-color-scheme。
const PRIMARY_COLORS = {
  light: { blue: '#0284c7', purple: '#7c3aed', green: '#059669', orange: '#ea580c', red: '#dc2626', pink: '#db2777' },
  dark: { blue: '#38bdf8', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', pink: '#f472b6' }
};

const DERIVED_TOKENS = ['--primary-color', '--primary-hover', '--primary-contrast', '--accent-soft', '--focus-ring'];

export function resolveThemePrimaryColor(theme = {}) {
  const palette = theme.isDark ? PRIMARY_COLORS.dark : PRIMARY_COLORS.light;
  const named = String(theme.primaryColor || '');
  const custom = String(theme.customColor || '');
  if (named === 'custom' && /^#[0-9a-f]{6}$/i.test(custom)) return custom.toLowerCase();
  return palette[named] || palette.green;
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

// 主色按钮上的文字按亮度自动选黑/白，自定义亮色时不会出现白字发虚。
// 深色下宿主的主色都是偏亮的一组，深色文字的门槛相应放低，否则浅色按钮上会出现白字。
function contrastColor({ r, g, b }, isDark) {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > (isDark ? 0.5 : 0.62) ? '#1f2937' : '#ffffff';
}

export function createZtoolsThemeSync({ win = window, doc = document } = {}) {
  const root = doc.documentElement;

  const clearDerivedTokens = () => {
    DERIVED_TOKENS.forEach((token) => root.style.removeProperty(token));
  };
  // 样式表里 html.dark 这一组变量随之生效。
  const setDark = (isDark) => {
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  };

  const applyColor = (color, isDark) => {
    const rgb = parseHexColor(color);
    if (!rgb) {
      clearDerivedTokens();
      return;
    }
    const hover = toHex({ r: rgb.r * 0.88, g: rgb.g * 0.88, b: rgb.b * 0.88 });
    root.style.setProperty('--primary-color', toHex(rgb));
    root.style.setProperty('--primary-hover', hover);
    root.style.setProperty('--primary-contrast', contrastColor(rgb, isDark));
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
    const isDark = Boolean(theme?.isDark);
    setDark(isDark);
    applyColor(hostInjectedColor() || resolveThemePrimaryColor(theme), isDark);
  };

  const host = win.ztools;
  if (typeof host?.getThemeInfo === 'function' && typeof host?.onThemeChange === 'function') {
    applyTheme(host.getThemeInfo());
    host.onThemeChange(applyTheme);
    return () => {
      clearDerivedTokens();
      setDark(false);
    };
  }

  // 没有宿主主题接口（普通浏览器）：深浅色取系统设置，主色沿用样式表里的默认值。
  let media = null;
  try {
    media = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  } catch {
    media = null;
  }
  if (!media) return () => {};
  const applySystem = (event) => setDark(Boolean(event?.matches));
  applySystem(media);
  media.addEventListener?.('change', applySystem);
  return () => {
    media.removeEventListener?.('change', applySystem);
    setDark(false);
  };
}
