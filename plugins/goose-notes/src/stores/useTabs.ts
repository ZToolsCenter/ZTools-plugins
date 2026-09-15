import { create } from "zustand";
import { toast } from "@/components/ui/sonner";
import { usePages } from "./usePages";
import { useNotebooks } from "./useNotebooks";
import { useSettings } from "./useSettings";
import { normalizeAutoCloseInactiveTabsHours } from "./settings/types";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useSidebarView } from "./useSidebarView";
import {
  FILE_NAV_WELCOME,
  fileNavKeyForTab,
  pageFileNavKey,
  parseFileNavKey,
  useFileNavHistory,
} from "./useFileNavHistory";

export const WELCOME_TAB_PAGE_ID = "welcome";
export const NOTEBOOK_AI_TAB_PAGE_ID_PREFIX = "notebook-ai:";

export type TabType = "welcome" | "notebook-ai";

export interface TabItem {
  id: string;
  pageId: string;
  type?: TabType;
  pinned?: boolean;
  /** 预览/临时标签：侧栏单击打开，可被下一个预览替换；编辑后晋升永久 */
  preview?: boolean;
  workspaceId?: string;
  lastAccessedAt?: number;
}

export function getNotebookAiTabPageId(notebookId: string): string {
  return `${NOTEBOOK_AI_TAB_PAGE_ID_PREFIX}${notebookId}`;
}

export function isNotebookAiTab(tab: Pick<TabItem, "type"> | null | undefined): boolean {
  return tab?.type === "notebook-ai";
}

export function isSpecialTab(tab: Pick<TabItem, "type"> | null | undefined): boolean {
  return tab?.type === "welcome" || tab?.type === "notebook-ai";
}

interface TabsState {
  openTabs: TabItem[];
  activeTabId: string | null;
  tabHistory: string[];
  tabHistoryIndex: number;
  isHistoryNavigating: boolean;
  recentlyClosedPageIds: string[];
  syncNotebookForPage: (pageId: string | null) => void;
  syncActiveTabForPage: (pageId: string | null) => void;
  openTab: (pageId: string) => void;
  openWelcomeTab: () => void;
  openNotebookAiTab: (notebookId: string) => void;
  closeNotebookAiTab: (notebookId: string) => void;
  findNotebookAiTab: (notebookId: string) => TabItem | undefined;
  openPreviewTab: (pageId: string) => void;
  openPermanentTab: (pageId: string, options?: { pin?: boolean }) => void;
  promotePreviewTab: (tabId?: string) => void;
  openInCurrentTab: (pageId: string) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToLeft: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  togglePinTab: (tabId: string) => void;
  goBackTabHistory: () => void;
  goForwardTabHistory: () => void;
  canGoBackTabHistory: () => boolean;
  canGoForwardTabHistory: () => boolean;
  reorderTabs: (from: number, to: number) => void;
  removeDeletedPage: (pageId: string) => void;
  reopenLastClosedTab: () => void;
  reconcileTabs: () => void;
  closeExpiredTabs: (now?: number) => void;
  clearAllTabs: () => void;
  collapseToActiveTab: () => void;
}

const createTabId = (pageId: string) =>
  `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${pageId.slice(0, 6)}`;

const TABS_PERSIST_KEY = "goose-note:open-tabs:v1";

const getWorkspaceIdForPage = (pageId: string): string | undefined =>
  usePages.getState().getPage(pageId)?.workspaceId;

// 固定标签恒在最左；其余（预览/普通）一律保持插入顺序追加到右侧。
// 新建/新打开的标签因此始终落在最右边。
const orderTabs = (tabs: TabItem[]): TabItem[] => {
  const pinned = tabs.filter((t) => t.pinned);
  const rest = tabs.filter((t) => !t.pinned);
  return [...pinned, ...rest];
};

const applyPinnedOrder = orderTabs;

const findTabByPageId = (tabs: TabItem[], pageId: string) =>
  tabs.find(
    (tab) =>
      tab.pageId === pageId && tab.type !== "welcome" && tab.type !== "notebook-ai",
  );

const findNotebookAiTabInList = (tabs: TabItem[], notebookId: string) =>
  tabs.find(
    (tab) =>
      tab.type === "notebook-ai" &&
      (tab.workspaceId === notebookId ||
        tab.pageId === getNotebookAiTabPageId(notebookId)),
  );

const stampTabAccess = (tab: TabItem, now = Date.now()): TabItem => ({
  ...tab,
  lastAccessedAt: now,
});

// 提交当前编辑器内容（切换/关闭标签前调用），确保未防抖落盘的编辑不丢。
const commitActiveEditor = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("goose-note:flush-editor", { detail: { immediate: true } }),
  );
};

