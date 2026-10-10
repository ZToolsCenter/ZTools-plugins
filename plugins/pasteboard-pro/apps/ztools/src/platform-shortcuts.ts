/**
 * Renderer-friendly platform conventions for shortcuts. Keep the platform an
 * explicit input so keyboard behavior can be tested on any development host.
 */
export type ShortcutPlatform = "darwin" | "win32" | "linux";

export type PrimaryModifierEvent = Readonly<{
  metaKey: boolean;
  ctrlKey?: boolean;
}>;

export type ShortcutModifierEvent = PrimaryModifierEvent & Readonly<{
  altKey?: boolean;
}>;

export type PrimaryShortcutEvent = ShortcutModifierEvent & Readonly<{
  key: string;
  shiftKey?: boolean;
}>;

export function resolveShortcutPlatform(
  platform: string | undefined,
  browserPlatform: string | undefined =
    typeof navigator === "undefined" ? undefined : navigator.platform,
): ShortcutPlatform {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  if (platform === "linux") return "linux";
  if (/mac/i.test(browserPlatform ?? "")) return "darwin";
  if (/win/i.test(browserPlatform ?? "")) return "win32";
  return "linux";
}

export function hasPrimaryModifier(
  event: PrimaryModifierEvent,
  platform: ShortcutPlatform,
): boolean {
  return platform === "darwin" ? event.metaKey : event.ctrlKey === true;
}

/**
 * Matches the platform's primary modifier without also accepting the other
 * operating-system modifier or Alt. Shift is intentionally left to the
 * individual shortcut so Shift+primary can retain its existing meaning.
 */
export function hasPrimaryShortcutModifier(
  event: ShortcutModifierEvent,
  platform: ShortcutPlatform,
): boolean {
  if (!hasPrimaryModifier(event, platform) || event.altKey === true) return false;
  return platform === "darwin" ? event.ctrlKey !== true : !event.metaKey;
}

export function matchesPrimaryShortcut(
  event: PrimaryShortcutEvent,
  platform: ShortcutPlatform,
  key: string,
): boolean {
  return (
    hasPrimaryShortcutModifier(event, platform) &&
    event.shiftKey !== true &&
    event.key.toLowerCase() === key.toLowerCase()
  );
}

export function hasAnyCommandModifier(event: ShortcutModifierEvent): boolean {
  return event.metaKey || event.ctrlKey === true || event.altKey === true;
}

export function primaryModifierLabel(platform: ShortcutPlatform): "⌘" | "Ctrl" {
  return platform === "darwin" ? "⌘" : "Ctrl";
}

export function primaryModifierName(platform: ShortcutPlatform): "Command" | "Ctrl" {
  return platform === "darwin" ? "Command" : "Ctrl";
}
