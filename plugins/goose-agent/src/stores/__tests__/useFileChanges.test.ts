import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CHANGE_CONVERSATIONS,
  MAX_CHANGES_PER_CONVERSATION,
  MAX_CONTENT_CHARS,
  clampContent,
  normalizeByConversation,
  normalizeFileChange,
  trimChangesList,
  trimConversations,
  useFileChanges,
} from "../useFileChanges";

const CONV = "conv-test-1";
const CONV2 = "conv-test-2";

beforeEach(() => {
  useFileChanges.getState().clearAll();
});

describe("useFileChanges", () => {
  it("records create and merges later modify: earliest before + latest after", () => {
    const store = useFileChanges.getState();
    store.recordChange({
      conversationId: CONV,
      path: "/ws/a.txt",
      kind: "create",
      before: null,
      after: "v1",
    });
    store.recordChange({
      conversationId: CONV,
      path: "/ws/a.txt",
      kind: "modify",
      before: "v1",
      after: "v2",
    });

    const change = useFileChanges.getState().getChange(CONV, "/ws/a.txt");
    expect(change).toBeDefined();
    expect(change!.before).toBeNull();
    expect(change!.after).toBe("v2");
    expect(change!.kind).toBe("modify");
    expect(useFileChanges.getState().count(CONV)).toBe(1);
  });

  it("merges modify chain keeping first non-null before", () => {
    const store = useFileChanges.getState();
    store.recordChange({
      conversationId: CONV,
      path: "/ws/b.txt",
      kind: "modify",
      before: "old",
      after: "mid",
    });
    store.recordChange({
      conversationId: CONV,
      path: "/ws/b.txt",
      kind: "modify",
      before: "mid",
      after: "new",
    });

    const change = useFileChanges.getState().getChange(CONV, "/ws/b.txt");
    expect(change!.before).toBe("old");
    expect(change!.after).toBe("new");
  });

  it("records delete with after null", () => {
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/c.txt",
      kind: "delete",
      before: "gone",
      after: null,
    });
    const change = useFileChanges.getState().getChange(CONV, "/ws/c.txt");
    expect(change!.kind).toBe("delete");
    expect(change!.after).toBeNull();
    expect(change!.before).toBe("gone");
  });

  it("rename uses final path and migrates fromPath entry", () => {
    const store = useFileChanges.getState();
    store.recordChange({
      conversationId: CONV,
      path: "/ws/old.txt",
      kind: "create",
      before: null,
      after: "body",
    });
    store.recordChange({
      conversationId: CONV,
      path: "/ws/new.txt",
      fromPath: "/ws/old.txt",
      kind: "rename",
      before: "body",
      after: "body",
    });

    expect(useFileChanges.getState().getChange(CONV, "/ws/old.txt")).toBeUndefined();
    const change = useFileChanges.getState().getChange(CONV, "/ws/new.txt");
    expect(change).toBeDefined();
    expect(change!.kind).toBe("rename");
    expect(change!.fromPath).toBe("/ws/old.txt");
    expect(change!.before).toBeNull(); // migrated create before
    expect(change!.after).toBe("body");
    expect(useFileChanges.getState().count(CONV)).toBe(1);
  });

  it("scopes changes by conversationId", () => {
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/x.txt",
      kind: "create",
      before: null,
      after: "a",
    });
    useFileChanges.getState().recordChange({
      conversationId: CONV2,
      path: "/ws/x.txt",
      kind: "create",
      before: null,
      after: "b",
    });
    expect(useFileChanges.getState().count(CONV)).toBe(1);
    expect(useFileChanges.getState().count(CONV2)).toBe(1);
    expect(useFileChanges.getState().getChange(CONV, "/ws/x.txt")!.after).toBe(
      "a",
    );
  });

  it("clearConversation removes only that conversation", () => {
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/a.txt",
      kind: "create",
      before: null,
      after: "1",
    });
    useFileChanges.getState().recordChange({
      conversationId: CONV2,
      path: "/ws/b.txt",
      kind: "create",
      before: null,
      after: "2",
    });
    useFileChanges.getState().clearConversation(CONV);
    expect(useFileChanges.getState().count(CONV)).toBe(0);
    expect(useFileChanges.getState().count(CONV2)).toBe(1);
  });

  it("setFocusPath updates focusPath", () => {
    useFileChanges.getState().setFocusPath("/ws/a.txt");
    expect(useFileChanges.getState().focusPath).toBe("/ws/a.txt");
    useFileChanges.getState().setFocusPath(null);
    expect(useFileChanges.getState().focusPath).toBeNull();
  });

  it("skips record when conversationId empty", () => {
    useFileChanges.getState().recordChange({
      conversationId: "",
      path: "/ws/z.txt",
      kind: "create",
      before: null,
      after: "x",
    });
    expect(useFileChanges.getState().count(CONV)).toBe(0);
    expect(useFileChanges.getState().getChanges("")).toHaveLength(0);
  });

  it("preserves truncated and binary flags across merge", () => {
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/big.bin",
      kind: "modify",
      before: "aaa",
      after: "bbb",
      truncated: true,
      binary: true,
    });
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/big.bin",
      kind: "modify",
      before: "bbb",
      after: "ccc",
    });
    const change = useFileChanges.getState().getChange(CONV, "/ws/big.bin");
    expect(change!.truncated).toBe(true);
    expect(change!.binary).toBe(true);
    expect(change!.before).toBe("aaa");
    expect(change!.after).toBe("ccc");
  });

  it("removeChange drops path and clears matching focusPath", () => {
    const store = useFileChanges.getState();
    store.recordChange({
      conversationId: CONV,
      path: "/ws/keep.txt",
      kind: "create",
      before: null,
      after: "k",
    });
    store.recordChange({
      conversationId: CONV,
      path: "/ws/drop.txt",
      kind: "modify",
      before: "a",
      after: "b",
    });
    store.setFocusPath("/ws/drop.txt");

    store.removeChange(CONV, "/ws/drop.txt");

    expect(useFileChanges.getState().getChange(CONV, "/ws/drop.txt")).toBeUndefined();
    expect(useFileChanges.getState().getChange(CONV, "/ws/keep.txt")).toBeDefined();
    expect(useFileChanges.getState().count(CONV)).toBe(1);
    expect(useFileChanges.getState().focusPath).toBeNull();
  });

  it("removeChange last item removes conversation bucket", () => {
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/only.txt",
      kind: "create",
      before: null,
      after: "1",
    });
    useFileChanges.getState().removeChange(CONV, "/ws/only.txt");
    expect(useFileChanges.getState().count(CONV)).toBe(0);
    expect(
      Object.keys(useFileChanges.getState().byConversation),
    ).not.toContain(CONV);
  });

  it("trims to MAX_CHANGES_PER_CONVERSATION by oldest updatedAt", () => {
    const store = useFileChanges.getState();
    const n = MAX_CHANGES_PER_CONVERSATION + 5;
    for (let i = 0; i < n; i++) {
      store.recordChange({
        conversationId: CONV,
        path: `/ws/f-${i}.txt`,
        kind: "create",
        before: null,
        after: String(i),
      });
    }
    expect(useFileChanges.getState().count(CONV)).toBe(
      MAX_CHANGES_PER_CONVERSATION,
    );
    // 最早的几条应被丢弃
    expect(
      useFileChanges.getState().getChange(CONV, "/ws/f-0.txt"),
    ).toBeUndefined();
    expect(
      useFileChanges.getState().getChange(CONV, `/ws/f-${n - 1}.txt`),
    ).toBeDefined();
  });

  it("clamps oversized content and sets truncated", () => {
    const huge = "x".repeat(MAX_CONTENT_CHARS + 100);
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/huge.txt",
      kind: "modify",
      before: huge,
      after: huge,
    });
    const change = useFileChanges.getState().getChange(CONV, "/ws/huge.txt");
    expect(change!.before!.length).toBe(MAX_CONTENT_CHARS);
    expect(change!.after!.length).toBe(MAX_CONTENT_CHARS);
    expect(change!.truncated).toBe(true);
  });
});

