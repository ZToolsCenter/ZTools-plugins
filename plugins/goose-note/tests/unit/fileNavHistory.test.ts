import { expect, test } from "playwright/test";
import {
  pageFileNavKey,
  useFileNavHistory,
} from "../../src/stores/useFileNavHistory";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";
import { useSettings } from "../../src/stores/useSettings";
import { useSidebarView } from "../../src/stores/useSidebarView";
import { useTabs } from "../../src/stores/useTabs";
import type { Page } from "../../src/types";

const notebookId = "file-nav-notebook";

function makePage(id: string, extra?: Partial<Page>): Page {
  return {
    id,
    workspaceId: notebookId,
    content: [{ type: "paragraph", content: id }],
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

async function waitForActivePage(pageId: string) {
  await expect
    .poll(() => usePages.getState().activePageId, { timeout: 2000 })
    .toBe(pageId);
}

test.beforeEach(() => {
  useFileNavHistory.getState().reset();
  usePages.setState({
    pages: {
      a: makePage("a"),
      b: makePage("b"),
      c: makePage("c"),
    },
    activePageId: null,
    hydrated: true,
    dirtyLocalPageIds: {},
  });
  useNotebooks.setState({
    notebooks: {
      [notebookId]: {
        id: notebookId,
        name: "Nav",
        createdAt: 1,
        updatedAt: 1,
      },
    },
    activeNotebookId: notebookId,
    lastActivePageByNotebook: {},
  });
  useTabs.setState({
    openTabs: [],
    activeTabId: null,
    tabHistory: [],
    tabHistoryIndex: -1,
    isHistoryNavigating: false,
    recentlyClosedPageIds: [],
  });
  useSettings.setState({ singleTabMode: false });
  useSidebarView.setState({
    selectedByNotebook: {},
    focusedByNotebook: {},
  });
});

test("预览标签互相替换后，后退仍回到上下选中的文件", async () => {
  useTabs.getState().openPreviewTab("a");
  useTabs.getState().openPreviewTab("b");
  useTabs.getState().openPreviewTab("c");

  expect(useFileNavHistory.getState().entries).toEqual([
    pageFileNavKey("a"),
    pageFileNavKey("b"),
    pageFileNavKey("c"),
  ]);
  expect(useTabs.getState().openTabs.map((tab) => tab.pageId)).toEqual(["c"]);

  useTabs.getState().goBackTabHistory();
  await waitForActivePage("b");
  expect(useTabs.getState().openTabs.some((tab) => tab.pageId === "b")).toBe(
    true,
  );
  expect(useSidebarView.getState().selectedByNotebook[notebookId]).toBe("b");

  useTabs.getState().goBackTabHistory();
  await waitForActivePage("a");

  useTabs.getState().goForwardTabHistory();
  await waitForActivePage("b");
});

test("单标签模式同样记录文件历史", async () => {
  useSettings.setState({ singleTabMode: true });
  useTabs.getState().openPreviewTab("a");
  await waitForActivePage("a");
  useTabs.getState().openPreviewTab("b");
  await waitForActivePage("b");
  useTabs.getState().openPreviewTab("c");
  await waitForActivePage("c");

  expect(useFileNavHistory.getState().entries).toEqual([
    pageFileNavKey("a"),
    pageFileNavKey("b"),
    pageFileNavKey("c"),
  ]);

  useTabs.getState().goBackTabHistory();
  await waitForActivePage("b");
  expect(useTabs.getState().openTabs).toHaveLength(1);
  expect(useTabs.getState().openTabs[0].pageId).toBe("b");
});

test("已删除文件会被跳过", async () => {
  const nav = useFileNavHistory.getState();
  nav.push(pageFileNavKey("a"));
  nav.push(pageFileNavKey("gone"));
  nav.push(pageFileNavKey("c"));

  usePages.setState((state) => ({
    pages: { a: state.pages.a, c: state.pages.c },
  }));

  useTabs.getState().goBackTabHistory();
  await waitForActivePage("a");
  expect(useFileNavHistory.getState().index).toBe(0);
});
