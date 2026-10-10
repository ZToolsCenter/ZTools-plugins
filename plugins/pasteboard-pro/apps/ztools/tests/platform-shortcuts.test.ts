import { describe, expect, it } from "vitest";

import {
  hasPrimaryModifier,
  hasPrimaryShortcutModifier,
  matchesPrimaryShortcut,
  hasAnyCommandModifier,
  primaryModifierLabel,
  primaryModifierName,
  resolveShortcutPlatform,
} from "../src/platform-shortcuts";

describe("platform shortcut conventions", () => {
  it("maps macOS to Command and Windows/Linux to Ctrl", () => {
    expect(resolveShortcutPlatform("darwin")).toBe("darwin");
    expect(resolveShortcutPlatform("win32")).toBe("win32");
    expect(resolveShortcutPlatform("linux")).toBe("linux");
    expect(resolveShortcutPlatform(undefined, "MacIntel")).toBe("darwin");
    expect(resolveShortcutPlatform(undefined, "Win32")).toBe("win32");
    expect(resolveShortcutPlatform(undefined, "Linux x86_64")).toBe("linux");

    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false }, "darwin")).toBe(true);
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true }, "win32")).toBe(true);
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true }, "linux")).toBe(true);
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false }, "win32")).toBe(false);
    expect(
      hasPrimaryShortcutModifier(
        { metaKey: false, ctrlKey: true, altKey: false },
        "win32",
      ),
    ).toBe(true);
    expect(
      hasPrimaryShortcutModifier(
        { metaKey: true, ctrlKey: true, altKey: false },
        "win32",
      ),
    ).toBe(false);
    expect(
      hasPrimaryShortcutModifier(
        { metaKey: true, ctrlKey: false, altKey: true },
        "darwin",
      ),
    ).toBe(false);
    expect(hasAnyCommandModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasAnyCommandModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(hasAnyCommandModifier({ metaKey: false, ctrlKey: false, altKey: true })).toBe(true);
    expect(hasAnyCommandModifier({ metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
  });

  it("exposes platform-appropriate labels", () => {
    expect(primaryModifierLabel("darwin")).toBe("⌘");
    expect(primaryModifierLabel("win32")).toBe("Ctrl");
    expect(primaryModifierName("darwin")).toBe("Command");
    expect(primaryModifierName("linux")).toBe("Ctrl");
  });

  it("matches Paste shelf shortcuts with Ctrl on Windows/Linux", () => {
    for (const key of ["f", "n", "c", "t", "e", "r"]) {
      expect(
        matchesPrimaryShortcut(
          { key, metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
          "win32",
          key,
        ),
      ).toBe(true);
      expect(
        matchesPrimaryShortcut(
          { key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
          "win32",
          key,
        ),
      ).toBe(false);
    }

    expect(
      matchesPrimaryShortcut(
        { key: "f", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        "win32",
        "f",
      ),
    ).toBe(false);
  });
});