// 对被关闭的页面执行 flush，完成后若仍 dirty（写盘失败）则 toast 警告一次。
// 冲突场景下 write.ts 会 dispatch goose-note:local-file-conflict，
// useLocalFolderWatch 已有 showConflictToast 处理，此处统一 toast 也可接受（不删冲突 UX）。
const flushClosedPageSaves = (pageIds: string[]): void => {
  if (pageIds.length === 0) return;
  const pagesStore = usePages.getState();
  void Promise.all(
    pageIds.map(async (pageId) => {
      try {
        await pagesStore.flushPendingLocalSaveByPageId(pageId);
      } catch (error) {
        console.error("[tabs] closed page flush failed", pageId, error);
      }
      const stillDirty = usePages.getState().dirtyLocalPageIds[pageId];
      if (stillDirty) {
        const page = usePages.getState().getPage(pageId);
        const title = page ? getPageTitle(page) : pageId;
        toast.warning(`「${title}」未能保存到磁盘`, {
          description: "文件可能被外部程序修改，请检查文件状态。",
        });
      }
    }),
  ).catch((error) => {
    // 单页错误已在任务内消费；这里仅兜底，避免关闭标签时产生未处理拒绝。
    console.error("[tabs] closed pages flush failed", error);
  });
};

interface PersistedTabs {
  openTabs: TabItem[];
  activeTabId: string | null;
  recentlyClosedPageIds: string[];
}

