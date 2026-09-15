import { expect, test } from "playwright/test";
import {
  createDefaultQuickNoteSlotNames,
  parsePersistedQuickNoteSlotNames,
  serializeQuickNoteSlotNames,
  updateQuickNoteSlotName,
} from "../../src/stores/useQuickNote";

test.describe("速记便签名称独立持久化", () => {
  test("只序列化名称，不携带正文或撤销历史", () => {
    const names = updateQuickNoteSlotName(
      createDefaultQuickNoteSlotNames(),
      1,
      "  任务项  ",
    );
    const serialized = serializeQuickNoteSlotNames(names);

    expect(serialized).toContain('"1":"任务项"');
    expect(serialized).not.toContain("drafts");
    expect(serialized).not.toContain("undoStacks");
    expect(serialized.length).toBeLessThan(200);
    expect(parsePersistedQuickNoteSlotNames(serialized, names)).toEqual(names);
  });

  test("名称没有变化时复用原对象，避免无意义写入", () => {
    const names = updateQuickNoteSlotName(
      createDefaultQuickNoteSlotNames(),
      2,
      "工作",
    );

    expect(updateQuickNoteSlotName(names, 2, "  工作  ")).toBe(names);
  });

  test("新存储损坏时回退到旧主文档名称", () => {
    const fallback = updateQuickNoteSlotName(
      createDefaultQuickNoteSlotNames(),
      3,
      "灵感",
    );

    expect(parsePersistedQuickNoteSlotNames("{", fallback)).toEqual(fallback);
  });
});
