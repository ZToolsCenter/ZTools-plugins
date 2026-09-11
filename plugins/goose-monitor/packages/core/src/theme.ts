/** 外观偏好与 data-theme 同步。pk_theme：auto | light | dark */

export const THEME_PREF_KEY = "pk_theme";

export type UiTheme = "dark" | "light";
export type ThemePref = "auto" | "dark" | "light";

interface UtoolsHost {
  isDarkColors?: () => boolean;
}

function readUtoolsHost(): UtoolsHost | null {
  const candidate = window.utools;
  if (candidate !== null && typeof candidate === "object") {
    return candidate as UtoolsHost;
  }
  return null;
}

export function parseThemePref(saved: string | null): ThemePref {
  if (saved === "auto" || saved === "light" || saved === "dark") return saved;
  return "auto";
}

export function resolveEffectiveTheme(pref: ThemePref, followUtools: boolean): UiTheme {
  if (pref === "light" || pref === "dark") return pref;
  if (followUtools) {
    const u = readUtoolsHost();
    if (typeof u?.isDarkColors === "function") {
      return u.isDarkColors() ? "dark" : "light";
    }
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

export function resolveThemeState(
  saved: string | null,
  followUtools: boolean,
): { theme: UiTheme; themePref: ThemePref } {
  const themePref = parseThemePref(saved);
  return { themePref, theme: resolveEffectiveTheme(themePref, followUtools) };
}

export function applyDataTheme(theme: UiTheme, extraEls?: HTMLElement[]): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  document.body.setAttribute("data-theme", theme);
  for (const el of extraEls ?? []) {
    el.setAttribute("data-theme", theme);
  }
}

export function installSystemThemeWatch(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => onChange();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
