import { expect, test } from "playwright/test";
import type { JSONContent, Page } from "../../src/types";
import {
  executePreparedBatchPlan,
  prepareBatchPlan,
  undoBatchPlan,
} from "../../src/lib/notebook-ai/batch-plan/executor";
import { normalizeBatchPlanInput } from "../../src/lib/notebook-ai/batch-plan/input";
import { updateBatchPlanSelection } from "../../src/lib/notebook-ai/batch-plan/journal";
import { writeBatchPlanJournal } from "../../src/lib/notebook-ai/batch-plan/journal";
import {
  executeBatchPlan,
  executeBatchPlanInputSchema,
  prepareBatchPlanForApproval,
  repairExecuteBatchPlanInput,
} from "../../src/lib/notebook-ai/batch-plan/tool";
import type { BatchPlanInput } from "../../src/lib/notebook-ai/batch-plan/types";
import { mergeFullEditPreservingUnchangedBlocks } from "../../src/lib/notebook-ai/batch-plan/surgicalApply";
import { buildAiPageContent } from "../../src/lib/notebook-ai/markdown";
import {
  prepareNotebookAiMessagesForModel,
  sanitizeNotebookAiMessages,
} from "../../src/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage } from "../../src/lib/notebook-ai/types";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";

let sequence = 0;
let writeCalls = 0;
let originalWritePageContent = usePages.getState().writePageContent;

function content(text: string): JSONContent {
  return [{ type: "paragraph", content: text }];
}