const loadPersistedTabs = (): PersistedTabs | null => {
  if (typeof window === "undefined") return null;
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(TABS_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>;
    if (!Array.isArray(parsed.openTabs)) return null;
    return {
      openTabs: parsed.openTabs
        .filter(
          (t) => t && typeof t.id === "string" && typeof t.pageId === "string",
        )
        .map((t) => ({
          ...t,
          lastAccessedAt:
            typeof t.lastAccessedAt === "number" &&
            Number.isFinite(t.lastAccessedAt)
              ? t.lastAccessedAt
              : now,
        })),
      activeTabId:
        typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      recentlyClosedPageIds: Array.isArray(parsed.recentlyClosedPageIds)
        ? parsed.recentlyClosedPageIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return null;
  }
};

let persistScheduled = false;
let pendingPersistState: TabsState | null = null;
const persistTabs = (state: TabsState) => {
  if (typeof window === "undefined") return;
  pendingPersistState = state;
  if (persistScheduled) return;
  persistScheduled = true;
  queueMicrotask(() => {
    persistScheduled = false;
    const latestState = pendingPersistState;
    pendingPersistState = null;
    if (!latestState) return;
    try {
      const persistableTabs = latestState.openTabs.filter(
        (tab) => !tab.preview,
      );
      const activeStillValid = persistableTabs.some(
        (tab) => tab.id === latestState.activeTabId,
      );
      const payload: PersistedTabs = {
        openTabs: persistableTabs,
        activeTabId: activeStillValid
          ? latestState.activeTabId
          : (persistableTabs[persistableTabs.length - 1]?.id ?? null),
        recentlyClosedPageIds: latestState.recentlyClosedPageIds.slice(0, 10),
      };
      window.localStorage.setItem(TABS_PERSIST_KEY, JSON.stringify(payload));
    } catch {
      // 忽略存储异常（隐私模式 / 配额）
    }
  });
};

let setActivePageChain: Promise<void> = Promise.resolve();

const scheduleSetActivePage = (pageId: string | null) => {
  setActivePageChain = setActivePageChain
    .catch(() => {})
    .then(() => usePages.getState().setActivePage(pageId));
  return setActivePageChain;
};

const clampHistoryIndex = (historyLength: number, currentIndex: number) => {
  if (historyLength === 0) return -1;
  if (currentIndex < 0) return 0;
  return Math.min(currentIndex, historyLength - 1);
};

export const useTabs = create<TabsState>()((set, get) => {
  let singleTabSwitchToken = 0;

  const syncHistoryWithOpenTabs = (nextOpenTabs: TabItem[]) => {
    const validTabIds = new Set(nextOpenTabs.map((tab) => tab.id));
    const { tabHistory, tabHistoryIndex } = get();
    const nextHistory = tabHistory.filter((tabId) => validTabIds.has(tabId));
    const nextHistoryIndex = clampHistoryIndex(
      nextHistory.length,
      tabHistoryIndex,
    );
    return {
      tabHistory: nextHistory,
      tabHistoryIndex: nextHistoryIndex,
    };
  };

  const pushTabHistory = (tabId: string) => {
    const { tabHistory, tabHistoryIndex, isHistoryNavigating, openTabs } =
      get();
    if (isHistoryNavigating) return;

    const currentTabId =
      tabHistoryIndex >= 0 && tabHistoryIndex < tabHistory.length
        ? tabHistory[tabHistoryIndex]
        : null;
    if (currentTabId !== tabId) {
      const nextHistory = tabHistory.slice(0, tabHistoryIndex + 1);
      nextHistory.push(tabId);
      set({
        tabHistory: nextHistory,
        tabHistoryIndex: nextHistory.length - 1,
      });
    }

    const tab = openTabs.find((item) => item.id === tabId);
    if (tab) useFileNavHistory.getState().push(fileNavKeyForTab(tab));
  };

  const restoreFileNavLocation = (key: string): boolean => {
    const location = parseFileNavKey(key);
    if (location.type === "ai-panel") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("goose-note:open-ai-panel"));
      }
      return true;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("goose-note:close-ai-panel-if-fullscreen"),
      );
    }
    if (location.type === "welcome") {
      get().openWelcomeTab();
      return true;
    }
    const page = usePages.getState().getPage(location.pageId);
    if (!page || page.trashedAt) return false;
    get().openPreviewTab(page.id);
    if (page.workspaceId) {
      const sidebar = useSidebarView.getState();
      sidebar.setSelected(page.workspaceId, page.id);
      sidebar.setFocused(page.workspaceId, page.id);
    }
    return true;
  };

  const stepFileNavHistory = (direction: "back" | "forward") => {
    const nav = useFileNavHistory.getState();
    const canMove =
      direction === "back" ? nav.canBack() : nav.canForward();
    if (!canMove) return;

    nav.markNavigating(true);
    try {
      while (direction === "back" ? nav.canBack() : nav.canForward()) {
        const key =
          direction === "back" ? nav.moveBack() : nav.moveForward();
        if (key && restoreFileNavLocation(key)) return;
      }
    } finally {
      nav.markNavigating(false);
    }
  };

  const resolveTabIdInHistory = (
    tabId: string | null | undefined,
    openTabs: TabItem[],
  ) => {
    if (!tabId) return null;
    return openTabs.some((tab) => tab.id === tabId) ? tabId : null;
  };

  const replaceWithSinglePage = async (pageId: string) => {
    const targetPage = usePages.getState().getPage(pageId);
    if (!targetPage || targetPage.trashedAt) return;

    const { openTabs, activeTabId } = get();
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    if (activeTab?.pageId === pageId) {
      if (openTabs.length > 1) {
        set({
          openTabs: [activeTab],
          activeTabId: activeTab.id,
          tabHistory: [activeTab.id],
          tabHistoryIndex: 0,
          isHistoryNavigating: false,
        });
      }
      useFileNavHistory.getState().push(pageFileNavKey(pageId));
      get().syncNotebookForPage(pageId);
      void scheduleSetActivePage(pageId);
      return;
    }

    const token = ++singleTabSwitchToken;
    commitActiveEditor();

    const currentPageId =
      activeTab && !isSpecialTab(activeTab) ? activeTab.pageId : null;
    if (currentPageId) {
      await usePages.getState().flushPendingLocalSaveByPageId(currentPageId);
      if (token !== singleTabSwitchToken) return;
      if (usePages.getState().dirtyLocalPageIds[currentPageId]) {
        const currentPage = usePages.getState().getPage(currentPageId);
        toast.error("当前笔记保存失败，未切换", {
          description: currentPage
            ? `请先处理“${getPageTitle(currentPage)}”的文件状态。`
            : "请先处理当前文件的保存状态。",
        });
        return;
      }
    }

    if (token !== singleTabSwitchToken) return;
    const now = Date.now();
    const newTab: TabItem = {
      id: createTabId(pageId),
      pageId,
      workspaceId: getWorkspaceIdForPage(pageId),
      preview: false,
      lastAccessedAt: now,
    };
    set({
      openTabs: [newTab],
      activeTabId: newTab.id,
      tabHistory: [newTab.id],
      tabHistoryIndex: 0,
      isHistoryNavigating: false,
    });
    useFileNavHistory.getState().push(pageFileNavKey(pageId));
    get().syncNotebookForPage(pageId);
    await scheduleSetActivePage(pageId);
  };

  const replaceWithSingleWelcome = async () => {
    const { openTabs, activeTabId } = get();
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    if (activeTab?.type === "welcome" && openTabs.length === 1) return;

    const token = ++singleTabSwitchToken;
    commitActiveEditor();
    const currentPageId =
      activeTab && !isSpecialTab(activeTab) ? activeTab.pageId : null;
    if (currentPageId) {
      await usePages.getState().flushPendingLocalSaveByPageId(currentPageId);
      if (token !== singleTabSwitchToken) return;
      if (usePages.getState().dirtyLocalPageIds[currentPageId]) {
        toast.error("当前笔记保存失败，未切换", {
          description: "请先处理当前文件的保存状态。",
        });
        return;
      }
    }

    const welcomeTab: TabItem = {
      id: createTabId(WELCOME_TAB_PAGE_ID),
      pageId: WELCOME_TAB_PAGE_ID,
      type: "welcome",
      lastAccessedAt: Date.now(),
    };
    set({
      openTabs: [welcomeTab],
      activeTabId: welcomeTab.id,
      tabHistory: [welcomeTab.id],
      tabHistoryIndex: 0,
      isHistoryNavigating: false,
    });
    useFileNavHistory.getState().push(FILE_NAV_WELCOME);
    await scheduleSetActivePage(null);
  };

  const persisted = loadPersistedTabs();

  return {
    openTabs: persisted?.openTabs ?? [],
    activeTabId: persisted?.activeTabId ?? null,
    tabHistory: [],
    tabHistoryIndex: -1,
    isHistoryNavigating: false,
    recentlyClosedPageIds: persisted?.recentlyClosedPageIds ?? [],

    syncNotebookForPage: (pageId: string | null) => {
      if (!pageId) return;
      const page = usePages.getState().getPage(pageId);
      if (!page) return;
      const notebookStore = useNotebooks.getState();
      if (notebookStore.activeNotebookId !== page.workspaceId) {
        notebookStore.setActiveNotebook(page.workspaceId);
      }
    },

    syncActiveTabForPage: (pageId: string | null) => {
      if (!pageId) return;
      if (useSettings.getState().singleTabMode) {
        void replaceWithSinglePage(pageId);
        return;
      }
      const { openTabs, activeTabId } = get();
      const existingTab = findTabByPageId(openTabs, pageId);
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          get().setActiveTab(existingTab.id);
        }
        return;
      }

      get().openPermanentTab(pageId);
    },

    openTab: (pageId: string) => {
      get().openPermanentTab(pageId);
    },

    openPermanentTab: (pageId: string, options?: { pin?: boolean }) => {
      if (useSettings.getState().singleTabMode) {
        void replaceWithSinglePage(pageId);
        return;
      }
      const { openTabs, activeTabId } = get();
      const existingTab = findTabByPageId(openTabs, pageId);
      if (existingTab) {
        if (existingTab.id !== activeTabId) commitActiveEditor();
        if (existingTab.preview) {
          get().promotePreviewTab(existingTab.id);
        }
        if (options?.pin && !existingTab.pinned) {
          get().togglePinTab(existingTab.id);
        }
        get().setActiveTab(existingTab.id);
        return;
      }

      commitActiveEditor();
      const now = Date.now();
      const newTab: TabItem = {
        id: createTabId(pageId),
        pageId,
        workspaceId: getWorkspaceIdForPage(pageId),
        pinned: options?.pin ? true : undefined,
        preview: false,
        lastAccessedAt: now,
      };
      const nextOpenTabs = orderTabs([
        ...openTabs.map((tab) =>
          tab.id === activeTabId ? stampTabAccess(tab, now) : tab,
        ),
        newTab,
      ]);
      set({
        openTabs: nextOpenTabs,
        activeTabId: newTab.id,
      });
      pushTabHistory(newTab.id);
      get().syncNotebookForPage(pageId);
      void scheduleSetActivePage(pageId);
    },

    openPreviewTab: (pageId: string) => {
      if (useSettings.getState().singleTabMode) {
        void replaceWithSinglePage(pageId);
        return;
      }
      const { openTabs, activeTabId } = get();

      const existingTab = findTabByPageId(openTabs, pageId);
      if (existingTab) {
        if (existingTab.id !== activeTabId) commitActiveEditor();
        get().setActiveTab(existingTab.id);
        return;
      }

      commitActiveEditor();
      const workspaceId = getWorkspaceIdForPage(pageId);

      // VSCode 式预览标签：同时只保留一个预览标签，但它始终在最右新建，
      // 不复用某个固定位置的旧槽。打开新预览时，丢弃上一个未晋升的预览标签 + 占位的欢迎标签。
      const now = Date.now();
      const newTab: TabItem = {
        id: createTabId(pageId),
        pageId,
        workspaceId,
        preview: true,
        lastAccessedAt: now,
      };
      const survivingTabs = openTabs.filter(
        (tab) => !tab.preview && tab.type !== "welcome",
      );
      const nextOpenTabs = orderTabs([
        ...survivingTabs.map((tab) =>
          tab.id === activeTabId ? stampTabAccess(tab, now) : tab,
        ),
        newTab,
      ]);
      set({
        openTabs: nextOpenTabs,
        ...syncHistoryWithOpenTabs(nextOpenTabs),
        activeTabId: newTab.id,
      });
      pushTabHistory(newTab.id);
      get().syncNotebookForPage(pageId);
      void scheduleSetActivePage(pageId);
    },

    promotePreviewTab: (tabId?: string) => {
      const { openTabs, activeTabId } = get();
      const targetId = tabId ?? activeTabId;
      if (!targetId) return;
      const target = openTabs.find((tab) => tab.id === targetId);
      if (!target?.preview) return;
      const nextTabs = orderTabs(
        openTabs.map((tab) =>
          tab.id === targetId ? { ...tab, preview: false } : tab,
        ),
      );
      set({ openTabs: nextTabs });
    },

    openWelcomeTab: () => {
      if (useSettings.getState().singleTabMode) {
        void replaceWithSingleWelcome();
        return;
      }
      const { openTabs } = get();
      // 复用已有的欢迎 tab（同时只存在一个）
      const existingWelcome = openTabs.find((tab) => tab.type === "welcome");
      if (existingWelcome) {
        get().setActiveTab(existingWelcome.id);
        return;
      }

      commitActiveEditor();
      const now = Date.now();
      const newTab: TabItem = {
        id: createTabId(WELCOME_TAB_PAGE_ID),
        pageId: WELCOME_TAB_PAGE_ID,
        type: "welcome",
        lastAccessedAt: now,
      };
      const nextOpenTabs = applyPinnedOrder([
        ...openTabs.map((tab) =>
          tab.id === get().activeTabId ? stampTabAccess(tab, now) : tab,
        ),
        newTab,
      ]);
      set({
        openTabs: nextOpenTabs,
        activeTabId: newTab.id,
      });
      pushTabHistory(newTab.id);
      // 欢迎 tab 不关联真实页面，不调用 syncNotebookForPage / scheduleSetActivePage
    },

    findNotebookAiTab: (notebookId: string) =>
      findNotebookAiTabInList(get().openTabs, notebookId),

    openNotebookAiTab: (notebookId: string) => {
      if (!notebookId) return;
      if (useSettings.getState().singleTabMode) return;
      const { openTabs, activeTabId } = get();
      const existing = findNotebookAiTabInList(openTabs, notebookId);
      if (existing) {
        if (existing.id !== activeTabId) {
          get().setActiveTab(existing.id);
        }
        return;
      }

      commitActiveEditor();
      const now = Date.now();
      const pageId = getNotebookAiTabPageId(notebookId);
      const newTab: TabItem = {
        id: createTabId(pageId),
        pageId,
        type: "notebook-ai",
        workspaceId: notebookId,
        lastAccessedAt: now,
      };
      // 独立 AI 标签默认插到固定标签之后、普通标签最前，贴近「标签栏最左入口」。
      const pinned = openTabs.filter((tab) => tab.pinned);
      const rest = openTabs.filter((tab) => !tab.pinned);
      const nextOpenTabs = [
        ...pinned.map((tab) =>
          tab.id === activeTabId ? stampTabAccess(tab, now) : tab,
        ),
        newTab,
        ...rest.map((tab) =>
          tab.id === activeTabId ? stampTabAccess(tab, now) : tab,
        ),
      ];
      set({
        openTabs: nextOpenTabs,
        activeTabId: newTab.id,
      });
      pushTabHistory(newTab.id);
      const notebookStore = useNotebooks.getState();
      if (notebookStore.activeNotebookId !== notebookId) {
        notebookStore.setActiveNotebook(notebookId);
      }
    },

    closeNotebookAiTab: (notebookId: string) => {
      if (!notebookId) return;
      const existing = findNotebookAiTabInList(get().openTabs, notebookId);
      if (existing) {
        get().closeTab(existing.id);
      }
    },

    openInCurrentTab: (pageId: string) => {
      get().openPreviewTab(pageId);
    },

    closeTab: (tabId: string) => {
      if (useSettings.getState().singleTabMode) return;
      const { openTabs, activeTabId, recentlyClosedPageIds } = get();
      const index = openTabs.findIndex((tab) => tab.id === tabId);
      if (index === -1) return;

      const closedTab = openTabs[index];
      const closedPageId = closedTab.pageId;
      const special = isSpecialTab(closedTab);
      // 关闭前确保该页的编辑已落盘（本地文件夹页面采用自动保存队列）。
      if (tabId === activeTabId) commitActiveEditor();
      if (!special) {
        flushClosedPageSaves([closedPageId]);
        const nextClosed = [
          closedPageId,
          ...recentlyClosedPageIds.filter((id) => id !== closedPageId),
        ].slice(0, 10);
        set({ recentlyClosedPageIds: nextClosed });
      }

      const nextTabs = openTabs.filter((tab) => tab.id !== tabId);

      // 关闭最后一个标签后，自动补一个 welcome 占位标签，保持标签栏不消失（对齐浏览器/VSCode）。
      if (nextTabs.length === 0) {
        set({ openTabs: [], activeTabId: null });
        get().openWelcomeTab();
        return;
      }

      let nextActiveId: string | null = null;
      if (activeTabId === tabId && nextTabs.length > 0) {
        nextActiveId =
          nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? null;
      } else if (activeTabId !== tabId) {
        nextActiveId = resolveTabIdInHistory(activeTabId, nextTabs);
      }

      const historyState = syncHistoryWithOpenTabs(nextTabs);
      const fallbackActiveId =
        resolveTabIdInHistory(nextActiveId, nextTabs) ??
        (historyState.tabHistoryIndex >= 0
          ? historyState.tabHistory[historyState.tabHistoryIndex]
          : null);

      set({
        openTabs: nextTabs,
        activeTabId: fallbackActiveId,
        ...historyState,
      });
      const nextActiveTab = nextTabs.find((tab) => tab.id === fallbackActiveId);
      if (nextActiveTab && !isSpecialTab(nextActiveTab)) {
        get().syncNotebookForPage(nextActiveTab.pageId);
        void scheduleSetActivePage(nextActiveTab.pageId);
      } else if (nextActiveTab?.type === "notebook-ai" && nextActiveTab.workspaceId) {
        const notebookStore = useNotebooks.getState();
        if (notebookStore.activeNotebookId !== nextActiveTab.workspaceId) {
          notebookStore.setActiveNotebook(nextActiveTab.workspaceId);
        }
      }
    },

    closeOtherTabs: (tabId: string) => {
      if (useSettings.getState().singleTabMode) return;
      const { openTabs, activeTabId } = get();
      const currentTab = openTabs.find((tab) => tab.id === tabId);
      if (!currentTab) return;

      // 固定标签不被「关闭其他」关掉。
      const nextTabs = applyPinnedOrder([
        ...openTabs.filter((tab) => tab.pinned && tab.id !== tabId),
        currentTab,
      ]);

      // 计算被关闭的 tab 集合，flush 落盘并在失败时 toast 警告。
      const nextTabIds = new Set(nextTabs.map((t) => t.id));
      const closedTabs = openTabs.filter((t) => !nextTabIds.has(t.id));
      if (closedTabs.some((t) => t.id === activeTabId)) commitActiveEditor();
      const closedPageIds = closedTabs
        .filter((t) => !isSpecialTab(t))
        .map((t) => t.pageId);
      flushClosedPageSaves(closedPageIds);

      const historyState = syncHistoryWithOpenTabs(nextTabs);
      set({
        openTabs: nextTabs,
        activeTabId: currentTab.id,
        ...historyState,
      });
      get().syncNotebookForPage(currentTab.pageId);
      void scheduleSetActivePage(currentTab.pageId);
    },

    closeTabsToLeft: (tabId: string) => {
      if (useSettings.getState().singleTabMode) return;
      const { openTabs, activeTabId } = get();
      const currentIndex = openTabs.findIndex((tab) => tab.id === tabId);
      if (currentIndex <= 0) return;

      // 保留固定标签 + 当前标签及其右侧。
      const keep = openTabs.slice(currentIndex);
      const pinnedLeft = openTabs
        .slice(0, currentIndex)
        .filter((tab) => tab.pinned);
      const nextTabs = applyPinnedOrder([...pinnedLeft, ...keep]);
      const nextActiveId = nextTabs.some((tab) => tab.id === activeTabId)
        ? activeTabId
        : tabId;

      // 计算被关闭的 tab 集合，flush 落盘并在失败时 toast 警告。
      const nextTabIds = new Set(nextTabs.map((t) => t.id));
      const closedTabs = openTabs.filter((t) => !nextTabIds.has(t.id));
      if (closedTabs.some((t) => t.id === activeTabId)) commitActiveEditor();
      const closedPageIds = closedTabs
        .filter((t) => !isSpecialTab(t))
        .map((t) => t.pageId);
      flushClosedPageSaves(closedPageIds);

      const historyState = syncHistoryWithOpenTabs(nextTabs);

      set({
        openTabs: nextTabs,
        activeTabId: nextActiveId,
        ...historyState,
      });
      const nextActiveTab = nextTabs.find((tab) => tab.id === nextActiveId);
      get().syncNotebookForPage(nextActiveTab?.pageId ?? null);
      void scheduleSetActivePage(nextActiveTab?.pageId ?? null);
    },

    closeTabsToRight: (tabId: string) => {
      if (useSettings.getState().singleTabMode) return;
      const { openTabs, activeTabId } = get();
      const currentIndex = openTabs.findIndex((tab) => tab.id === tabId);
      if (currentIndex === -1 || currentIndex >= openTabs.length - 1) return;

      // 保留固定标签 + 当前标签及其左侧。
      const keep = openTabs.slice(0, currentIndex + 1);
      const pinnedRight = openTabs
        .slice(currentIndex + 1)
        .filter((tab) => tab.pinned);
      const nextTabs = applyPinnedOrder([...keep, ...pinnedRight]);
      const nextActiveId = nextTabs.some((tab) => tab.id === activeTabId)
        ? activeTabId
        : tabId;

      // 计算被关闭的 tab 集合，flush 落盘并在失败时 toast 警告。
      const nextTabIds = new Set(nextTabs.map((t) => t.id));
      const closedTabs = openTabs.filter((t) => !nextTabIds.has(t.id));
      if (closedTabs.some((t) => t.id === activeTabId)) commitActiveEditor();
      const closedPageIds = closedTabs
        .filter((t) => !isSpecialTab(t))
        .map((t) => t.pageId);
      flushClosedPageSaves(closedPageIds);

      const historyState = syncHistoryWithOpenTabs(nextTabs);

      set({
        openTabs: nextTabs,
        activeTabId: nextActiveId,
        ...historyState,
      });
      const nextActiveTab = nextTabs.find((tab) => tab.id === nextActiveId);
      get().syncNotebookForPage(nextActiveTab?.pageId ?? null);
      void scheduleSetActivePage(nextActiveTab?.pageId ?? null);
    },

    setActiveTab: (tabId: string) => {
      const { openTabs, activeTabId } = get();
      const tab = openTabs.find((item) => item.id === tabId);
      if (!tab) return;
      if (useSettings.getState().singleTabMode) {
        if (tab.type === "welcome") {
          void replaceWithSingleWelcome();
        } else if (!isSpecialTab(tab)) {
          void replaceWithSinglePage(tab.pageId);
        }
        return;
      }
      if (tab.id !== activeTabId) commitActiveEditor();

      const now = Date.now();
      set({
        openTabs: openTabs.map((item) =>
          item.id === tab.id || item.id === activeTabId
            ? stampTabAccess(item, now)
            : item,
        ),
        activeTabId: tab.id,
      });
      pushTabHistory(tab.id);
      // 欢迎 / AI 标签不关联真实页面，不同步活动页。
      if (tab.type === "welcome") return;
      if (tab.type === "notebook-ai") {
        const notebookId = tab.workspaceId;
        if (notebookId) {
          const notebookStore = useNotebooks.getState();
          if (notebookStore.activeNotebookId !== notebookId) {
            notebookStore.setActiveNotebook(notebookId);
          }
        }
        return;
      }
      get().syncNotebookForPage(tab.pageId);
      void scheduleSetActivePage(tab.pageId);
    },

    goBackTabHistory: () => {
      set({ isHistoryNavigating: true });
      try {
        stepFileNavHistory("back");
      } finally {
        set({ isHistoryNavigating: false });
      }
    },

    goForwardTabHistory: () => {
      set({ isHistoryNavigating: true });
      try {
        stepFileNavHistory("forward");
      } finally {
        set({ isHistoryNavigating: false });
      }
    },

    canGoBackTabHistory: () => useFileNavHistory.getState().canBack(),

    canGoForwardTabHistory: () => useFileNavHistory.getState().canForward(),

    reorderTabs: (from: number, to: number) => {
      if (useSettings.getState().singleTabMode) return;
      const { openTabs } = get();
      if (from < 0 || from >= openTabs.length) return;
      if (to < 0 || to >= openTabs.length) return;

      const nextTabs = [...openTabs];
      const [moved] = nextTabs.splice(from, 1);
      nextTabs.splice(to, 0, moved);
      // 固定标签恒在前，拖拽后重新归位以维持不变式。
      set({ openTabs: applyPinnedOrder(nextTabs) });
    },

    togglePinTab: (tabId: string) => {
      if (useSettings.getState().singleTabMode) return;
      const { openTabs } = get();
      const exists = openTabs.some((tab) => tab.id === tabId);
      if (!exists) return;
      const nextTabs = orderTabs(
        openTabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          const pinned = !tab.pinned;
          return {
            ...tab,
            pinned,
            preview: pinned ? false : tab.preview,
          };
        }),
      );
      set({ openTabs: nextTabs });
    },

    reconcileTabs: () => {
      const { openTabs, activeTabId } = get();
      const pagesState = usePages.getState();
      const notebooks = useNotebooks.getState().notebooks;
      const loadedWorkspaceIds = new Set<string>();
      for (const page of Object.values(pagesState.pages)) {
        loadedWorkspaceIds.add(page.workspaceId);
      }

      let nextTabs = openTabs.filter((tab) => {
        // 欢迎 tab 不关联真实页面，始终保留。
        if (tab.type === "welcome") return true;
        // AI 标签按笔记本存活：笔记本还在就保留。
        if (tab.type === "notebook-ai") {
          const notebookId = tab.workspaceId;
          return Boolean(notebookId && notebooks[notebookId]);
        }
        if (pagesState.getPage(tab.pageId)) return true;
        // 页面不在内存：若它属于尚未加载的本地文件夹笔记本，保留（稍后会加载）。
        const ws = tab.workspaceId;
        if (
          ws &&
          notebooks[ws]?.source === "local-folder" &&
          !loadedWorkspaceIds.has(ws)
        ) {
          return true;
        }
        return false;
      });

      if (useSettings.getState().singleTabMode && nextTabs.length > 1) {
        const active = nextTabs.find((tab) => tab.id === activeTabId);
        nextTabs = active ? [active] : [nextTabs[nextTabs.length - 1]];
      }

      if (nextTabs.length === openTabs.length) return;
      const nextActiveValid = nextTabs.some((tab) => tab.id === activeTabId);
      const historyState = syncHistoryWithOpenTabs(nextTabs);
      set({
        openTabs: nextTabs,
        activeTabId: nextActiveValid
          ? activeTabId
          : (nextTabs[nextTabs.length - 1]?.id ?? null),
        ...historyState,
      });
    },

    closeExpiredTabs: (now = Date.now()) => {
      if (useSettings.getState().singleTabMode) return;
      const { privacy } = useSettings.getState();
      if (!privacy.autoCloseInactiveTabs) return;

      const maxIdleMs =
        normalizeAutoCloseInactiveTabsHours(
          privacy.autoCloseInactiveTabsHours,
        ) *
        60 *
        60 *
        1000;
      const { openTabs, activeTabId } = get();
      const expiredTabs = openTabs.filter((tab) => {
        if (isSpecialTab(tab)) return false;
        if (tab.pinned) return false;
        if (tab.id === activeTabId) return false;
        const lastAccessedAt = tab.lastAccessedAt ?? now;
        return now - lastAccessedAt >= maxIdleMs;
      });

      expiredTabs.forEach((tab) => {
        get().closeTab(tab.id);
      });
    },

    clearAllTabs: () => {
      useFileNavHistory.getState().reset();
      set({
        openTabs: [],
        activeTabId: null,
        tabHistory: [],
        tabHistoryIndex: -1,
        isHistoryNavigating: false,
        recentlyClosedPageIds: [],
      });
    },

    collapseToActiveTab: () => {
      const { openTabs, activeTabId } = get();
      if (!activeTabId) return;
      let activeTab = openTabs.find((tab) => tab.id === activeTabId);
      if (!activeTab) return;

      if (activeTab.type === "notebook-ai") {
        const activePageId = usePages.getState().activePageId;
        const pageTab = activePageId
          ? findTabByPageId(openTabs, activePageId)
          : undefined;
        if (pageTab) {
          activeTab = pageTab;
        } else if (activePageId && usePages.getState().getPage(activePageId)) {
          activeTab = {
            id: createTabId(activePageId),
            pageId: activePageId,
            workspaceId: getWorkspaceIdForPage(activePageId),
            lastAccessedAt: Date.now(),
          };
        } else {
          const welcomeTab: TabItem = {
            id: createTabId(WELCOME_TAB_PAGE_ID),
            pageId: WELCOME_TAB_PAGE_ID,
            type: "welcome",
            lastAccessedAt: Date.now(),
          };
          activeTab = welcomeTab;
        }
      }

      const closedPageIds = openTabs
        .filter((tab) => tab.id !== activeTab.id && !isSpecialTab(tab))
        .map((tab) => tab.pageId)
        .filter(Boolean);

      commitActiveEditor();
      flushClosedPageSaves(closedPageIds);

      const nextTabs = [activeTab];
      const historyState = syncHistoryWithOpenTabs(nextTabs);
      set({
        openTabs: nextTabs,
        activeTabId: activeTab.id,
        ...historyState,
      });
      if (isSpecialTab(activeTab)) {
        void scheduleSetActivePage(null);
      } else {
        get().syncNotebookForPage(activeTab.pageId);
        void scheduleSetActivePage(activeTab.pageId);
      }
    },

    reopenLastClosedTab: () => {
      if (useSettings.getState().singleTabMode) return;
      const { recentlyClosedPageIds, openTabs } = get();
      const openPageIds = new Set(openTabs.map((tab) => tab.pageId));
      const candidate = recentlyClosedPageIds.find((id) => {
        if (openPageIds.has(id)) return false;
        const page = usePages.getState().getPage(id);
        return page && !page.trashedAt;
      });
      if (!candidate) return;
      set({
        recentlyClosedPageIds: recentlyClosedPageIds.filter(
          (id) => id !== candidate,
        ),
      });
      get().openTab(candidate);
    },

    removeDeletedPage: (pageId: string) => {
      const { openTabs, activeTabId } = get();
      const deletedIndex = openTabs.findIndex((tab) => tab.pageId === pageId);
      const deletedPage = usePages.getState().getPage(pageId);
      const preferredPageId = usePages.getState().activePageId;
      const nextTabs = openTabs.filter((tab) => tab.pageId !== pageId);
      if (nextTabs.length === openTabs.length) return;

      let finalTabs = nextTabs;
      let nextActiveId = activeTabId;

      if (!nextActiveId || !nextTabs.some((tab) => tab.id === nextActiveId)) {
        if (preferredPageId) {
          const existingPreferredTab = nextTabs.find(
            (tab) => tab.pageId === preferredPageId,
          );

          if (existingPreferredTab) {
            nextActiveId = existingPreferredTab.id;
          } else {
            const insertionIndex =
              deletedIndex === -1
                ? nextTabs.length
                : Math.min(deletedIndex, nextTabs.length);
            const replacementTab: TabItem = {
              id: createTabId(preferredPageId),
              pageId: preferredPageId,
              workspaceId: getWorkspaceIdForPage(preferredPageId),
              lastAccessedAt: Date.now(),
            };
            finalTabs = [
              ...nextTabs.slice(0, insertionIndex),
              replacementTab,
              ...nextTabs.slice(insertionIndex),
            ];
            nextActiveId = replacementTab.id;
          }
        } else {
          nextActiveId =
            nextTabs[Math.min(deletedIndex, nextTabs.length - 1)]?.id ?? null;
        }
      }

      if (useSettings.getState().singleTabMode && finalTabs.length > 1) {
        const preferred = finalTabs.find((tab) => tab.id === nextActiveId);
        const onlyTab = preferred ?? finalTabs[finalTabs.length - 1];
        finalTabs = onlyTab ? [onlyTab] : [];
        nextActiveId = onlyTab?.id ?? null;
      }

      const historyState = syncHistoryWithOpenTabs(finalTabs);
      const fallbackActiveId =
        resolveTabIdInHistory(nextActiveId, finalTabs) ??
        (historyState.tabHistoryIndex >= 0
          ? historyState.tabHistory[historyState.tabHistoryIndex]
          : null);

      set({
        openTabs: finalTabs,
        activeTabId: fallbackActiveId,
        ...historyState,
      });

      const nextActiveTab = finalTabs.find(
        (tab) => tab.id === fallbackActiveId,
      );
      if (deletedPage?.trashedAt) {
        if (nextActiveTab?.pageId && nextActiveTab.pageId !== preferredPageId) {
          get().syncNotebookForPage(nextActiveTab.pageId);
          void scheduleSetActivePage(nextActiveTab.pageId);
        }
        return;
      }

      get().syncNotebookForPage(nextActiveTab?.pageId ?? null);
      void scheduleSetActivePage(nextActiveTab?.pageId ?? null);
    },
  };
});

// 标签状态变化时持久化（跨会话恢复上次打开的标签）。
if (typeof window !== "undefined") {
  useTabs.subscribe((state) => persistTabs(state));
}
