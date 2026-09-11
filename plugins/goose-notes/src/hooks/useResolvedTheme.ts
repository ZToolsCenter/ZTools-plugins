import { useCallback, useSyncExternalStore } from "react";
import type { Theme } from "@/stores/useSettings";

export type ResolvedTheme = "light" | "dark";

function getSystemPrefersDark(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(
  theme: Theme,
  systemPrefersDark = getSystemPrefersDark(),
): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "system" && systemPrefersDark) return "dark";
  return "light";
}

/**
 * 将“跟随系统”解析成可直接渲染的主题，并订阅系统主题的实时变化。
 * 同时兼容仍只提供 addListener/removeListener 的旧 Chromium 内核。
 */
export function useResolvedTheme(theme: Theme): ResolvedTheme {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (theme !== "system" || typeof window === "undefined") return () => {};

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    }

    mediaQuery.addListener(onStoreChange);
    return () => mediaQuery.removeListener(onStoreChange);
  }, [theme]);

  const getSnapshot = useCallback(() => resolveTheme(theme), [theme]);
  const getServerSnapshot = useCallback(() => resolveTheme(theme, false), [theme]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
