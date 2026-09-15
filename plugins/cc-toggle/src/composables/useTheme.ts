import { ref, computed, watch, reactive } from 'vue';
import { darkTheme, lightTheme } from 'naive-ui';
import { themes, defaultThemeName, getThemeByName, buildOverrides } from '../themes/index';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ThemeColors {
  primary: string;
  bg: string;
  bgCard: string;
  bgHover: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primaryHover: string;
  primaryPressed: string;
  primarySuppl: string;
  primaryLight: string;
  danger: string;
  dangerLight: string;
  success: string;
  successLight?: string;
  [key: string]: string | undefined;
}

interface ThemeConfig {
  name: string;
  label: string;
  colors: {
    light: ThemeColors;
    dark: ThemeColors;
  };
}

/** hex 颜色转 {r,g,b} */
function hexToRgb(hex: string): RgbColor {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 0, g: 0, b: 0 };
}

interface ThemeVars {
  primaryRgb: RgbColor;
  textMuted: string;
  success: string;
  primaryRgba: (a: number) => string;
}

/**
 * 全局主题色缓存 —— 切换主题时一次性更新，图表等组件直接读取，避免反复 getComputedStyle
 */
export const themeVars: ThemeVars = reactive({
  primaryRgb: { r: 217, g: 119, b: 6 },
  textMuted: '#94a3b8',
  success: '#16a34a',
  /** 用缓存的 RGB 生成 rgba 字符串，避免每次 getComputedStyle + 解析 */
  primaryRgba(a: number): string {
    const { r, g, b } = themeVars.primaryRgb;
    return `rgba(${r},${g},${b},${a})`;
  }
});

function syncThemeVars(colors: ThemeColors): void {
  themeVars.primaryRgb = hexToRgb(colors.primary);
  themeVars.textMuted = colors.textMuted;
  themeVars.success = colors.success;
}

const STORAGE_KEY = 'cctoggle-theme';
const DARK_KEY = 'cctoggle-dark';

// ---- 全局单例状态（多个组件调用 useTheme 共享同一份状态）----
const currentThemeName = ref(localStorage.getItem(STORAGE_KEY) || defaultThemeName);

// 深色模式：优先读取用户手动设置，否则跟随系统
const savedDark = localStorage.getItem(DARK_KEY);
const isDark = ref(
  savedDark !== null
    ? savedDark === 'true'
    : window.matchMedia('(prefers-color-scheme: dark)').matches
);

// 监听系统暗色模式变化（仅在用户未手动设置时跟随）
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e: MediaQueryListEvent) => {
      if (localStorage.getItem(DARK_KEY) === null) {
        isDark.value = e.matches;
      }
    });
}

/** 将颜色变量同步到 CSS 自定义属性 */
function syncCssVars(colors: ThemeColors): void {
  const root = document.documentElement;
  const map: Record<string, string> = {
    '--bg': colors.bg,
    '--bg-card': colors.bgCard,
    '--bg-hover': colors.bgHover,
    '--border': colors.border,
    '--text': colors.text,
    '--text-secondary': colors.textSecondary,
    '--text-muted': colors.textMuted,
    '--primary': colors.primary,
    '--primary-hover': colors.primaryHover,
    '--primary-pressed': colors.primaryPressed,
    '--primary-suppl': colors.primarySuppl,
    '--primary-light': colors.primaryLight,
    '--danger': colors.danger,
    '--danger-light': colors.dangerLight,
    '--success': colors.success,
    '--success-light': colors.successLight || colors.success
  };
  for (const [key, val] of Object.entries(map)) {
    root.style.setProperty(key, val);
  }
}

export function useTheme() {
  // ---- 计算属性 ----
  const currentTheme = computed(() => getThemeByName(currentThemeName.value));
  const themeColors = computed(() =>
    isDark.value ? currentTheme.value.colors.dark : currentTheme.value.colors.light
  );
  const theme = computed(() => (isDark.value ? darkTheme : lightTheme));
  const themeOverrides = computed(() => buildOverrides(currentTheme.value, isDark.value));

  // ---- 同步 CSS 变量 + 缓存 ----
  watch(
    themeColors,
    colors => {
      syncCssVars(colors);
      syncThemeVars(colors);
    },
    { immediate: true }
  );

  // ---- 持久化主题名称 ----
  watch(currentThemeName, name => {
    localStorage.setItem(STORAGE_KEY, name);
  });

  // ---- 方法 ----
  function setTheme(name: string): void {
    if (themes.some((t: any) => t.name === name)) {
      currentThemeName.value = name;
    }
  }

  function toggleDark(): void {
    isDark.value = !isDark.value;
    localStorage.setItem(DARK_KEY, String(isDark.value));
  }

  return {
    // 响应式状态
    theme,
    themeOverrides,
    isDark,
    currentThemeName,
    // 主题列表（供选择器用）
    themes,
    // 方法
    setTheme,
    toggleDark
  };
}