function makePage(
  id: string,
  text: string,
  overrides: Partial<Page> = {},
): Page {
  return {
    id,
    workspaceId: "batch-notebook",
    content: content(text),
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function ids(label: string) {
  sequence += 1;
  return {
    toolCallId: `batch-tool-${label}-${sequence}`,
    runId: `batch-run-${label}-${sequence}`,
  };
}

function plan(operations: BatchPlanInput["operations"]): BatchPlanInput {
  return {
    title: "批量更新",
    summary: "测试批量计划的冻结、执行与撤回",
    operations,
  };
}

function textOf(pageId: string) {
  return JSON.stringify(usePages.getState().pages[pageId]?.content);
}

function installStorage() {
  const values = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    // 页面 store 的持久化/编辑器同步会广播事件；单测只需存储行为。
    dispatchEvent: () => true,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

function installWriteMock() {
  usePages.setState({
    writePageContent: async (pageId, nextContent) => {
      writeCalls += 1;
      usePages.setState((state) => {
        const page = state.pages[pageId];
        if (!page) return state;
        return {
          pages: {
            ...state.pages,
            [pageId]: {
              ...page,
              content: nextContent,
              // 固定递增，避免同一毫秒的 updatedAt 造成测试偶现。
              updatedAt: page.updatedAt + 1,
            },
          },
        };
      });
      return true;
    },
  });
}

function installState(
  pages: Record<string, Page>,
  source: "default" | "local-folder" = "default",
) {
  useNotebooks.setState({
    notebooks: {
      "batch-notebook": {
        id: "batch-notebook",
        name: "批量测试",
        createdAt: 1,
        updatedAt: 1,
        source,
        ...(source === "local-folder" ? { localPath: "/tmp/goose-batch" } : {}),
      },
    },
    activeNotebookId: "batch-notebook",
  });
  usePages.setState({ pages, activePageId: null });
  installWriteMock();
}

test.beforeEach(() => {
  originalWritePageContent = usePages.getState().writePageContent;
  writeCalls = 0;
  installStorage();
});

test("批量计划会补齐操作 ID，并兼容单个删除 pageId", () => {
  const normalized = normalizeBatchPlanInput({
    runId: "normalize-run",
    title: "汇总文档",
    summary: "新建汇总页并删除旧页面",
    operations: [
      {
        type: "create",
        title: "汇总页",
        markdown: "汇总正文",
      },
      {
        type: "delete",
        pageId: "page-to-delete",
      },
    ],
  });

  expect(normalized?.operations).toEqual([
    {
      type: "create",
      operationId: "create-1",
      title: "汇总页",
      markdown: "汇总正文",
    },
    {
      type: "delete",
      operationId: "delete-2",
      pageIds: ["page-to-delete"],
    },
  ]);
});

test("批量计划兼容 create_page/delete_page 别名", () => {
  const normalized = normalizeBatchPlanInput(
    {
      operations: [
        { type: "create_page", title: "汇总页", markdown: "汇总正文" },
        { type: "delete_page", pageId: "old-page" },
      ],
    },
    {
      fallbackRunId: "alias-run",
      fallbackTitle: "别名计划",
    },
  );

  expect(normalized?.runId).toBe("alias-run");
  expect(normalized?.summary).toBe("别名计划");
  expect(normalized?.operations).toEqual([
    {
      type: "create",
      operationId: "create-1",
      title: "汇总页",
      markdown: "汇总正文",
    },
    {
      type: "delete",
      operationId: "delete-2",
      pageIds: ["old-page"],
    },
  ]);
});

test("批量计划兼容 plan.changes 与 action 形式", () => {
  const normalized = normalizeBatchPlanInput(
    {
      plan: {
        summary: "兼容包装后的变更计划",
        changes: [
          { action: "create", title: "汇总页", markdown: "汇总正文" },
          { action: "delete", pageId: "old-page" },
        ],
      },
    },
    {
      fallbackRunId: "batch-tool-call",
      fallbackTitle: "批量变更计划",
    },
  );

  expect(normalized).toMatchObject({
    runId: "batch-tool-call",
    title: "批量变更计划",
    summary: "兼容包装后的变更计划",
    operations: [
      { type: "create", operationId: "create-1" },
      { type: "delete", operationId: "delete-2", pageIds: ["old-page"] },
    ],
  });
});

test("批量工具公开 schema 只接受 canonical 操作", () => {
  expect(
    executeBatchPlanInputSchema.safeParse({
      title: "更新账号",
      summary: "补充正文",
      operations: [
        { type: "edit", pageId: "account-page", markdown: "新的正文" },
      ],
    }).success,
  ).toBe(true);

  expect(
    executeBatchPlanInputSchema.safeParse({
      title: "截图",
      summary: "这不是笔记操作",
      operations: [{ type: "create", title: "截图", markdown: { url: "x" } }],
    }).success,
  ).toBe(false);
});

test("批量工具只确定性修复 changes/action 旧格式", () => {
  const repaired = repairExecuteBatchPlanInput(
    JSON.stringify({
      plan: {
        title: "整理笔记",
        summary: "合并旧页",
        changes: [
          { action: "edit_page", pageId: "old-page", markdown: "合并后的正文" },
          { action: "delete", pageId: "obsolete-page" },
        ],
      },
    }),
  );

  expect(repaired).not.toBeNull();
  expect(JSON.parse(repaired ?? "{}")).toEqual({
    title: "整理笔记",
    summary: "合并旧页",
    operations: [
      { type: "edit", pageId: "old-page", markdown: "合并后的正文" },
      { type: "delete", pageIds: ["obsolete-page"] },
    ],
  });
});

test("批量工具拒绝 XML、空计划和未知操作修复", () => {
  expect(repairExecuteBatchPlanInput("<plan><changes /></plan>")).toBeNull();
  expect(
    repairExecuteBatchPlanInput(
      JSON.stringify({ title: "空", summary: "空", changes: [] }),
    ),
  ).toBeNull();
  expect(
    repairExecuteBatchPlanInput(
      JSON.stringify({
        title: "未知",
        summary: "未知",
        changes: [{ action: "screenshot", url: "https://example.com/a.png" }],
      }),
    ),
  ).toBeNull();
});

test("待审批计划会保留在持久化消息中，重开会话后仍可继续", () => {
  const messages = [
    {
      id: "approval-message",
      role: "assistant",
      parts: [
        {
          type: "tool-executeBatchPlan",
          toolCallId: "approval-tool",
          state: "approval-requested",
          input: {
            runId: "approval-run",
            title: "待审批计划",
            summary: "跨页修改",
            operations: [],
          },
          approval: { id: "approval-id" },
        },
      ],
    },
  ] as unknown as NotebookAiMessage[];

  const sanitized = sanitizeNotebookAiMessages(messages);
  expect(sanitized).toHaveLength(1);
  expect(sanitized[0].parts).toHaveLength(1);
  expect((sanitized[0].parts[0] as { state?: string }).state).toBe(
    "approval-requested",
  );
});

test("批量计划保留在本地会话，但不会再次发送给兼容模型", () => {
  const messages = [
    {
      id: "completed-batch-message",
      role: "assistant",
      parts: [
        { type: "text", text: "批量计划已执行。" },
        {
          type: "tool-executeBatchPlan",
          toolCallId: "completed-batch-tool",
          state: "output-available",
          input: { runId: "completed-batch-run", operations: [] },
          output: { ok: true, status: "undone", canUndo: false },
        },
      ],
    },
  ] as unknown as NotebookAiMessage[];

  expect(sanitizeNotebookAiMessages(messages)[0].parts).toHaveLength(2);

  const prepared = prepareNotebookAiMessagesForModel(messages);
  expect(prepared).toHaveLength(1);
  expect(prepared[0].parts).toEqual([
    { type: "text", text: "批量计划已执行。" },
  ]);
});

test("后续对话不向模型回放任何历史工具调用，但保留助手正文", () => {
  const messages = [
    {
      id: "user-before-tools",
      role: "user",
      parts: [{ type: "text", text: "整理当前笔记" }],
    },
    {
      id: "assistant-with-tools",
      role: "assistant",
      parts: [
        {
          type: "tool-loadSkill",
          toolCallId: "load-skill-call",
          state: "output-available",
          input: { skill: "updateNote" },
          output: { supported: true },
        },
        {
          type: "tool-readPage",
          toolCallId: "read-page-call",
          state: "output-available",
          input: { pageId: "page-1" },
          output: { markdown: "正文" },
        },
        { type: "text", text: "已经完成第一轮整理。" },
        {
          type: "tool-executeBatchPlan",
          toolCallId: "batch-call",
          state: "output-available",
          input: { operations: [] },
          output: { ok: true, status: "completed" },
        },
      ],
    },
    {
      id: "assistant-only-tools",
      role: "assistant",
      parts: [
        {
          type: "tool-loadSkill",
          toolCallId: "orphan-tool-call",
          state: "output-available",
          input: { skill: "chat" },
          output: { supported: true },
        },
      ],
    },
    {
      id: "user-follow-up",
      role: "user",
      parts: [{ type: "text", text: "格式更好看！" }],
    },
  ] as unknown as NotebookAiMessage[];

  const prepared = prepareNotebookAiMessagesForModel(messages);

  expect(prepared.map((message) => message.id)).toEqual([
    "user-before-tools",
    "assistant-with-tools",
    "user-follow-up",
  ]);
  expect(prepared[1].parts).toEqual([
    { type: "text", text: "已经完成第一轮整理。" },
  ]);
});

test.afterEach(() => {
  usePages.setState({
    pages: {},
    activePageId: null,
    writePageContent: originalWritePageContent,
  });
  useNotebooks.setState({ notebooks: {}, activeNotebookId: null });
  delete (globalThis as { window?: unknown }).window;
});

test("冻结计划在审批/执行前零写入，并保存每个目标页的 revision", async () => {
  const pageA = makePage("batch-freeze-a", "旧内容 A", { updatedAt: 11 });
  const pageB = makePage("batch-freeze-b", "旧内容 B", { updatedAt: 22 });
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("freeze");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "新内容 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "新内容 B",
      },
    ]),
  });

  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(writeCalls).toBe(0);
  expect(prepared.journal.status).toBe("prepared");
  expect(prepared.journal.before[pageA.id].revision).toEqual({
    updatedAt: 11,
    contentSignature: JSON.stringify(pageA.content),
  });
  expect(prepared.journal.before[pageB.id].revision).toEqual({
    updatedAt: 22,
    contentSignature: JSON.stringify(pageB.content),
  });
  expect(textOf(pageA.id)).toContain("旧内容 A");
  expect(textOf(pageB.id)).toContain("旧内容 B");
});

