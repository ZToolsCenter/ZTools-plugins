import { getPlatformKind, type PlatformKind } from "@/lib/utils";

export const FIXED_APP_SHORTCUT_IDS = [
  "openSettings",
  "editorFindOpen",
  "newNote",
  "reopenTab",
] as const;

export type FixedAppShortcutId = (typeof FIXED_APP_SHORTCUT_IDS)[number];

/** 旧版本提供过配置入口，但现在不再保留的动作。 */
export const REMOVED_APP_SHORTCUT_IDS = ["saveNote"] as const;

export const NON_CUSTOMIZABLE_APP_SHORTCUT_IDS = new Set<string>([
  ...FIXED_APP_SHORTCUT_IDS,
  ...REMOVED_APP_SHORTCUT_IDS,
]);

export function getFixedAppShortcuts(
  platform: PlatformKind = getPlatformKind(),
): Record<FixedAppShortcutId, string> {
  return {
    openSettings: platform === "mac" ? "Ctrl+," : "Alt+,",
    editorFindOpen: "Mod+F",
    newNote: "Mod+N",
    reopenTab: "Mod+Shift+T",
  };
}
