import { expect, test } from "playwright/test";
import {
  renderWorkspaceAfterStartup,
  restoreLastNoteIfNeeded,
} from "../../src/lib/workspaceStartup";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";
import { useSettings } from "../../src/stores/useSettings";
import { useTabs } from "../../src/stores/useTabs";
import type { Page } from "../../src/types";

const notebookId = "startup-notebook";
const pageId = "startup-page";

const page: Page = {
  id: pageId,
  workspaceId: notebookId,
  content: [{ type: "paragraph", content: "last note" }],
  isLocked: false,
  fontSize: "default",
  fontFamily: "default",
  createdAt: 1,
  updatedAt: 1,
};

test.beforeEach(() => {
  usePages.setState({
    pages: { [pageId]: page },
    activePageId: null,
    hydrated: true,
  });
  useNotebooks.setState({
    notebooks: {
      [notebookId]: {
        id: notebookId,
        name: "Startup",
        createdAt: 1,
        updatedAt: 1,
      },
    },
    activeNotebookId: notebookId,
    lastActivePageByNotebook: { [notebookId]: pageId },
  });
  useTabs.setState({
    openTabs: [],
    activeTabId: null,
    tabHistory: [],
    tabHistoryIndex: -1,
  });
  useSettings.setState((state) => ({
    singleTabMode: false,
    privacy: { ...state.privacy, autoOpenLastNote: true },
  }));
});

test("restores the last page and its tab before the workspace mounts", () => {
  expect(restoreLastNoteIfNeeded()).toBe("restored");
  expect(usePages.getState().activePageId).toBe(pageId);

  const tabs = useTabs.getState();
  expect(tabs.openTabs).toHaveLength(1);
  expect(tabs.openTabs[0].pageId).toBe(pageId);
  expect(tabs.activeTabId).toBe(tabs.openTabs[0].id);
});

test("keeps the home state when automatic restore is disabled", () => {
  useSettings.setState((state) => ({
    privacy: { ...state.privacy, autoOpenLastNote: false },
  }));

  expect(restoreLastNoteIfNeeded()).toBe("disabled");
  expect(usePages.getState().activePageId).toBeNull();
  expect(useTabs.getState().openTabs).toHaveLength(0);
});

test("keeps the home state when no valid history exists", () => {
  usePages.setState({ pages: {} });

  expect(restoreLastNoteIfNeeded()).toBe("no-history");
  expect(usePages.getState().activePageId).toBeNull();
  expect(useTabs.getState().openTabs).toHaveLength(0);
});

test("does not render the workspace until asynchronous restoration finishes", async () => {
  const events: string[] = [];
  let finishRestore!: () => void;
  const restoration = new Promise<void>((resolve) => {
    finishRestore = () => {
      events.push("restored");
      resolve();
    };
  });

  const startup = renderWorkspaceAfterStartup({
    prepare: async () => {
      events.push("prepare-start");
      await restoration;
    },
    render: () => events.push("render"),
    renderError: () => events.push("error"),
  });

  await Promise.resolve();
  expect(events).toEqual(["prepare-start"]);

  finishRestore();
  await expect(startup).resolves.toBe("rendered");
  expect(events).toEqual(["prepare-start", "restored", "render"]);
});

test("renders a recoverable error instead of staying blank when startup fails", async () => {
  const events: string[] = [];
  const result = await renderWorkspaceAfterStartup({
    prepare: () => {
      throw new Error("storage unavailable");
    },
    render: () => events.push("render"),
    renderError: () => events.push("error"),
  });

  expect(result).toBe("error");
  expect(events).toEqual(["error"]);
});

test("restores a loaded local-folder page before the workspace mounts", () => {
  useNotebooks.setState((state) => ({
    notebooks: {
      [notebookId]: {
        ...state.notebooks[notebookId],
        source: "local-folder",
        localPath: "/notes",
      },
    },
  }));
  usePages.setState({
    pages: {
      [pageId]: {
        ...page,
        localFilePath: "/notes/last.md",
      },
    },
  });

  expect(restoreLastNoteIfNeeded()).toBe("restored");
  expect(usePages.getState().activePageId).toBe(pageId);
});