test("批量工具准备审批后正常返回，不依赖 SDK approval 等待", async () => {
  const pageA = makePage("batch-tool-a", "旧内容 A", { updatedAt: 11 });
  const pageB = makePage("batch-tool-b", "旧内容 B", { updatedAt: 22 });
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("tool-approval");

  expect("needsApproval" in executeBatchPlan).toBe(false);

  const result = await prepareBatchPlanForApproval(
    {
      runId,
      title: "汇总并删除旧页面",
      summary: "先等待用户审批",
      operations: [
        {
          type: "edit",
          pageId: pageA.id,
          markdown: "合并后的新内容",
        },
        {
          type: "delete",
          pageIds: [pageB.id],
        },
      ],
    },
    { toolCallId, notebookId: "batch-notebook" },
  );

  expect(result).toMatchObject({
    ok: true,
    needsApproval: true,
    toolCallId,
    runId,
    status: "prepared",
    operationCount: 2,
  });
  expect(writeCalls).toBe(0);
  expect(textOf(pageA.id)).toContain("旧内容 A");
  expect(usePages.getState().pages[pageB.id].trashedAt).toBeUndefined();
});

test("单页编辑也只准备审批，不会直接写入", async () => {
  const page = makePage("single-approval-page", "原始内容", { updatedAt: 7 });
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("single-approval");

  const result = await prepareBatchPlanForApproval(
    {
      runId,
      title: "整理公司账号",
      summary: "调整当前页面格式",
      operations: [
        {
          type: "edit",
          pageId: page.id,
          markdown: "整理后的内容",
        },
      ],
    },
    { toolCallId, notebookId: "batch-notebook" },
  );

  expect(result).toMatchObject({
    ok: true,
    needsApproval: true,
    status: "prepared",
    operationCount: 1,
  });
  expect(writeCalls).toBe(0);
  expect(textOf(page.id)).toContain("原始内容");
  expect(textOf(page.id)).not.toContain("整理后的内容");
});

