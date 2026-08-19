import { expect, test } from "playwright/test";
import { getToolProgressSummary } from "../../src/pages/workspace/components/notebook-ai/ToolProgressCard";

test("处理进度按发生顺序实时保留已完成步骤和当前步骤", () => {
  const parts = [
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

  expect(getToolProgressSummary(parts.slice(0, 1), true)).toBe(
    "已加载修改笔记能力",
  );
  expect(getToolProgressSummary(parts.slice(0, 2), true)).toBe(
    "已加载修改笔记能力、已读取《开发验证与排查备忘》",
  );
  expect(getToolProgressSummary(parts, true)).toBe(
    "已加载修改笔记能力、已读取《开发验证与排查备忘》、正在生成《继续优化排版》",
  );

  expect(
    getToolProgressSummary(
      [
        {
          type: "tool-listPages",
          state: "output-available",
          output: [],
        },
        ...parts,
      ],
      true,
    ),
  ).not.toContain("已查看 0 个页面");
});

test("错误步骤优先占用摘要，不继续显示处理中", () => {
  const summary = getToolProgressSummary(
    [
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
    ],
    true,
  );

  expect(summary).not.toContain("正在读取");
  expect(summary).not.toContain("已加载修改笔记能力");
});