describe("normalize / trim helpers", () => {
  it("clampContent slices and flags truncated", () => {
    expect(clampContent(null)).toEqual({ text: null, truncated: false });
    expect(clampContent("ok")).toEqual({ text: "ok", truncated: false });
    const big = "a".repeat(MAX_CONTENT_CHARS + 1);
    const r = clampContent(big);
    expect(r.truncated).toBe(true);
    expect(r.text!.length).toBe(MAX_CONTENT_CHARS);
  });

  it("normalizeFileChange drops invalid items", () => {
    expect(normalizeFileChange(null)).toBeNull();
    expect(normalizeFileChange({ path: "/a", kind: "modify" })).toBeNull(); // no conv
    expect(
      normalizeFileChange({
        conversationId: CONV,
        path: "",
        kind: "modify",
        before: null,
        after: null,
      }),
    ).toBeNull();
    expect(
      normalizeFileChange({
        conversationId: CONV,
        path: "/a",
        kind: "nope",
        before: null,
        after: null,
      }),
    ).toBeNull();

    const ok = normalizeFileChange({
      conversationId: CONV,
      path: "/a",
      kind: "create",
      before: null,
      after: "x",
      updatedAt: 42,
    });
    expect(ok).toMatchObject({
      conversationId: CONV,
      path: "/a",
      kind: "create",
      after: "x",
      updatedAt: 42,
    });
  });

  it("normalizeByConversation enforces per-conv and conv count caps", () => {
    const list = Array.from({ length: MAX_CHANGES_PER_CONVERSATION + 3 }, (_, i) => ({
      id: `id-${i}`,
      conversationId: "c1",
      path: `/p-${i}`,
      kind: "create" as const,
      before: null,
      after: "x",
      updatedAt: i + 1,
    }));
    const byOne = normalizeByConversation({ c1: list });
    expect(byOne.c1).toHaveLength(MAX_CHANGES_PER_CONVERSATION);

    const many: Record<string, typeof list> = {};
    for (let i = 0; i < MAX_CHANGE_CONVERSATIONS + 5; i++) {
      many[`conv-${i}`] = [
        {
          id: `id-c-${i}`,
          conversationId: `conv-${i}`,
          path: "/f.txt",
          kind: "create",
          before: null,
          after: "x",
          updatedAt: i + 1,
        },
      ];
    }
    const trimmed = normalizeByConversation(many);
    expect(Object.keys(trimmed)).toHaveLength(MAX_CHANGE_CONVERSATIONS);
    // 最新会话保留
    expect(trimmed[`conv-${MAX_CHANGE_CONVERSATIONS + 4}`]).toBeDefined();
    expect(trimmed["conv-0"]).toBeUndefined();
  });

  it("trimChangesList keeps newest by updatedAt", () => {
    const list = [
      {
        id: "a",
        conversationId: CONV,
        path: "/a",
        kind: "create" as const,
        before: null,
        after: "1",
        updatedAt: 1,
      },
      {
        id: "b",
        conversationId: CONV,
        path: "/b",
        kind: "create" as const,
        before: null,
        after: "2",
        updatedAt: 3,
      },
      {
        id: "c",
        conversationId: CONV,
        path: "/c",
        kind: "create" as const,
        before: null,
        after: "3",
        updatedAt: 2,
      },
    ];
    const trimmed = trimChangesList(list, 2);
    expect(trimmed).toHaveLength(2);
    expect(trimmed.map((c) => c.path).sort()).toEqual(["/b", "/c"]);
  });

  it("trimConversations drops oldest conversation buckets", () => {
    const by = {
      old: [
        {
          id: "1",
          conversationId: "old",
          path: "/a",
          kind: "create" as const,
          before: null,
          after: "1",
          updatedAt: 10,
        },
      ],
      mid: [
        {
          id: "2",
          conversationId: "mid",
          path: "/a",
          kind: "create" as const,
          before: null,
          after: "1",
          updatedAt: 20,
        },
      ],
      new: [
        {
          id: "3",
          conversationId: "new",
          path: "/a",
          kind: "create" as const,
          before: null,
          after: "1",
          updatedAt: 30,
        },
      ],
    };
    const out = trimConversations(by, 2);
    expect(Object.keys(out).sort()).toEqual(["mid", "new"]);
  });

  it("persist partialize shape: only byConversation (no focusPath)", () => {
    // 通过 merge + 运行时状态验证 focus 不进持久化语义
    useFileChanges.getState().recordChange({
      conversationId: CONV,
      path: "/ws/p.txt",
      kind: "create",
      before: null,
      after: "1",
    });
    useFileChanges.getState().setFocusPath("/ws/p.txt");

    const state = useFileChanges.getState();
    // partialize 契约：仅 byConversation；focusPath 存在于内存
    expect(state.focusPath).toBe("/ws/p.txt");
    expect(state.byConversation[CONV]).toHaveLength(1);

    // rehydrate 路径：merge 后 focus 保持 current（不从 disk 恢复）
    const rehydrated = normalizeByConversation(state.byConversation);
    expect(rehydrated[CONV]).toHaveLength(1);
    expect(rehydrated[CONV]![0]!.path).toBe("/ws/p.txt");
  });
});
