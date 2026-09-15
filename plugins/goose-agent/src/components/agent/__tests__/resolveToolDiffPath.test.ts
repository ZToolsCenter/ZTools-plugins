import { describe, expect, it } from "vitest";
import { resolveToolDiffPath } from "../ToolProgressCard";

describe("resolveToolDiffPath", () => {
  it("prefers absolute output.path over relative input for writeFile", () => {
    const path = resolveToolDiffPath({
      type: "tool-writeFile",
      state: "output-available",
      input: { path: "a.txt", content: "x" },
      output: { ok: true, path: "/ws/proj/a.txt", changeKind: "create" },
    });
    expect(path).toBe("/ws/proj/a.txt");
  });

  it("prefers absolute output.path for deletePath", () => {
    const path = resolveToolDiffPath({
      type: "tool-deletePath",
      state: "output-available",
      input: { path: "gone.txt" },
      output: {
        ok: true,
        path: "/ws/proj/gone.txt",
        kind: "file",
        changeKind: "delete",
      },
    });
    expect(path).toBe("/ws/proj/gone.txt");
  });

  it("renamePath prefers absolute output.to (store key)", () => {
    const path = resolveToolDiffPath({
      type: "tool-renamePath",
      state: "output-available",
      input: { from: "old.txt", to: "new.txt" },
      output: {
        ok: true,
        from: "/ws/proj/old.txt",
        to: "/ws/proj/new.txt",
        changeKind: "rename",
      },
    });
    expect(path).toBe("/ws/proj/new.txt");
  });

  it("falls back to input when output missing", () => {
    expect(
      resolveToolDiffPath({
        type: "tool-writeFile",
        state: "call",
        input: { path: "pending.txt" },
      }),
    ).toBe("pending.txt");
  });
});
