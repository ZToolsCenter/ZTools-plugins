import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type PlatformKind = "mac" | "windows" | "linux" | "other";

export function getPlatformKind(): PlatformKind {
  if (typeof window === "undefined") return "other";
  const platform = navigator.platform || "";
  if (/Mac|iPod|iPhone|iPad/.test(platform)) return "mac";
  if (/Win/.test(platform)) return "windows";
  if (/Linux|X11/.test(platform)) return "linux";
  return "other";
}

export function isMacPlatform() {
  return getPlatformKind() === "mac";
}

export function getPrimaryModifierKeyLabel() {
  return isMacPlatform() ? "Command" : "Ctrl";
}

export function getPrimaryModifierKeyDisplay(
  options?: { style?: "symbol" | "text" },
  platform: PlatformKind = getPlatformKind(),
) {
  const style = options?.style ?? "symbol";

  if (platform === "mac") {
    return style === "symbol" ? "⌘" : "Command";
  }

  // Win/Linux/other: 当前快捷键主键都是 Ctrl
  return "Ctrl";
}

export function formatShortcut(
  shortcut: string,
  platform: PlatformKind = getPlatformKind(),
) {
  const isMac = platform === "mac";

  return shortcut
    .split("+")
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (
        p === "mod" ||
        p === "cmdorctrl" ||
        p === "cmdorcontrol" ||
        p === "commandorcontrol" ||
        p === "command" ||
        p === "meta"
      ) {
        return isMac ? "⌘" : "Ctrl";
      }
      if (p === "ctrl" || p === "control") return isMac ? "⌃" : "Ctrl";
      if (p === "alt" || p === "option") return isMac ? "⌥" : "Alt";
      if (p === "shift") return isMac ? "⇧" : "Shift";
      if (p === "plus") return "+";
      if (p === "enter") return "↵";
      if (p === "backspace") return "⌫";
      if (p === "tab") return "⇥";
      if (p === "esc" || p === "escape") return isMac ? "⎋" : "Esc";
      if (p === "up") return "↑";
      if (p === "down") return "↓";
      if (p === "left") return "←";
      if (p === "right") return "→";
      if (p === "mouseback") return "鼠标后退键";
      if (p === "mouseforward") return "鼠标前进键";
      return part.trim();
    })
    .join(isMac ? "" : " + ");
}