test("冻结后任一版本变化会在 preflight 整批拒绝，零页面写入", async () => {
  const pageA = makePage("batch-conflict-a", "旧内容 A");
  const pageB = makePage("batch-conflict-b", "旧内容 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("preflight-conflict");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "新内容 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "新内容 B",
      },
    ]),
  });

  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [pageB.id]: {
        ...state.pages[pageB.id],
        content: content("用户并发编辑"),
        updatedAt: 2,
      },
    },
  }));
  const result = await executePreparedBatchPlan(toolCallId, runId);

  expect(result.ok).toBe(false);
  expect(result.journal.status).toBe("failed");
  expect(writeCalls).toBe(0);
  expect(textOf(pageA.id)).toContain("旧内容 A");
  expect(textOf(pageB.id)).toContain("用户并发编辑");
});

test("可在审批前选择子集，未选择操作不执行", async () => {
  const pageA = makePage("batch-select-a", "旧内容 A");
  const pageB = makePage("batch-select-b", "旧内容 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("selection");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "仅更新 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "不应更新 B",
      },
    ]),
  });

  const selected = updateBatchPlanSelection(toolCallId, runId, [
    "edit-a",
    "不存在",
    "edit-a",
  ]);
  expect(selected?.selectedOperationIds).toEqual(["edit-a"]);
  const result = await executePreparedBatchPlan(toolCallId, runId);

  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.results).toEqual([
    { operationId: "edit-a", type: "edit", ok: true, pageIds: [pageA.id] },
  ]);
  expect(textOf(pageA.id)).toContain("仅更新 A");
  expect(textOf(pageB.id)).toContain("旧内容 B");
  expect(writeCalls).toBe(1);
});

test("search_replace 审批后局部替换，保留未改动块 id", async () => {
  const pageContent = [
    { id: "keep-a", type: "paragraph", content: "alpha" },
    { id: "change-me", type: "paragraph", content: "beta" },
    { id: "keep-c", type: "paragraph", content: "gamma" },
  ];
  const page = makePage("batch-sr-page", "unused", {
    content: pageContent as JSONContent,
    updatedAt: 5,
  });
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("search-replace");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "search_replace",
        operationId: "sr-1",
        pageId: page.id,
        oldString: "beta",
        newString: "BETA",
      },
    ]),
  });

  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(writeCalls).toBe(0);
  expect(prepared.journal.status).toBe("prepared");
  expect(textOf(page.id)).toContain("beta");

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.results).toEqual([
    {
      operationId: "sr-1",
      type: "search_replace",
      ok: true,
      pageIds: [page.id],
    },
  ]);
  expect(writeCalls).toBe(1);

  const blocks = usePages.getState().pages[page.id].content as Array<{
    id?: string;
    content?: unknown;
  }>;
  expect(blocks[0]?.id).toBe("keep-a");
  expect(blocks[2]?.id).toBe("keep-c");
  expect(JSON.stringify(blocks)).toContain("BETA");
  expect(JSON.stringify(blocks)).not.toMatch(/"beta"/);
});

