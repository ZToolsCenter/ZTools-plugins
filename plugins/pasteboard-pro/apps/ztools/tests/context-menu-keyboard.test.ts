import { describe, expect, it, vi } from "vitest";

import { containContextMenuKeydown } from "../src/context-menu-keyboard";

describe("Pinboard context-menu keyboard containment", () => {
  it.each(["Enter", " "])("keeps %s inside the context menu", (key) => {
    const stopPropagation = vi.fn();
    const close = vi.fn();

    containContextMenuKeydown({ key, stopPropagation }, close);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the context menu without propagating Escape", () => {
    const stopPropagation = vi.fn();
    const close = vi.fn();

    containContextMenuKeydown({ key: "Escape", stopPropagation }, close);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
