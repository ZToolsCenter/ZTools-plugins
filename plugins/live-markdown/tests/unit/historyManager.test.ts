import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllStorageForTesting,
  clearSnapshots,
  deleteSnapshot,
  getDocStorageKey,
  loadSnapshots,
  recordSnapshot,
  restoreSnapshotById,
  undoToPreviousSnapshot
} from "../../src/core/historyManager";

describe("historyManager Unit Tests", () => {
  beforeEach(() => {
    clearAllStorageForTesting();
  });

  it("should generate proper storage keys for files and untitled docs", () => {
    expect(getDocStorageKey("/path/to/test.md", "test.md")).toBe("/path/to/test.md");
    expect(getDocStorageKey(null, "Untitled-1")).toBe("untitled_Untitled-1");
    expect(getDocStorageKey("", "")).toBe("untitled_document");
  });

  it("should record snapshots and calculate diffSummary automatically", () => {
    const key = "/doc/demo.md";
    const res1 = recordSnapshot(key, "demo.md", key, "# Hello", "初始版本");
    expect(res1.isNew).toBe(true);
    expect(res1.list.length).toBe(1);
    expect(res1.snapshot.summary).toBe("初始版本");
    expect(res1.snapshot.charCount).toBe(7);

    // Duplicate content should not create another snapshot
    const resDuplicate = recordSnapshot(key, "demo.md", key, "# Hello", "重复编辑");
    expect(resDuplicate.isNew).toBe(false);
    expect(resDuplicate.list.length).toBe(1);

    // Modified content creates snapshot with diffSummary
    const res2 = recordSnapshot(key, "demo.md", key, "# Hello\n\nSecond line", "新增一行");
    expect(res2.isNew).toBe(true);
    expect(res2.list.length).toBe(2);
    expect(res2.snapshot.diffSummary?.addedLines).toBeGreaterThanOrEqual(1);
  });

  it("should support undoToPreviousSnapshot", () => {
    const key = "/doc/demo.md";
    recordSnapshot(key, "demo.md", key, "Version 1", "v1");
    recordSnapshot(key, "demo.md", key, "Version 2", "v2");

    const undoRes = undoToPreviousSnapshot(key, "demo.md", key, "Version 2");
    expect(undoRes).toBeDefined();
    expect(undoRes?.restoredContent).toBe("Version 1");
    expect(undoRes?.restoredSnapshot.content).toBe("Version 1");

    // Check that an audit snapshot was appended
    const list = loadSnapshots(key);
    expect(list.length).toBe(3);
    expect(list[list.length - 1].summary).toContain("回滚恢复至快照");
  });

  it("should support restoreSnapshotById and append a new audit snapshot", () => {
    const key = "/doc/demo.md";
    const { snapshot: snap1 } = recordSnapshot(key, "demo.md", key, "State A", "step A");
    const { snapshot: snap2 } = recordSnapshot(key, "demo.md", key, "State B", "step B");
    recordSnapshot(key, "demo.md", key, "State C", "step C");

    // 1. Roll back to arbitrary earlier snapshot snap1 (State A)
    const restoredA = restoreSnapshotById(key, "demo.md", key, snap1.id);
    expect(restoredA).toBeDefined();
    expect(restoredA?.restoredContent).toBe("State A");

    // Verify snapshot list grew and latest record is the rollback audit
    const listAfterA = loadSnapshots(key);
    expect(listAfterA.length).toBe(4);
    expect(listAfterA[listAfterA.length - 1].content).toBe("State A");
    expect(listAfterA[listAfterA.length - 1].summary).toContain("恢复历史版本");

    // 2. Roll back to arbitrary intermediate snapshot snap2 (State B)
    const restoredB = restoreSnapshotById(key, "demo.md", key, snap2.id);
    expect(restoredB).toBeDefined();
    expect(restoredB?.restoredContent).toBe("State B");

    const listAfterB = loadSnapshots(key);
    expect(listAfterB.length).toBe(5);
    expect(listAfterB[listAfterB.length - 1].content).toBe("State B");
  });

  it("should support deleting snapshot and clearing history", () => {
    const key = "/doc/demo.md";
    const { snapshot: snap1 } = recordSnapshot(key, "demo.md", key, "A", "A");
    const { snapshot: snap2 } = recordSnapshot(key, "demo.md", key, "B", "B");

    expect(loadSnapshots(key).length).toBe(2);

    const afterDel = deleteSnapshot(key, snap1.id);
    expect(afterDel.length).toBe(1);
    expect(afterDel[0].id).toBe(snap2.id);

    clearSnapshots(key);
    expect(loadSnapshots(key).length).toBe(0);
  });

  it("should respect max snapshot limit and evict oldest", () => {
    const key = "/doc/limit.md";
    for (let i = 1; i <= 15; i += 1) {
      recordSnapshot(key, "limit.md", key, `Content ${i}`, `step ${i}`, 10);
    }

    const list = loadSnapshots(key);
    expect(list.length).toBe(10);
    expect(list[0].content).toBe("Content 6");
    expect(list[list.length - 1].content).toBe("Content 15");
  });
});
