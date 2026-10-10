import { describe, expect, it } from "vitest";

import { isListNavigationKey, shouldResumeListControl } from "../src/list-control-key";

describe("search to list keyboard handoff", () => {
  it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"])(
    "hands %s back to the list",
    (key) => {
      expect(shouldResumeListControl({ key, metaKey: false, altKey: false })).toBe(true);
    },
  );

  it("keeps text entry and modified shortcuts in the search field", () => {
    expect(shouldResumeListControl({ key: "a", metaKey: false, altKey: false })).toBe(false);
    expect(shouldResumeListControl({ key: "ArrowDown", metaKey: true, altKey: false })).toBe(false);
    expect(shouldResumeListControl({ key: "Enter", metaKey: false, altKey: true })).toBe(false);
  });

  it("keeps Ctrl navigation and activation in a Windows/Linux search field", () => {
    expect(
      shouldResumeListControl(
        { key: "ArrowDown", metaKey: false, ctrlKey: true, altKey: false },
      ),
    ).toBe(false);
    expect(
      shouldResumeListControl(
        { key: "Enter", metaKey: false, ctrlKey: true, altKey: false },
      ),
    ).toBe(false);
    expect(
      shouldResumeListControl(
        { key: "Enter", metaKey: false, ctrlKey: false, altKey: false },
      ),
    ).toBe(true);
  });

  it("distinguishes focus-only navigation from list activation", () => {
    expect(isListNavigationKey("ArrowDown")).toBe(true);
    expect(isListNavigationKey("Enter")).toBe(false);
  });
});
