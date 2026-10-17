/** The command label registered by the Paste plugin in ZTools. */
export const pasteShortcutCommandLabel = "pasteboard-pro/Paste剪切板";

export type ZToolsShortcutSettingsApi = Readonly<{
  redirectHotKeySetting?: (cmdLabel: string) => void | boolean;
}>;

/**
 * Opens ZTools' native shortcut settings when the host supports the public API.
 * The boolean result lets the renderer give useful feedback in Web Dev previews.
 */
export function openPasteShortcutSettings(
  ztools: ZToolsShortcutSettingsApi | undefined,
): boolean {
  if (typeof ztools?.redirectHotKeySetting !== "function") return false;
  try {
    return ztools.redirectHotKeySetting(pasteShortcutCommandLabel) !== false;
  } catch {
    return false;
  }
}
