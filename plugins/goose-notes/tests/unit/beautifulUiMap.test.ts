import { expect, test } from "playwright/test";
import {
  formatLoaderElapsed,
  mapStepsToThinkingTrace,
  mapToolPartsToChips,
  mapToolPartsToTaskRows,
  resolveLoaderHold,
} from "../../src/pages/workspace/components/notebook-ai/beautifulUiMap";

const runningPlanParts = [
  {
    type: "tool-loadSkill",
    state: "output-available",
    input: { skill: "updateNote" },
    output: { supported: true },
  },
  {
    type: "tool-readPage",
    state: "output-available",
    input: { pageId: "page-1" },
    output: { title: "开发验证与排查备忘" },
  },
  {
    type: "tool-executeBatchPlan",
    state: "input-available",
    input: {
      title: "继续优化排版",
      operations: [{ type: "edit", pageId: "page-1" }],
    },
  },
];

test("真实 tool parts 映射成 chip：完成项 done，流式中的计划 running", () => {
  const chips = mapToolPartsToChips(runningPlanParts, true);
  expect(chips).toHaveLength(3);
  expect(chips[0]).toMatchObject({
    name: "加载能力",
    status: "done",
  });
  expect(chips[0].label).toContain("已加载修改笔记能力");
  expect(chips[1].name).toBe("读取笔记");
  expect(chips[1].status).toBe("done");
  expect(chips[1].label).toContain("开发验证与排查备忘");
  expect(chips[2].name).toBe("生成批量计划");
  expect(chips[2].status).toBe("running");
  expect(chips[2].label).toContain("继续优化排版");
});

test("同一批 parts 在非流式时，未完成步骤是 pending 而不是 running", () => {
  const chips = mapToolPartsToChips(runningPlanParts, false);
  const rows = mapToolPartsToTaskRows(runningPlanParts, false);
  expect(chips[2].status).toBe("pending");
  expect(rows[2].status).toBe("pending");
  expect(rows[2].title).toBe("生成批量计划");
});

test("错误 part 映射为 chip error 与 task failed", () => {
  const parts = [
    {
      type: "tool-loadSkill",
      state: "output-available",
      input: { skill: "updateNote" },
      output: { supported: true },
    },
    {
      type: "tool-readPage",
      state: "output-error",
      errorText: "读取失败",
    },
  ];
  const chips = mapToolPartsToChips(parts, true);
  const rows = mapToolPartsToTaskRows(parts, true);
  expect(chips[1].status).toBe("error");
  expect(chips[1].name).toBe("读取笔记");
  expect(rows[1].status).toBe("failed");
  expect(rows[1].title).toBe("读取笔记");
});

test("搜索步骤展开为 Search thinking trace", () => {
  const trace = mapStepsToThinkingTrace(
    [
      { label: "搜索笔记", detail: "正在搜索“排版”" },
      { label: "读取笔记", detail: "已读取《开发验证》" },
    ],
    4200,
  );
  expect(trace.variant).toBe("Search");
  expect(trace.activeLabel).toBe("正在搜索");
  expect(trace.doneLabel).toBe("已搜索");
  expect(trace.rows[0]).toEqual({
    primary: "搜索笔记",
    secondary: "正在搜索“排版”",
  });
  expect(trace.rows[1].primary).toBe("读取笔记");
});

test("写入步骤展开为 Coding thinking trace", () => {
  const trace = mapStepsToThinkingTrace(
    [{ label: "写入页面", detail: "正在写入《笔记》" }],
    1200,
  );
  expect(trace.variant).toBe("Coding");
  expect(trace.activeLabel).toBe("正在运行工具");
  expect(trace.doneLabel).toBe("已运行 1 个工具");
});

test("formatLoaderElapsed 亚分钟用十分之一秒，满分钟带 m", () => {
  expect(formatLoaderElapsed(0)).toBe("0.0s");
  expect(formatLoaderElapsed(12_300)).toBe("12.3s");
  expect(formatLoaderElapsed(62_300)).toBe("1m 2.3s");
});

test("resolveLoaderHold：active 立即亮，held 可单独维持", () => {
  expect(resolveLoaderHold(true, false)).toBe(true);
  expect(resolveLoaderHold(false, true)).toBe(true);
  expect(resolveLoaderHold(true, true)).toBe(true);
  expect(resolveLoaderHold(false, false)).toBe(false);
});
