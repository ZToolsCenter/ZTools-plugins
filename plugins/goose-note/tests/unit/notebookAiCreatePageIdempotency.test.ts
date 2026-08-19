import { expect, test } from "playwright/test";
import {
  cleanupWriterSession,
  createAndFinalizePage,
  handleStreamingWritePart,
  type StreamingWritePart,
} from "../../src/lib/notebook-ai/liveWriter";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";
import { useTabs } from "../../src/stores/useTabs";
import type { JSONContent, Page } from "../../src/types";

const notebookId = "notebook-ai-idempotency";
const toolCallIds: string[] = [];

const originalCreatePageRecord = usePages.getState().createPageRecord;
const originalCreateLocalPageRecord = usePages.getState().createLocalPageRecord;
const originalWritePageContent = usePages.getState().writePageContent;
const originalOpenTab = useTabs.getState().openTab;
const originalSetLastActivePage = useNotebooks.getState().setLastActivePage;

function createPage(id: string, content: JSONContent): Page {
  return {
    id,
    workspaceId: notebookId,
    content,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
  };
}

function installCommonMocks() {
  useTabs.setState({ openTab: () => {} });
  useNotebooks.setState({
    setLastActivePage: () => {},
  });
  usePages.setState({
    pages: {},
    activePageId: null,
    writePageContent: async (pageId, content) => {
      usePages.setState((state) => ({
        pages: {
          ...state.pages,
          [pageId]: {
            ...state.pages[pageId],
            content,
            updatedAt: state.pages[pageId].updatedAt + 1,
          },
        },
      }));
      return true;
    },
  });
}

test.beforeEach(() => {
  useNotebooks.setState({
    notebooks: {
      [notebookId]: {
        id: notebookId,
        name: "AI 测试笔记本",
        createdAt: 1,
        updatedAt: 1,
      },
    },
    activeNotebookId: notebookId,
  });
  installCommonMocks();
});

test.afterEach(() => {
  for (const toolCallId of toolCallIds.splice(0)) {
    cleanupWriterSession(toolCallId);
  }
  usePages.setState({
    pages: {},
    createPageRecord: originalCreatePageRecord,
    createLocalPageRecord: originalCreateLocalPageRecord,
    writePageContent: originalWritePageContent,
  });
  useTabs.setState({ openTab: originalOpenTab });
  useNotebooks.setState({
    setLastActivePage: originalSetLastActivePage,
  });
});

test("execute 先完成后，迟到的流式事件不会再创建一页", async () => {
  const toolCallId = "tool-execute-first";
  toolCallIds.push(toolCallId);
  let createCount = 0;

  usePages.setState({
    createPageRecord: ({ content }) => {
      createCount += 1;
      const pageId = `page-${createCount}`;
      usePages.setState((state) => ({
        pages: { ...state.pages, [pageId]: createPage(pageId, content) },
      }));
      return pageId;
    },
  });

  const result = await createAndFinalizePage({
    toolCallId,
    notebookId,
    title: "只应创建一次",
    markdown: "这是完整正文。",
  });
  expect(result).toEqual({ ok: true, pageId: "page-1" });

  await handleStreamingWritePart(
    {
      type: "tool-createPage",
      toolCallId,
      state: "input-streaming",
      input: { title: "只应创建一次", markdown: "这是完整正文。" },
    } as unknown as StreamingWritePart,
    { notebookId },
  );

  expect(createCount).toBe(1);
  expect(Object.keys(usePages.getState().pages)).toEqual(["page-1"]);
});

test("流式预建后，execute 复用同一页并提交完整正文", async () => {
  const toolCallId = "tool-streaming-first";
  toolCallIds.push(toolCallId);
  let createCount = 0;

  usePages.setState({
    createPageRecord: ({ content }) => {
      createCount += 1;
      const pageId = `page-${createCount}`;
      usePages.setState((state) => ({
        pages: { ...state.pages, [pageId]: createPage(pageId, content) },
      }));
      return pageId;
    },
  });

  await handleStreamingWritePart(
    {
      type: "tool-createPage",
      toolCallId,
      state: "input-streaming",
      input: { title: "流式文章", markdown: "部分正文" },
    } as unknown as StreamingWritePart,
    { notebookId },
  );
  const result = await createAndFinalizePage({
    toolCallId,
    notebookId,
    title: "流式文章",
    markdown: "最终完整正文",
  });

  expect(result).toEqual({ ok: true, pageId: "page-1" });
  expect(createCount).toBe(1);
  expect(Object.keys(usePages.getState().pages)).toEqual(["page-1"]);
  expect(JSON.stringify(usePages.getState().pages["page-1"].content)).toContain(
    "最终完整正文",
  );
});

