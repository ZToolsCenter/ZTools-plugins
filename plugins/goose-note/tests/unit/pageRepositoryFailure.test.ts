import { expect, test } from "playwright/test";
import { saveInternalPage } from "../../src/lib/storage/pageRepository";
import { getRecoveryEntry } from "../../src/lib/storage/recoveryJournal";
import { usePages } from "../../src/stores/usePages";

test.afterEach(() => delete (globalThis as any).window);

test("普通笔记 DB 连续写入失败时向上返回 false", () => {
  (globalThis as any).window = {
    utools: {
      db: {
        get: () => null,
        put: () => ({ ok: false, error: "fault-injected" }),
        remove: () => ({ ok: true }),
        allDocs: () => [],
      },
    },
  };
  const now = Date.now();
  expect(
    saveInternalPage({
      id: "page-failed",
      workspaceId: "default",
      content: [{ type: "paragraph", content: "latest" }] as any,
      isFolder: false,
      createdAt: now,
      updatedAt: now,
    }),
  ).toBe(false);
});

test("普通笔记保存失败时内存保留最新内容且恢复日志不被误清", () => {
  let rev = 0;
  const docs = new Map<string, { _id: string; _rev: string; data: unknown }>();
  (globalThis as any).window = {
    utools: {
      db: {
        get: (id: string) => docs.get(id) ?? null,
        put: (doc: { _id: string; data: unknown }) => {
          if (doc._id.startsWith("gn:page:")) {
            return { ok: false, error: "page-write-failed" };
          }
          const stored = { ...doc, _rev: `rev-${++rev}` };
          docs.set(doc._id, stored);
          return { ok: true, id: doc._id, rev: stored._rev };
        },
        remove: (id: string) => {
          docs.delete(id);
          return { ok: true, id };
        },
        allDocs: () => [],
      },
    },
  };
  const before = [{ type: "paragraph", content: "before" }] as any;
  const latest = [{ type: "paragraph", content: "latest" }] as any;
  const now = Date.now();
  usePages.setState({
    pages: {
      "page-store-failed": {
        id: "page-store-failed",
        workspaceId: "default",
        content: before,
        isFolder: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  });

  usePages.getState().updatePage("page-store-failed", { content: latest });

  expect(usePages.getState().pages["page-store-failed"].content).toEqual(latest);
  expect(getRecoveryEntry("internal-page", "page-store-failed")?.content).toEqual(
    latest,
  );
});
