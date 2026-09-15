import { describe, expect, it, vi } from "vitest";

import {
  openPasteShortcutSettings,
  pasteShortcutCommandLabel,
} from "../src/hotkey-settings";

describe("Paste shortcut settings entry", () => {
  it("redirects to Paste's canonical ZTools command label", () => {
    const redirectHotKeySetting = vi.fn();

    expect(openPasteShortcutSettings({ redirectHotKeySetting })).toBe(true);
    expect(redirectHotKeySetting).toHaveBeenCalledWith(pasteShortcutCommandLabel);
    expect(pasteShortcutCommandLabel).toBe("pasteboard-pro/Paste剪切板");
  });

  it("reports when the ZTools public API is unavailable", () => {
    expect(openPasteShortcutSettings(undefined)).toBe(false);
    expect(openPasteShortcutSettings({})).toBe(false);
  });

  it("reports host rejection or redirect errors", () => {
    expect(
      openPasteShortcutSettings({ redirectHotKeySetting: () => false }),
    ).toBe(false);
    expect(
      openPasteShortcutSettings({
        redirectHotKeySetting: () => {
          throw new Error("host unavailable");
        },
      }),
    ).toBe(false);
  });
});