test("同页多条 search_replace 按顺序应用并保留未改块 id", async () => {
  const pageContent = [
    { id: "p1", type: "paragraph", content: "alpha" },
    { id: "p2", type: "paragraph", content: "beta" },
    { id: "p3", type: "paragraph", content: "gamma" },
  ];
  const page = makePage("batch-sr-multi", "unused", {
    content: pageContent as JSONContent,
    updatedAt: 8,
  });
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("search-replace-multi");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "search_replace",
        operationId: "sr-a",
        pageId: page.id,
        oldString: "alpha",
        newString: "ALPHA",
      },
      {
        type: "search_replace",
        operationId: "sr-b",
        pageId: page.id,
        oldString: "gamma",
        newString: "GAMMA",
      },
    ]),
  });

  expect(prepared.ok, prepared.ok ? undefined : prepared.error).toBe(true);
  if (!prepared.ok) return;

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(writeCalls).toBe(2);
  expect(result.results.map((item) => item.operationId)).toEqual([
    "sr-a",
    "sr-b",
  ]);

  const blocks = usePages.getState().pages[page.id].content as Array<{
    id?: string;
  }>;
  expect(blocks[1]?.id).toBe("p2");
  const serialized = JSON.stringify(blocks);
  expect(serialized).toContain("ALPHA");
  expect(serialized).toContain("GAMMA");
  expect(serialized).toContain("beta");
});

test("同页多条 search_replace 批准后不因写入抬升修订而全军覆没", async () => {
  const pageContent = [
    { id: "p1", type: "paragraph", content: "alpha" },
    { id: "p2", type: "paragraph", content: "beta" },
    { id: "p3", type: "paragraph", content: "gamma" },
  ];
  const page = makePage("batch-sr-revision", "unused", {
    content: pageContent as JSONContent,
    updatedAt: 20,
  });
  installState({ [page.id]: page });
  const innerWrite = usePages.getState().writePageContent;
  usePages.setState({
    writePageContent: async (pageId, nextContent, mode) => {
      const ok = await innerWrite(pageId, nextContent, mode);
      // 模拟编辑器重载再次抬升 updatedAt，复现「下一项仍卡在旧快照」
      usePages.setState((state) => {
        const current = state.pages[pageId];
        if (!current) return state;
        return {
          pages: {
            ...state.pages,
            [pageId]: { ...current, updatedAt: current.updatedAt + 1 },
          },
        };
      });
      return ok;
    },
  });
  const { toolCallId, runId } = ids("search-replace-revision");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "search_replace",
        operationId: "sr-a",
        pageId: page.id,
        oldString: "alpha",
        newString: "ALPHA",
      },
      {
        type: "search_replace",
        operationId: "sr-b",
        pageId: page.id,
        oldString: "gamma",
        newString: "GAMMA",
      },
    ]),
  });
  expect(prepared.ok, prepared.ok ? undefined : prepared.error).toBe(true);
  if (!prepared.ok) return;

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.error ?? "").not.toContain("页面内容已发生变化");
  expect(writeCalls).toBe(2);
  const serialized = JSON.stringify(usePages.getState().pages[page.id].content);
  expect(serialized).toContain("ALPHA");
  expect(serialized).toContain("GAMMA");

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok, undone.ok ? undefined : undone.error).toBe(true);
  expect((undone.error ?? "").split("页面内容已发生变化").length - 1).toBe(0);
});

