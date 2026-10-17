import { describe, expect, it } from "vitest";

import {
  clipboardWindowRole,
  ownsClipboardHistoryMirror,
} from "../preload/clipboard-window-role";

describe("clipboard window responsibilities", () => {
  it("assigns clipboard history mirroring exclusively to the primary preload", () => {
    const primary = clipboardWindowRole(new URLSearchParams());
    const shelf = clipboardWindowRole(new URLSearchParams("shelf=1"));
    const panel = clipboardWindowRole(new URLSearchParams("panel=privacy"));

    expect(primary).toBe("primary");
    expect(shelf).toBe("shelf");
    expect(panel).toBe("panel");
    expect(ownsClipboardHistoryMirror(primary)).toBe(true);
    expect(ownsClipboardHistoryMirror(shelf)).toBe(false);
    expect(ownsClipboardHistoryMirror(panel)).toBe(false);
  });

  it("keeps a shelf window non-owning even if a panel parameter is present", () => {
    const role = clipboardWindowRole(
      new URLSearchParams("shelf=1&panel=privacy"),
    );
    expect(role).toBe("shelf");
    expect(ownsClipboardHistoryMirror(role)).toBe(false);
  });
});
