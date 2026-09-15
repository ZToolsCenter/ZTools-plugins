import { expect, test } from "playwright/test";
import {
  formatShortcut,
  getPrimaryModifierKeyDisplay,
} from "../../src/lib/utils";

test("shortcut labels follow the current platform", () => {
  expect(formatShortcut("Mod+1–5", "mac")).toBe("⌘1–5");
  expect(formatShortcut("Mod+1–5", "windows")).toBe("Ctrl + 1–5");
  expect(formatShortcut("Mod+1–5", "linux")).toBe("Ctrl + 1–5");

  expect(formatShortcut("Mod+Shift+Z", "mac")).toBe("⌘⇧Z");
  expect(formatShortcut("Mod+Shift+Z", "windows")).toBe("Ctrl + Shift + Z");
  expect(formatShortcut("Alt+W", "mac")).toBe("⌥W");
  expect(formatShortcut("Alt+W", "windows")).toBe("Alt + W");
  expect(formatShortcut("Ctrl+,", "mac")).toBe("⌃,");
  expect(formatShortcut("Ctrl+,", "windows")).toBe("Ctrl + ,");
});

test("plus keys and non-Mac primary modifiers stay unambiguous", () => {
  expect(formatShortcut("Mod+Plus", "mac")).toBe("⌘+");
  expect(formatShortcut("Mod+Plus", "windows")).toBe("Ctrl + +");
  expect(getPrimaryModifierKeyDisplay({ style: "symbol" }, "mac")).toBe("⌘");
  expect(getPrimaryModifierKeyDisplay({ style: "symbol" }, "windows")).toBe(
    "Ctrl",
  );
  expect(getPrimaryModifierKeyDisplay({ style: "symbol" }, "linux")).toBe(
    "Ctrl",
  );
});