test("成功执行后可整批撤回，重复执行保持幂等", async () => {
  const pageA = makePage("batch-undo-a", "撤回前 A");
  const pageB = makePage("batch-undo-b", "撤回前 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("undo");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "执行后 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "执行后 B",
      },
    ]),
  });

  const first = await executePreparedBatchPlan(toolCallId, runId);
  const repeated = await executePreparedBatchPlan(toolCallId, runId);

  expect(first.ok, first.ok ? undefined : first.error).toBe(true);
  expect(repeated.ok).toBe(true);
  expect(writeCalls).toBe(2);
  expect(textOf(pageA.id)).toContain("执行后 A");
  expect(textOf(pageB.id)).toContain("执行后 B");

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok).toBe(true);
  expect(undone.journal.status).toBe("undone");
  expect(textOf(pageA.id)).toContain("撤回前 A");
  expect(textOf(pageB.id)).toContain("撤回前 B");
  expect(writeCalls).toBe(4);
});

test("执行后用户编辑会让整批撤回冲突，且不会覆盖用户内容", async () => {
  const page = makePage("batch-undo-conflict", "原始内容");
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("undo-conflict");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit",
        pageId: page.id,
        markdown: "AI 批量内容",
      },
    ]),
  });
  await executePreparedBatchPlan(toolCallId, runId);

  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [page.id]: {
        ...state.pages[page.id],
        content: content("用户后续编辑"),
        updatedAt: 99,
      },
    },
  }));
  const undone = await undoBatchPlan(toolCallId, runId);

  expect(undone.ok).toBe(false);
  expect(undone.journal.status).toBe("undo-conflicted");
  expect(textOf(page.id)).toContain("用户后续编辑");
  expect(writeCalls).toBe(1);
});

test("本地文件正文审批执行后不会注入文件名 H1", async () => {
  const localPage = makePage("batch-local-edit", "本地旧内容", {
    localFilePath: "/tmp/goose-batch/公司账号.md",
  });
  installState({ [localPage.id]: localPage }, "local-folder");
  const { toolCallId, runId } = ids("local-edit");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-local",
        pageId: localPage.id,
        markdown: "## 人员账号\n\n整理后的本地正文",
      },
    ]),
  });

  expect(prepared.ok).toBe(true);
  expect(writeCalls).toBe(0);
  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  const blocks = usePages.getState().pages[localPage.id].content as Array<{
    type?: string;
    props?: { level?: number };
    content?: unknown;
  }>;
  expect(blocks[0]).toMatchObject({ type: "heading", props: { level: 2 } });
  expect(JSON.stringify(blocks)).toContain("人员账号");
  expect(JSON.stringify(blocks)).not.toContain("公司账号");
});

test("本地文件系统不可用时删除计划在冻结阶段即标记为 invalid，且零写入", async () => {
  const localPage = makePage("batch-local-delete", "本地内容", {
    localFilePath: "/tmp/goose-batch/a.md",
  });
  installState({ [localPage.id]: localPage }, "local-folder");
  const { toolCallId, runId } = ids("local-delete");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      { type: "delete", operationId: "delete-local", pageIds: [localPage.id] },
    ]),
  });

  expect(prepared.ok).toBe(false);
  expect(prepared.journal?.status).toBe("invalid");
  expect(prepared.error).toContain("本地文件系统不可用");
  expect(writeCalls).toBe(0);
  expect(usePages.getState().pages[localPage.id]).toBeDefined();
});

test("审批后删除树新增子页面时整批拒绝，不删除未预览页面", async () => {
  const parent = makePage("batch-delete-tree-parent", "父页面");
  const child = makePage("batch-delete-tree-child", "原子页面", {
    parentId: parent.id,
  });
  installState({ [parent.id]: parent, [child.id]: child });
  const { toolCallId, runId } = ids("delete-tree-change");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "delete",
        operationId: "delete-tree",
        pageIds: [parent.id],
      },
    ]),
  });

  const lateChild = makePage("batch-delete-tree-late-child", "审批后新建", {
    parentId: parent.id,
  });
  usePages.setState((state) => ({
    pages: { ...state.pages, [lateChild.id]: lateChild },
  }));
  const result = await executePreparedBatchPlan(toolCallId, runId);

  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.error).toContain("页面树在审批后发生变化");
  expect(usePages.getState().pages[parent.id].trashedAt).toBeUndefined();
  expect(usePages.getState().pages[child.id].trashedAt).toBeUndefined();
  expect(usePages.getState().pages[lateChild.id].trashedAt).toBeUndefined();
});