test("本地文件异步创建中，流式与 execute 并发仍只创建一次", async () => {
  const toolCallId = "tool-local-concurrent";
  toolCallIds.push(toolCallId);
  let createCount = 0;
  let finishCreate: (() => void) | undefined;
  const creationGate = new Promise<void>((resolve) => {
    finishCreate = resolve;
  });

  useNotebooks.setState((state) => ({
    notebooks: {
      ...state.notebooks,
      [notebookId]: {
        ...state.notebooks[notebookId],
        source: "local-folder",
        localPath: "/tmp/goose-note-ai-test",
      },
    },
  }));
  usePages.setState({
    createLocalPageRecord: async ({ content }) => {
      createCount += 1;
      await creationGate;
      const pageId = "local-page-1";
      usePages.setState((state) => ({
        pages: { ...state.pages, [pageId]: createPage(pageId, content) },
      }));
      return pageId;
    },
  });

  const streaming = handleStreamingWritePart(
    {
      type: "tool-createPage",
      toolCallId,
      state: "input-streaming",
      input: { title: "本地文章", markdown: "部分正文" },
    } as unknown as StreamingWritePart,
    { notebookId },
  );
  await Promise.resolve();
  const execute = createAndFinalizePage({
    toolCallId,
    notebookId,
    title: "本地文章",
    markdown: "最终完整正文",
  });
  await Promise.resolve();

  expect(createCount).toBe(1);
  finishCreate?.();
  const [, result] = await Promise.all([streaming, execute]);

  expect(result).toEqual({ ok: true, pageId: "local-page-1" });
  expect(createCount).toBe(1);
  expect(Object.keys(usePages.getState().pages)).toEqual(["local-page-1"]);
});

test("乱序 output 事件不会阻止稍后的 execute 建页", async () => {
  const toolCallId = "tool-output-first";
  toolCallIds.push(toolCallId);
  let createCount = 0;

  usePages.setState({
    createPageRecord: ({ content }) => {
      createCount += 1;
      const pageId = `page-${createCount}`;
      usePages.setState((state) => ({
        pages: { ...state.pages, [pageId]: createPage(pageId, content) },
      }));
      return pageId;
    },
  });

  await handleStreamingWritePart(
    {
      type: "tool-createPage",
      toolCallId,
      state: "output-available",
      input: { title: "乱序文章", markdown: "最终正文" },
    } as unknown as StreamingWritePart,
    { notebookId },
  );
  const result = await createAndFinalizePage({
    toolCallId,
    notebookId,
    title: "乱序文章",
    markdown: "最终正文",
  });

  expect(result).toEqual({ ok: true, pageId: "page-1" });
  expect(createCount).toBe(1);
});

test("updatePage 完成事件重复到达时不会再次写入页面", async () => {
  const toolCallId = "tool-update-output-replayed";
  const pageId = "existing-page";
  toolCallIds.push(toolCallId);
  let writeCount = 0;

  usePages.setState({
    pages: {
      [pageId]: createPage(pageId, [
        { type: "heading", props: { level: 1 }, content: "现有页面" },
        { type: "paragraph", content: "已由工具写入的正文" },
      ]),
    },
    activePageId: pageId,
    writePageContent: async () => {
      writeCount += 1;
      return true;
    },
  });

  const completedPart = {
    type: "tool-updatePage",
    toolCallId,
    state: "output-available",
    input: {
      pageId,
      markdown: "已由工具写入的正文",
    },
    output: { pageId, title: "现有页面", ok: true },
  } as unknown as StreamingWritePart;

  await handleStreamingWritePart(completedPart, { notebookId });
  await handleStreamingWritePart(completedPart, { notebookId });

  expect(writeCount).toBe(0);
  expect(usePages.getState().pages[pageId].updatedAt).toBe(1);
  expect(JSON.stringify(usePages.getState().pages[pageId].content)).toContain(
    "已由工具写入的正文",
  );
});

test("打开标签失败时仍返回已创建页面并完成最终写入", async () => {
  const toolCallId = "tool-open-tab-failed";
  toolCallIds.push(toolCallId);
  let createCount = 0;

  useTabs.setState({
    openTab: () => {
      throw new Error("模拟标签页异常");
    },
  });
  usePages.setState({
    createPageRecord: ({ content }) => {
      createCount += 1;
      const pageId = `page-${createCount}`;
      usePages.setState((state) => ({
        pages: { ...state.pages, [pageId]: createPage(pageId, content) },
      }));
      return pageId;
    },
  });

  const result = await createAndFinalizePage({
    toolCallId,
    notebookId,
    title: "标签异常文章",
    markdown: "正文仍应保存",
  });

  expect(result).toEqual({ ok: true, pageId: "page-1" });
  expect(createCount).toBe(1);
  expect(JSON.stringify(usePages.getState().pages["page-1"].content)).toContain(
    "正文仍应保存",
  );
});

test("流式预建瞬时失败后，execute 会重试并只留下一个页面", async () => {
  const toolCallId = "tool-streaming-retry";
  toolCallIds.push(toolCallId);
  let createCount = 0;

  useNotebooks.setState((state) => ({
    notebooks: {
      ...state.notebooks,
      [notebookId]: {
        ...state.notebooks[notebookId],
        source: "local-folder",
        localPath: "/tmp/goose-note-ai-retry-test",
      },
    },
  }));
  usePages.setState({
    createLocalPageRecord: async ({ content }) => {
      createCount += 1;
      if (createCount === 1) return null;
      const pageId = "local-retry-page";
      usePages.setState((state) => ({
        pages: { ...state.pages, [pageId]: createPage(pageId, content) },
      }));
      return pageId;
    },
  });

  await handleStreamingWritePart(
    {
      type: "tool-createPage",
      toolCallId,
      state: "input-streaming",
      input: { title: "重试文章", markdown: "部分正文" },
    } as unknown as StreamingWritePart,
    { notebookId },
  );
  const result = await createAndFinalizePage({
    toolCallId,
    notebookId,
    title: "重试文章",
    markdown: "最终正文",
  });

  expect(result).toEqual({ ok: true, pageId: "local-retry-page" });
  expect(createCount).toBe(2);
  expect(Object.keys(usePages.getState().pages)).toEqual(["local-retry-page"]);
});
