import { expect, test } from "playwright/test";
import type { JSONContent, Page } from "../../src/types";
import {
  executePreparedBatchPlan,
  prepareBatchPlan,
  undoBatchPlan,
} from "../../src/lib/notebook-ai/batch-plan/executor";
import type { BatchPlanInput } from "../../src/lib/notebook-ai/batch-plan/types";
import { updateBatchPlanSelection } from "../../src/lib/notebook-ai/batch-plan/journal";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";

const NOTEBOOK_ID = "local-batch-notebook";
const ROOT = "/tmp/goose-local-batch";
let sequence = 0;

function content(text: string): JSONContent {
  return [{ type: "paragraph", content: text }];
}

function makeLocalPage(
  id: string,
  title: string,
  text: string,
  overrides: Partial<Page> = {},
): Page {
  return {
    id,
    workspaceId: NOTEBOOK_ID,
    content: content(text),
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    localFilePath: `${ROOT}/${title}.md`,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function ids(label: string) {
  sequence += 1;
  return {
    toolCallId: `local-batch-tool-${label}-${sequence}`,
    runId: `local-batch-run-${label}-${sequence}`,
  };
}

function plan(operations: BatchPlanInput["operations"]): BatchPlanInput {
  return {
    title: "本地批量更新",
    summary: "验证本地文件批量执行与撤回",
    operations,
  };
}

function installEnvironment(initialPages: Page[] = []) {
  const storage = new Map<string, string>();
  const files = new Map<string, string>();
  const directories = new Set<string>([ROOT]);
  for (const page of initialPages) {
    if (page.localFilePath) files.set(page.localFilePath, "before");
  }

  const gooseFs: GooseFs = {
    readDir: () => [],
    readFile: (path) => files.get(path) ?? null,
    readFileAsync: async (path) => files.get(path) ?? null,
    writeFile: (path, value) => {
      files.set(path, value);
      return true;
    },
    writeFileAsync: async (path, value) => {
      files.set(path, value);
      return true;
    },
    exists: (path) => files.has(path) || directories.has(path),
    existsAsync: async (path) => files.has(path) || directories.has(path),
    watch: () => null,
    unwatch: () => undefined,
    mkdir: (path) => {
      directories.add(path);
      return true;
    },
    deleteFile: async (path) => files.delete(path),
    deleteDir: async (path) => directories.delete(path),
    rename: (oldPath, newPath) => {
      if (!files.has(oldPath) || files.has(newPath)) return false;
      files.set(newPath, files.get(oldPath)!);
      files.delete(oldPath);
      return true;
    },
  };

  (globalThis as { window?: unknown }).window = {
    gooseFs,
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  };

  useNotebooks.setState({
    notebooks: {
      [NOTEBOOK_ID]: {
        id: NOTEBOOK_ID,
        name: "本地批量测试",
        source: "local-folder",
        localPath: ROOT,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    activeNotebookId: NOTEBOOK_ID,
  });
  usePages.setState({
    pages: Object.fromEntries(initialPages.map((page) => [page.id, page])),
    activePageId: null,
    writePageContent: async (pageId, nextContent) => {
      usePages.setState((state) => {
        const page = state.pages[pageId];
        if (!page) return state;
        return {
          pages: {
            ...state.pages,
            [pageId]: {
              ...page,
              content: nextContent,
              updatedAt: page.updatedAt + 1,
            },
          },
        };
      });
      return true;
    },
  });

  return { files, gooseFs };
}

test.afterEach(() => {
  usePages.setState({ pages: {}, activePageId: null });
  useNotebooks.setState({ notebooks: {}, activeNotebookId: null });
  delete (globalThis as { window?: unknown }).window;
});

test("本地正文与文件名可以在同一审批操作中执行并撤回", async () => {
  const page = makeLocalPage("local-edit-rename", "旧标题", "旧正文");
  const { files } = installEnvironment([page]);
  const { toolCallId, runId } = ids("edit-rename");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "edit",
        operationId: "edit-and-rename",
        pageId: page.id,
        title: "新标题",
        markdown: "## 新结构\n\n整理后的正文",
      },
    ]),
  });
  expect(prepared.ok, prepared.ok ? undefined : prepared.error).toBe(true);

  const executed = await executePreparedBatchPlan(toolCallId, runId);
  expect(executed.ok, executed.ok ? undefined : executed.error).toBe(true);
  expect(usePages.getState().pages[page.id].localFilePath).toBe(
    `${ROOT}/新标题.md`,
  );
  expect(files.has(`${ROOT}/新标题.md`)).toBe(true);
  expect(JSON.stringify(usePages.getState().pages[page.id].content)).toContain(
    "整理后的正文",
  );

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok, undone.ok ? undefined : undone.error).toBe(true);
  expect(usePages.getState().pages[page.id].localFilePath).toBe(
    `${ROOT}/旧标题.md`,
  );
  expect(files.has(`${ROOT}/旧标题.md`)).toBe(true);
  expect(JSON.stringify(usePages.getState().pages[page.id].content)).toContain(
    "旧正文",
  );
});

