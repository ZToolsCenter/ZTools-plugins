/**
 * restoreFileChange：kind 矩阵 + binary/truncated/fs + canRestore helpers。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useFileChanges,
  type FileChange,
} from "@/stores/useFileChanges";

const files = new Map<string, string>();
let fsAvailable = true;
let writeShouldFail = false;
let removeShouldFail = false;

vi.mock("@/lib/fs", () => ({
  isFsAvailable: () => fsAvailable,
  writeFile: async (p: string, content: string) => {
    if (writeShouldFail) return false;
    files.set(p, content);
    return true;
  },
  removeFile: async (p: string) => {
    if (removeShouldFail) return false;
    return files.delete(p);
  },
  exists: async (p: string) => files.has(p),
  rename: async () => false,
}));

import {
  canRestoreFileChange,
  getRestoreBlockReason,
  getRestoreConfirmCopy,
  restoreFileChange,
} from "../restoreChange";

function base(
  partial: Partial<FileChange> &
    Pick<FileChange, "path" | "kind" | "before" | "after">,
): FileChange {
  return {
    id: partial.id ?? "fc-1",
    conversationId: partial.conversationId ?? "conv-1",
    path: partial.path,
    fromPath: partial.fromPath,
    kind: partial.kind,
    before: partial.before,
    after: partial.after,
    truncated: partial.truncated,
    binary: partial.binary,
    toolCallId: partial.toolCallId,
    updatedAt: partial.updatedAt ?? 1,
  };
}

beforeEach(() => {
  files.clear();
  fsAvailable = true;
  writeShouldFail = false;
  removeShouldFail = false;
  useFileChanges.getState().clearAll();
});

describe("canRestore / getRestoreBlockReason / getRestoreConfirmCopy", () => {
  it("blocks binary and truncated", () => {
    expect(
      getRestoreBlockReason(
        base({
          path: "/a",
          kind: "modify",
          before: "x",
          after: "y",
          binary: true,
        }),
      ),
    ).toBe("二进制文件无法还原");
    expect(
      canRestoreFileChange(
        base({
          path: "/a",
          kind: "modify",
          before: "x",
          after: "y",
          truncated: true,
        }),
      ),
    ).toBe(false);
  });

  it("create is restorable even with before null", () => {
    expect(
      canRestoreFileChange(
        base({
          path: "/a",
          kind: "create",
          before: null,
          after: "n",
        }),
      ),
    ).toBe(true);
  });

  it("non-create with before null is blocked", () => {
    expect(
      getRestoreBlockReason(
        base({
          path: "/a",
          kind: "modify",
          before: null,
          after: "x",
        }),
      ),
    ).toBe("无可用快照，无法还原");
    expect(
      canRestoreFileChange(
        base({
          path: "/a",
          kind: "delete",
          before: null,
          after: null,
        }),
      ),
    ).toBe(false);
  });

  it("empty string before is restorable for modify", () => {
    expect(
      canRestoreFileChange(
        base({
          path: "/a",
          kind: "modify",
          before: "",
          after: "x",
        }),
      ),
    ).toBe(true);
  });

  it("confirm copy mentions kind and irreversible", () => {
    const create = getRestoreConfirmCopy(
      base({ path: "/a", kind: "create", before: null, after: "n" }),
    );
    expect(create.title).toBe("还原此文件");
    expect(create.description).toContain("删除此新建文件");
    expect(create.description).toContain("此操作不可撤销。");

    const modify = getRestoreConfirmCopy(
      base({ path: "/a", kind: "modify", before: "b", after: "a" }),
    );
    expect(modify.description).toContain("变更前快照覆盖");

    const del = getRestoreConfirmCopy(
      base({ path: "/a", kind: "delete", before: "b", after: null }),
    );
    expect(del.description).toContain("删除前快照写回");

    const rename = getRestoreConfirmCopy(
      base({
        path: "/to",
        fromPath: "/from",
        kind: "rename",
        before: "b",
        after: "a",
      }),
    );
    expect(rename.description).toContain("重命名前的路径");
  });
});

describe("restoreFileChange", () => {
  it("rejects binary", async () => {
    const change = base({
      path: "/ws/a.bin",
      kind: "modify",
      before: "x",
      after: "y",
      binary: true,
    });
    useFileChanges.getState().recordChange(change);
    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: false, error: "二进制文件无法还原" });
    expect(useFileChanges.getState().count("conv-1")).toBe(1);
  });

  it("rejects truncated", async () => {
    const change = base({
      path: "/ws/a.txt",
      kind: "modify",
      before: "x",
      after: "y",
      truncated: true,
    });
    const r = await restoreFileChange(change);
    expect(r).toEqual({
      ok: false,
      error: "内容已截断，无法安全还原",
    });
  });

  it("rejects when fs unavailable", async () => {
    fsAvailable = false;
    const r = await restoreFileChange(
      base({
        path: "/ws/a.txt",
        kind: "create",
        before: null,
        after: "new",
      }),
    );
    expect(r).toEqual({ ok: false, error: "本机文件桥不可用" });
  });

  it("create: removeFile then removeChange", async () => {
    files.set("/ws/new.txt", "created");
    const change = base({
      path: "/ws/new.txt",
      kind: "create",
      before: null,
      after: "created",
    });
    useFileChanges.getState().recordChange(change);

    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(files.has("/ws/new.txt")).toBe(false);
    expect(
      useFileChanges.getState().getChange("conv-1", "/ws/new.txt"),
    ).toBeUndefined();
  });

  it("create: file already missing is success", async () => {
    const change = base({
      path: "/ws/gone.txt",
      kind: "create",
      before: null,
      after: "was new",
    });
    useFileChanges.getState().recordChange(change);

    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(
      useFileChanges.getState().getChange("conv-1", "/ws/gone.txt"),
    ).toBeUndefined();
  });

  it("modify: writeFile(path, before) including empty string", async () => {
    files.set("/ws/m.txt", "after");
    const change = base({
      path: "/ws/m.txt",
      kind: "modify",
      before: "",
      after: "after",
    });
    useFileChanges.getState().recordChange(change);

    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(files.get("/ws/m.txt")).toBe("");
    expect(useFileChanges.getState().count("conv-1")).toBe(0);
  });

  it("modify: fails when before is null", async () => {
    const r = await restoreFileChange(
      base({
        path: "/ws/m.txt",
        kind: "modify",
        before: null,
        after: "x",
      }),
    );
    expect(r).toEqual({ ok: false, error: "无可用快照，无法还原" });
  });

  it("delete: writeFile(path, before)", async () => {
    const change = base({
      path: "/ws/d.txt",
      kind: "delete",
      before: "restored body",
      after: null,
    });
    useFileChanges.getState().recordChange(change);

    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(files.get("/ws/d.txt")).toBe("restored body");
    expect(
      useFileChanges.getState().getChange("conv-1", "/ws/d.txt"),
    ).toBeUndefined();
  });

  it("delete: fails when before is null", async () => {
    const r = await restoreFileChange(
      base({
        path: "/ws/d.txt",
        kind: "delete",
        before: null,
        after: null,
      }),
    );
    expect(r).toEqual({ ok: false, error: "无可用快照，无法还原" });
    expect(files.has("/ws/d.txt")).toBe(false);
  });

  it("rename: remove path and write fromPath with before", async () => {
    files.set("/ws/to.txt", "moved");
    const change = base({
      path: "/ws/to.txt",
      fromPath: "/ws/from.txt",
      kind: "rename",
      before: "original",
      after: "moved",
    });
    useFileChanges.getState().recordChange(change);

    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(files.has("/ws/to.txt")).toBe(false);
    expect(files.get("/ws/from.txt")).toBe("original");
    expect(
      useFileChanges.getState().getChange("conv-1", "/ws/to.txt"),
    ).toBeUndefined();
  });

  it("rename without fromPath: write path with before", async () => {
    files.set("/ws/only.txt", "new");
    const change = base({
      path: "/ws/only.txt",
      kind: "rename",
      before: "old",
      after: "new",
    });
    useFileChanges.getState().recordChange(change);

    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(files.get("/ws/only.txt")).toBe("old");
  });

  it("rename with fromPath and empty before writes empty string", async () => {
    files.set("/ws/to.txt", "x");
    const change = base({
      path: "/ws/to.txt",
      fromPath: "/ws/from.txt",
      kind: "rename",
      before: "",
      after: "x",
    });
    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: true });
    expect(files.get("/ws/from.txt")).toBe("");
  });

  it("rename with fromPath and null before is blocked at gate", async () => {
    files.set("/ws/to.txt", "x");
    const r = await restoreFileChange(
      base({
        path: "/ws/to.txt",
        fromPath: "/ws/from.txt",
        kind: "rename",
        before: null,
        after: "x",
      }),
    );
    expect(r).toEqual({ ok: false, error: "无可用快照，无法还原" });
  });

  it("fs write failure returns 还原失败 and keeps store entry", async () => {
    writeShouldFail = true;
    const change = base({
      path: "/ws/f.txt",
      kind: "modify",
      before: "b",
      after: "a",
    });
    useFileChanges.getState().recordChange(change);
    const r = await restoreFileChange(change);
    expect(r).toEqual({ ok: false, error: "还原失败" });
    expect(useFileChanges.getState().count("conv-1")).toBe(1);
  });

  it("create remove failure returns 还原失败", async () => {
    removeShouldFail = true;
    files.set("/ws/n.txt", "x");
    const r = await restoreFileChange(
      base({
        path: "/ws/n.txt",
        kind: "create",
        before: null,
        after: "x",
      }),
    );
    expect(r).toEqual({ ok: false, error: "还原失败" });
  });
});

describe("useFileChanges.removeChange", () => {
  it("removes only matching path and clears focus", () => {
    const store = useFileChanges.getState();
    store.recordChange({
      conversationId: "c",
      path: "/a",
      kind: "create",
      before: null,
      after: "1",
    });
    store.recordChange({
      conversationId: "c",
      path: "/b",
      kind: "create",
      before: null,
      after: "2",
    });
    store.setFocusPath("/a");
    store.removeChange("c", "/a");
    expect(useFileChanges.getState().getChange("c", "/a")).toBeUndefined();
    expect(useFileChanges.getState().getChange("c", "/b")).toBeDefined();
    expect(useFileChanges.getState().focusPath).toBeNull();
  });
});
