import { expect, test } from "playwright/test";
import {
  acknowledgeRecoveryEntry,
  canApplyRecoveryEntry,
  getRecoveryEntry,
  listRecoveryEntries,
  moveRecoveryEntry,
  RECOVERY_JOURNAL_STORAGE_KEY,
  recordRecoveryEntry,
} from "../../src/lib/storage/recoveryJournal";
import { getContentSignature } from "../../src/components/editor/utils/blocknote-content";
import { recoverQuickNoteDrafts } from "../../src/stores/useQuickNote";
import { setDbStorageItem } from "../../src/lib/storage/utoolsDbStorage";

function installStorageRuntime(options?: { failStorageWrites?: boolean }) {
  let rev = 0;
  const docs = new Map<string, { _id: string; _rev: string; data: unknown }>();
  (globalThis as any).window = {
    utools: {
      db: {
        get: (id: string) => docs.get(id) ?? null,
        put: (doc: { _id: string; _rev?: string; data: unknown }) => {
          if (
            options?.failStorageWrites &&
            (doc._id.startsWith("gn:storage:") ||
              doc._id.startsWith("gn:recovery:"))
          ) {
            return { id: doc._id, ok: false, error: "fault-injected" };
          }
          const current = docs.get(doc._id);
          if (doc._rev !== current?._rev && current) {
            return { id: doc._id, ok: false, error: "conflict" };
          }
          const nextRev = `rev-${++rev}`;
          docs.set(doc._id, { ...doc, _rev: nextRev });
          return { id: doc._id, ok: true, rev: nextRev };
        },
        remove: (id: string) => {
          docs.delete(id);
          return { id, ok: true };
        },
        allDocs: (prefix = "") =>
          Array.from(docs.values()).filter((doc) => doc._id.startsWith(prefix)),
      },
    },
  };

  return { docs };
}

test.afterEach(() => delete (globalThis as any).window);

test("旧版 ACK 不会清掉更新的恢复稿", () => {
  installStorageRuntime();
  const first = recordRecoveryEntry({
    source: "internal-page",
    id: "p1",
    content: [{ type: "paragraph", content: "first" }] as any,
  });
  const second = recordRecoveryEntry({
    source: "internal-page",
    id: "p1",
    content: [{ type: "paragraph", content: "second" }] as any,
  });

  expect(first?.revision).toBe(1);
  expect(second?.revision).toBe(2);
  expect(acknowledgeRecoveryEntry("internal-page", "p1", 1)).toBe(false);
  expect(getRecoveryEntry("internal-page", "p1")?.revision).toBe(2);
  expect(acknowledgeRecoveryEntry("internal-page", "p1", 2)).toBe(true);
  expect(getRecoveryEntry("internal-page", "p1")).toBeNull();
});

test("连续未 ACK 编辑固定使用首次持久化基线", () => {
  installStorageRuntime();
  const persisted = [{ type: "paragraph", content: "persisted" }] as any;
  const firstEdit = [{ type: "paragraph", content: "first" }] as any;
  const latestEdit = [{ type: "paragraph", content: "latest" }] as any;
  recordRecoveryEntry({
    source: "internal-page",
    id: "baseline-page",
    content: firstEdit,
    baseSignature: getContentSignature(persisted),
    baseUpdatedAt: 10,
  });
  const latest = recordRecoveryEntry({
    source: "internal-page",
    id: "baseline-page",
    content: latestEdit,
    baseSignature: getContentSignature(firstEdit),
    baseUpdatedAt: 20,
  });

  expect(latest?.revision).toBe(2);
  expect(latest?.baseSignature).toBe(getContentSignature(persisted));
  expect(latest?.baseUpdatedAt).toBe(10);
  expect(canApplyRecoveryEntry(latest!, persisted, 10)).toBe(true);
  expect(canApplyRecoveryEntry(latest!, firstEdit, 20)).toBe(false);
});

test("不同 source+id 使用独立文档，不会整包覆盖", () => {
  const { docs } = installStorageRuntime();
  recordRecoveryEntry({ source: "internal-page", id: "a", content: null });
  recordRecoveryEntry({ source: "quicknote", id: "1", content: null });

  expect(getRecoveryEntry("internal-page", "a")).not.toBeNull();
  expect(getRecoveryEntry("quicknote", "1")).not.toBeNull();
  expect(
    Array.from(docs.keys()).filter((id) => id.startsWith("gn:recovery:v2:")),
  ).toHaveLength(2);
});