test("本地笔记本可以从审批计划新建页面并撤回", async () => {
  const { files } = installEnvironment();
  const { toolCallId, runId } = ids("create");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "create",
        operationId: "create-local",
        title: "本地新页",
        markdown: "本地新正文",
      },
    ]),
  });
  expect(prepared.ok, prepared.ok ? undefined : prepared.error).toBe(true);
  expect(files.has(`${ROOT}/本地新页.md`)).toBe(false);

  const executed = await executePreparedBatchPlan(toolCallId, runId);
  expect(executed.ok, executed.ok ? undefined : executed.error).toBe(true);
  const createdId = executed.journal.createdPageIds["create-local"];
  expect(usePages.getState().pages[createdId].localFilePath).toBe(
    `${ROOT}/本地新页.md`,
  );
  expect(files.has(`${ROOT}/本地新页.md`)).toBe(true);

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok, undone.ok ? undefined : undone.error).toBe(true);
  expect(usePages.getState().pages[createdId]).toBeUndefined();
  expect(files.has(`${ROOT}/本地新页.md`)).toBe(false);
});

test("本地删除先进入可恢复暂存区，撤回时恢复原文件", async () => {
  const page = makeLocalPage("local-delete", "待删除", "保留正文");
  const { files } = installEnvironment([page]);
  const { toolCallId, runId } = ids("delete");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "delete",
        operationId: "delete-local",
        pageIds: [page.id],
      },
    ]),
  });
  expect(prepared.ok, prepared.ok ? undefined : prepared.error).toBe(true);

  const executed = await executePreparedBatchPlan(toolCallId, runId);
  expect(executed.ok, executed.ok ? undefined : executed.error).toBe(true);
  expect(usePages.getState().pages[page.id]).toBeUndefined();
  expect(files.has(`${ROOT}/待删除.md`)).toBe(false);
  expect(
    [...files.keys()].some((path) =>
      path.startsWith(`${ROOT}/.goose/ai-batch-trash/`),
    ),
  ).toBe(true);

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok, undone.ok ? undefined : undone.error).toBe(true);
  expect(usePages.getState().pages[page.id]).toBeDefined();
  expect(files.has(`${ROOT}/待删除.md`)).toBe(true);
  expect(
    [...files.keys()].some((path) =>
      path.startsWith(`${ROOT}/.goose/ai-batch-trash/`),
    ),
  ).toBe(false);
});

test("拒绝操作根目录之外的伪造本地页面", async () => {
  const page = makeLocalPage("local-outside", "越界", "内容", {
    localFilePath: "/tmp/outside.md",
  });
  installEnvironment([page]);
  const { toolCallId, runId } = ids("outside");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "edit",
        operationId: "edit-outside",
        pageId: page.id,
        markdown: "不应写入",
      },
    ]),
  });

  expect(prepared.ok).toBe(false);
  expect(prepared.ok ? "" : prepared.error).toContain("笔记本根目录之外");
});

test("未选择的本地删除不会阻塞已执行操作的撤回", async () => {
  const edited = makeLocalPage("local-selected-edit", "编辑页", "旧正文");
  const untouched = makeLocalPage("local-unselected-delete", "保留页", "保留");
  const { files } = installEnvironment([edited, untouched]);
  const { toolCallId, runId } = ids("selection");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "edit",
        operationId: "selected-edit",
        pageId: edited.id,
        markdown: "新正文",
      },
      {
        type: "delete",
        operationId: "unselected-delete",
        pageIds: [untouched.id],
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  updateBatchPlanSelection(toolCallId, runId, ["selected-edit"]);

  const executed = await executePreparedBatchPlan(toolCallId, runId);
  expect(executed.ok, executed.ok ? undefined : executed.error).toBe(true);
  expect(files.has(`${ROOT}/保留页.md`)).toBe(true);

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok, undone.ok ? undefined : undone.error).toBe(true);
  expect(
    JSON.stringify(usePages.getState().pages[edited.id].content),
  ).toContain("旧正文");
});

test("本地删除后原路径被外部占用时拒绝撤回", async () => {
  const page = makeLocalPage("local-delete-conflict", "冲突页", "旧正文");
  const { files } = installEnvironment([page]);
  const { toolCallId, runId } = ids("delete-conflict");

  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "delete",
        operationId: "delete-conflict",
        pageIds: [page.id],
      },
    ]),
  });
  const executed = await executePreparedBatchPlan(toolCallId, runId);
  expect(executed.ok).toBe(true);

  files.set(`${ROOT}/冲突页.md`, "external replacement");
  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok).toBe(false);
  expect(undone.ok ? "" : undone.error).toContain("恢复路径已变化");
  expect(files.get(`${ROOT}/冲突页.md`)).toBe("external replacement");
  expect(
    [...files.keys()].some((path) =>
      path.startsWith(`${ROOT}/.goose/ai-batch-trash/`),
    ),
  ).toBe(true);
});

test("拒绝真实路径逃出根目录的符号链接页面", async () => {
  const page = makeLocalPage("local-symlink", "链接页", "内容");
  const { gooseFs } = installEnvironment([page]);
  gooseFs.realpathAsync = async (path) =>
    path === ROOT ? ROOT : "/tmp/outside/链接页.md";
  const { toolCallId, runId } = ids("symlink");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: NOTEBOOK_ID,
    input: plan([
      {
        type: "edit",
        operationId: "edit-symlink",
        pageId: page.id,
        markdown: "不应写入",
      },
    ]),
  });

  expect(prepared.ok).toBe(false);
  expect(prepared.ok ? "" : prepared.error).toContain("真实路径");
});
