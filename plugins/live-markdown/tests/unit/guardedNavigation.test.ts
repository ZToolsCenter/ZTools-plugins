import { describe, expect, it, vi } from "vitest";
import { runGuardedNavigation } from "../../src/core/guardedNavigation";

describe("guarded document transitions", () => {
  it.each(["file tree", "plugin entry", "sample", "new document", "remote document"])("blocks %s when saving is canceled or fails", async (source) => {
    const transition = vi.fn();
    const completed = await runGuardedNavigation(async () => false, transition);
    expect(completed, source).toBe(false);
    expect(transition).not.toHaveBeenCalled();
  });

  it("runs the transition only after the current document is safe", async () => {
    const transition = vi.fn();
    const completed = await runGuardedNavigation(async () => true, transition);
    expect(completed).toBe(true);
    expect(transition).toHaveBeenCalledOnce();
  });
});
