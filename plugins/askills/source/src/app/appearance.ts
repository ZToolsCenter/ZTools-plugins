import { useLayoutEffect } from "react";
import type { Appearance } from "../lib/ipc/types";
import { pluginHost } from "../lib/host";

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  accentColor: "#005fb8",
  fontFamily: "Microsoft YaHei",
};

export function fontStack(family: string) {
  // Quote one family name so punctuation cannot inject extra CSS values.
  return `${JSON.stringify(family)}, "Microsoft YaHei", "微软雅黑", system-ui, sans-serif`;
}
export const ACCENT_PRESETS = [
  { name: "默认蓝", color: "#005fb8" },
  { name: "鸢尾紫", color: "#744da9" },
  { name: "青碧", color: "#007b83" },
  { name: "松绿", color: "#107c10" },
  { name: "琥珀", color: "#b05b00" },
  { name: "玫红", color: "#c23974" },
] as const;

export function isAccentColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}
function rgb(value: string) {
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
}
function mix(color: string, target: string, fraction: number) {
  const end = rgb(target);
  return (
    "#" +
    rgb(color)
      .map((value, index) =>
        Math.round(value * (1 - fraction) + end[index] * fraction)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function luminance(color: string) {
  const channels = rgb(color).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function accentPalette(input: string, dark: boolean) {
  const accent = isAccentColor(input)
    ? input.toLowerCase()
    : DEFAULT_APPEARANCE.accentColor;
  const surface = dark ? "#2c2c2c" : "#ffffff";
  const soft = mix(accent, surface, 0.9);
  const backgrounds = [
    surface,
    soft,
    dark ? "#202020" : "#f3f3f3",
    dark ? "#333333" : "#f7f7f7",
  ];
  const target = dark ? "#ffffff" : "#000000";
  let readable = accent;
  for (let step = 0; step <= 100; step++) {
    readable = mix(accent, target, step / 100);
    if (
      backgrounds.every(
        (background) => contrastRatio(readable, background) >= 4.5,
      )
    )
      break;
  }
  const foreground =
    contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#000000")
      ? "#ffffff"
      : "#000000";
  const awayFromForeground = foreground === "#ffffff" ? "#000000" : "#ffffff";
  return {
    accent,
    foreground,
    readable,
    soft,
    hover: mix(accent, awayFromForeground, 0.08),
    pressed: mix(accent, awayFromForeground, 0.16),
  };
}

export function useAppearance(appearance: Appearance) {
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font",
      fontStack(appearance.fontFamily || DEFAULT_APPEARANCE.fontFamily),
    );
  }, [appearance.fontFamily]);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const host = pluginHost();
    const apply = () => {
      const hostDark = host?.isDark();
      const dark =
        appearance.mode === "dark" ||
        (appearance.mode === "system" && (hostDark ?? media.matches));
      const root = document.documentElement;
      if (host) root.dataset.hostTheme = hostDark ? "dark" : "light";
      root.dataset.theme = dark ? "dark" : "light";
      root.style.colorScheme = dark ? "dark" : "light";
      const palette = accentPalette(appearance.accentColor, dark);
      for (const [name, value] of Object.entries({
        accent: palette.accent,
        "on-accent": palette.foreground,
        "accent-text": palette.readable,
        "accent-soft": palette.soft,
        "accent-hover": palette.hover,
        "accent-pressed": palette.pressed,
      }))
        root.style.setProperty(`--${name}`, value);
    };
    apply();
    const stopHostTheme = host?.onThemeChange(apply);
    media.addEventListener("change", apply);
    return () => {
      stopHostTheme?.();
      media.removeEventListener("change", apply);
    };
  }, [appearance.mode, appearance.accentColor]);
}