test("迁移到已有墓碑时返回目标的新 revision", () => {
  installStorageRuntime();
  const target = recordRecoveryEntry({
    source: "local-file",
    id: "target",
    content: null,
  })!;
  expect(acknowledgeRecoveryEntry("local-file", "target", target.revision)).toBe(
    true,
  );
  const source = recordRecoveryEntry({
    source: "local-file",
    id: "source",
    content: [{ type: "paragraph", content: "pending" }] as any,
  })!;

  const moved = moveRecoveryEntry("local-file", "source", "target");
  expect(moved.ok).toBe(true);
  if (!moved.ok) return;
  expect(moved.entry?.revision).toBeGreaterThan(target.revision);
  expect(moved.entry?.content).toEqual(source.content);
  expect(getRecoveryEntry("local-file", "source")).toBeNull();
});

test("迁移到已有恢复稿时以新 revision 返回源内容", () => {
  installStorageRuntime();
  recordRecoveryEntry({ source: "local-file", id: "source", content: null });
  recordRecoveryEntry({ source: "local-file", id: "target", content: null });
  const targetLatest = recordRecoveryEntry({
    source: "local-file",
    id: "target",
    content: [{ type: "paragraph", content: "target-old" }] as any,
  })!;

  const moved = moveRecoveryEntry("local-file", "source", "target");
  expect(moved.ok).toBe(true);
  if (!moved.ok) return;
  expect(moved.entry?.revision).toBe(targetLatest.revision + 1);
  expect(moved.entry?.content).toBeNull();
});

test("旧 ACK 与新 record 冲突时不能清掉新稿", () => {
  const { docs } = installStorageRuntime();
  const first = recordRecoveryEntry({
    source: "internal-page",
    id: "racy",
    content: [{ type: "paragraph", content: "first" }] as any,
  })!;
  const id = "gn:recovery:v2:internal-page:racy";
  const db = (globalThis as any).window.utools.db;
  const originalPut = db.put;
  let injected = false;
  db.put = (doc: any) => {
    if (!injected && doc.data?.acknowledgedRevision === 1) {
      injected = true;
      docs.set(id, {
        _id: id,
        _rev: "concurrent-rev",
        data: {
          version: 2,
          entry: {
            ...first,
            revision: 2,
            content: [{ type: "paragraph", content: "new" }],
          },
        },
      });
    }
    return originalPut(doc);
  };

  expect(acknowledgeRecoveryEntry("internal-page", "racy", 1)).toBe(false);
  expect(getRecoveryEntry("internal-page", "racy")?.revision).toBe(2);
});

test("旧整包恢复日志会迁移为独立文档", () => {
  installStorageRuntime();
  const legacy = {
    source: "local-file" as const,
    id: "legacy-local",
    content: [{ type: "paragraph", content: "legacy draft" }] as any,
    revision: 3,
    updatedAt: 30,
    baseSignature: "disk-baseline",
  };
  expect(
    setDbStorageItem(
      RECOVERY_JOURNAL_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: { "local-file:legacy-local": legacy },
      }),
    ),
  ).toBe(true);

  expect(listRecoveryEntries("local-file")).toEqual([legacy]);
  expect(getRecoveryEntry("local-file", "legacy-local")).toEqual(legacy);
});

test("恢复稿不会覆盖已经变化的外部文件版本", () => {
  installStorageRuntime();
  const original = [{ type: "paragraph", content: "disk-old" }] as any;
  const entry = recordRecoveryEntry({
    source: "local-file",
    id: "local-1",
    content: [{ type: "paragraph", content: "unsaved" }] as any,
    baseSignature: getContentSignature(original),
  });
  expect(entry).not.toBeNull();
  expect(canApplyRecoveryEntry(entry!, original)).toBe(true);
  expect(
    canApplyRecoveryEntry(
      entry!,
      [{ type: "paragraph", content: "disk-new" }] as any,
    ),
  ).toBe(false);
  expect(getRecoveryEntry("local-file", "local-1")?.content).toEqual(
    entry!.content,
  );
});

test("速记从独立恢复日志找回当前草稿，且不淘汰草稿正文", () => {
  installStorageRuntime();
  const previous = [{ type: "paragraph", content: "before" }] as any;
  const latest = [{ type: "paragraph", content: "latest" }] as any;
  recordRecoveryEntry({
    source: "quicknote",
    id: "3",
    content: latest,
    baseSignature: getContentSignature(previous),
  });

  const recovered = recoverQuickNoteDrafts({ 3: previous });
  expect(recovered.recoveredSlots).toEqual([3]);
  expect(recovered.conflictSlots).toEqual([]);
  expect(recovered.drafts[3]).toEqual(latest);
});

test("恢复日志写入故障会向调用方返回失败", () => {
  installStorageRuntime({ failStorageWrites: true });
  expect(
    recordRecoveryEntry({
      source: "internal-page",
      id: "p1",
      content: null,
    }),
  ).toBeNull();
});