test("同一删除操作中途失败时恢复本项已删除页面", async () => {
  const pageA = makePage("batch-delete-partial-a", "页面 A");
  const pageB = makePage("batch-delete-partial-b", "页面 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("delete-partial");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "delete",
        operationId: "delete-two-roots",
        pageIds: [pageA.id, pageB.id],
      },
    ]),
  });

  const originalDeletePage = usePages.getState().deletePage;
  usePages.setState({
    deletePage: async (pageId) =>
      pageId === pageB.id ? false : originalDeletePage(pageId),
  });
  try {
    const result = await executePreparedBatchPlan(toolCallId, runId);
    expect(result.ok).toBe(false);
    expect(usePages.getState().pages[pageA.id].trashedAt).toBeUndefined();
    expect(usePages.getState().pages[pageB.id].trashedAt).toBeUndefined();
  } finally {
    usePages.setState({ deletePage: originalDeletePage });
  }
});

test("创建页已落地但结果日志中断时按预分配 ID 恢复，不重复创建", async () => {
  installState({});
  const { toolCallId, runId } = ids("recover-create");
  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "create",
        operationId: "create-page",
        title: "中断创建",
        markdown: "确定性正文",
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;

  const pageId = prepared.journal.plannedPageIds["create-page"];
  usePages.getState().createPageRecord({
    id: pageId,
    workspaceId: "batch-notebook",
    content: buildAiPageContent("中断创建", "确定性正文"),
  });
  writeBatchPlanJournal({
    ...prepared.journal,
    status: "executing",
    executingOperationId: "create-page",
    executingStartedAt: Date.now() - 1,
  });

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.journal.status).toBe("completed");
  expect(
    result.results.filter((item) => item.operationId === "create-page"),
  ).toHaveLength(1);
  expect(Object.keys(usePages.getState().pages)).toEqual([pageId]);
});

test("编辑已落地但结果日志中断时按计划后签名补记，不重复写入", async () => {
  const page = makePage("batch-recover-edit", "冻结前正文");
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("recover-edit");
  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-page",
        pageId: page.id,
        markdown: "已经落地的计划正文",
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;

  // 与 executor.plannedContent（mergeFullEdit）对齐：中断恢复按内容签名认领。
  const landedContent = mergeFullEditPreservingUnchangedBlocks(
    prepared.journal.before[page.id].page.content,
    "已经落地的计划正文",
    { ensureFirstTitle: true },
  ).content;
  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [page.id]: {
        ...state.pages[page.id],
        content: landedContent,
        updatedAt: state.pages[page.id].updatedAt + 1,
      },
    },
  }));
  writeBatchPlanJournal({
    ...prepared.journal,
    status: "executing",
    executingOperationId: "edit-page",
    executingStartedAt: Date.now() - 1,
  });

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.journal.status).toBe("completed");
  expect(writeCalls).toBe(0);
  expect(textOf(page.id)).toContain("已经落地的计划正文");
});

test("删除恢复只认 Agent 批次标记，不接管用户自行删除的页面", async () => {
  const page = makePage("batch-recover-user-delete", "用户页面");
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("recover-user-delete");
  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "delete",
        operationId: "delete-page",
        pageIds: [page.id],
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;

  // 模拟 intent 落盘后，用户通过普通入口自行删除；它会得到不同的 trashBatchId。
  expect(await usePages.getState().deletePage(page.id)).toBe(true);
  writeBatchPlanJournal({
    ...prepared.journal,
    status: "executing",
    executingOperationId: "delete-page",
    executingStartedAt: Date.now() - 1,
  });

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok).toBe(false);
  expect(result.journal.status).toBe("failed");
  expect(usePages.getState().pages[page.id].trashedAt).toBeDefined();
  expect(usePages.getState().pages[page.id].trashBatchId).not.toBe(
    prepared.journal.deleteBatchIdsByOperationId["delete-page"],
  );
});
