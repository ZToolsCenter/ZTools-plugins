import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsGeneral } from "./SettingsGeneral";
import { SettingsShortcuts } from "./settings/SettingsShortcuts";
import { SettingsLocalFolder } from "./SettingsLocalFolder";
import {
  LOCAL_FOLDER_EDITOR_CANDIDATES,
  LOCAL_FOLDER_FILE_MANAGER_CANDIDATES,
  LOCAL_FOLDER_TERMINAL_CANDIDATES,
} from "@/lib/local-folder-open-apps";
import { shell } from "@/lib/utools/shell";
import { SettingsDataPanel } from "./settings/SettingsDataPanel";
import { SettingsAI } from "./SettingsAI";
import { SettingsScaffold } from "./settings/SettingsScaffold";
import type { SettingsTab, SettingsTabConfig } from "./settings/types";
import { useShallow } from "zustand/react/shallow";
import {
  useNotebooks,
  DEFAULT_NOTEBOOK,
  sortNotebooksByOrder,
} from "@/stores/useNotebooks";
import { clearLocalPageMetadataCache, usePages } from "@/stores/usePages";
import { useSettings } from "@/stores/useSettings";
import { useTabs } from "@/stores/useTabs";
import { useNotebookAiChats } from "@/stores/useNotebookAiChats";
import {
  QUICKNOTE_DEFAULT_HEIGHT,
  QUICKNOTE_DEFAULT_WIDTH,
  createEmptyQuickNoteDrafts,
  useQuickNote,
} from "@/stores/useQuickNote";
import { createEmptySlotStacks } from "@/lib/quicknote/undoHistory";
import { useSidebarView } from "@/stores/useSidebarView";
import { AI_INITIAL_STATE } from "@/stores/settings/slices/aiSlice";
import { APPEARANCE_INITIAL_STATE } from "@/stores/settings/slices/appearanceSlice";
import { LOCAL_FOLDER_INITIAL_STATE } from "@/stores/settings/slices/localFolderSlice";
import { SEARCH_PROVIDERS_INITIAL_STATE } from "@/stores/settings/slices/searchProvidersSlice";
import { SHORTCUTS_INITIAL_STATE } from "@/stores/settings/slices/shortcutsSlice";
import { UTOOLS_INITIAL_STATE } from "@/stores/settings/slices/utoolsSlice";
import { WEBDAV_INITIAL_STATE } from "@/stores/settings/slices/webdavSlice";
import { closeNotebookAiIfFullscreen } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";
import {
  clearPersistedInternalPages,
  clearPersistedPages,
} from "@/lib/storage/pageRepository";
import { clearLegacyStorage } from "@/lib/storage/migrateLegacyStorage";
import { historyRepository } from "@/lib/history/repository";
import { clearAllLocalMdSnapshots } from "@/lib/local-md-snapshot";
import { removeLocalPageIdMap } from "@/lib/local-page-idmap";
import { usePersistentDismissState } from "@/hooks/usePersistentDismissState";
import { UToolsAdapter } from "@/lib/utools";
import { wnd } from "@/lib/utools/window";
import type { ExportOptions } from "@/lib/export";
import { uToolsStorage as dataStorage } from "@/lib/storage";
import * as LucideIcons from "lucide-react";
import { ExternalLink } from "lucide-react";
import { toast } from "@/components/ui/sonner";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SETTINGS_TABS: SettingsTabConfig[] = [
  { id: "general", label: "通用设置", icon: LucideIcons.Settings },
  { id: "shortcuts", label: "快捷键", icon: LucideIcons.Keyboard },
  { id: "local-folder", label: "本地文件夹", icon: LucideIcons.FolderOpen },
  { id: "appearance", label: "外观主题", icon: LucideIcons.Laptop },
  { id: "ai", label: "AI 助手", icon: LucideIcons.Sparkles },
  { id: "data", label: "数据管理", icon: LucideIcons.Database },
];

// 设置侧栏鹅应用：图标分别取自各项目 plugin.json 指向的 logo.png
const GOOSE_APPS = [
  {
    id: "goose-quicknote",
    name: "鹅的小窗",
    icon: "./apps/goose-quicknote.png",
    storeQuery: "鹅的小窗",
    url: "https://www.u-tools.cn/plugins/detail/%E9%B9%85%E7%9A%84%E5%B0%8F%E7%AA%97/",
  },
  {
    id: "goose-marks",
    name: "鹅的书签",
    icon: "./apps/goose-marks.png",
    storeQuery: "鹅的书签",
    url: "https://www.u-tools.cn/plugins/detail/%E9%B9%85%E7%9A%84%E4%B9%A6%E7%AD%BE/",
  },
  {
    id: "goose-monitor",
    name: "鹅的监控",
    icon: "./apps/goose-monitor.png",
    storeQuery: "鹅的监控",
    url: "https://www.u-tools.cn/plugins/detail/%E9%B9%85%E7%9A%84%E7%9B%91%E6%8E%A7/",
  },
  {
    id: "goose-2fa",
    name: "鹅的二次验证",
    icon: "./apps/goose-2fa.png",
    storeQuery: "鹅的二次验证（2FA）",
    url: "https://www.u-tools.cn/plugins/detail/%E9%B9%85%E7%9A%84%E4%BA%8C%E6%AC%A1%E9%AA%8C%E8%AF%81%EF%BC%882FA%EF%BC%89/",
  },
];

const FEEDBACK_URL = "https://wj.qq.com/s2/25958121/2d2e/";
const SETTINGS_APPS_BANNER_ID = "settings:recommended-apps-banner";

const recordPreOverwriteHistory = async (id: string | undefined) => {
  if (!id) return;
  const existingPage = usePages.getState().pages[id];
  if (existingPage && existingPage.content) {
    const oldContent = existingPage.content;
    const oldWorkspaceId = existingPage.workspaceId;
    try {
      const { recordHistorySnapshot } = await import("@/lib/history/snapshot");
      await recordHistorySnapshot({
        pageId: id,
        workspaceId: oldWorkspaceId,
        content: oldContent,
        trigger: "manual",
        isMilestone: true,
        label: "备份覆盖前本地版本",
      });
    } catch (err) {
      console.error("[history] Failed to save pre-overwrite history", err);
    }
  }
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  useEffect(() => {
    document.body.toggleAttribute("data-goose-settings-open", open);

    return () => {
      document.body.removeAttribute("data-goose-settings-open");
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const prewarmLocalFolderOpenApps = () => {
      if (cancelled) return;
      void Promise.all([
        shell.listAvailableOpenApps(LOCAL_FOLDER_FILE_MANAGER_CANDIDATES),
        shell.listAvailableOpenApps(LOCAL_FOLDER_EDITOR_CANDIDATES),
        shell.listAvailableOpenApps(LOCAL_FOLDER_TERMINAL_CANDIDATES),
      ]);
    };

    const schedule =
      typeof window !== "undefined" &&
      typeof window.requestIdleCallback === "function"
        ? () => {
            idleId = window.requestIdleCallback(() => {
              prewarmLocalFolderOpenApps();
            });
          }
        : () => {
            timeoutId = setTimeout(prewarmLocalFolderOpenApps, 0);
          };

    schedule();

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [open]);

  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    codeStyle,
    setCodeStyle,
    tableEvenColumnWidth,
    setTableEvenColumnWidth,
    searchProviders,
    toggleSearchProvider,
    reorderSearchProviders,
    addCustomSearchProvider,
    updateCustomSearchProvider,
    removeCustomSearchProvider,
    utools,
    ai,
    setOpenSearchInUtools,
    setUseInternalImageViewer,
    setAIEnabled,
    setAIReadGlobalPrompt,
    setAIReadLocalSkills,
    setAISelectedModelId,
    saveAICustomConfig,
    setUToolsWindowHeight,
    privacy,
    setAutoOpenLastNote,
    singleTabMode,
    setSingleTabMode,
    setAutoCloseInactiveTabs,
    setAutoCloseInactiveTabsHours,
    showRecentInSearch,
    setShowRecentInSearch,
    closeTabShortcut,
    setCloseTabShortcut,
    searchPanelCloseShortcut,
    setSearchPanelCloseShortcut,
    appShortcuts,
    setAppShortcut,
    resetAppShortcuts,
    customFonts,
    setCustomLabel,
    setCustomFont,
    uiFontSize,
    setUIFontSize,
    hideExpandArrows,
    setHideExpandArrows,
    customActions,
    addCustomAction,
    updateCustomAction,
    removeCustomAction,
    notebookDropdownHoverExpand,
    setNotebookDropdownHoverExpand,
    localFolderFileManager,
    setLocalFolderFileManager,
    localFolderExternalEditor,
    setLocalFolderExternalEditor,
    localFolderTerminal,
    setLocalFolderTerminal,
    localFolderHiddenFolders,
    setLocalFolderHiddenFolders,
  } = useSettings(
    useShallow((s) => ({
      theme: s.theme,
      setTheme: s.setTheme,
      accentColor: s.accentColor,
      setAccentColor: s.setAccentColor,
      codeStyle: s.codeStyle,
      setCodeStyle: s.setCodeStyle,
      tableEvenColumnWidth: s.tableEvenColumnWidth,
      setTableEvenColumnWidth: s.setTableEvenColumnWidth,
      searchProviders: s.searchProviders,
      toggleSearchProvider: s.toggleSearchProvider,
      reorderSearchProviders: s.reorderSearchProviders,
      addCustomSearchProvider: s.addCustomSearchProvider,
      updateCustomSearchProvider: s.updateCustomSearchProvider,
      removeCustomSearchProvider: s.removeCustomSearchProvider,
      utools: s.utools,
      ai: s.ai,
      setOpenSearchInUtools: s.setOpenSearchInUtools,
      setUseInternalImageViewer: s.setUseInternalImageViewer,
      setAIEnabled: s.setAIEnabled,
      setAIReadGlobalPrompt: s.setAIReadGlobalPrompt,
      setAIReadLocalSkills: s.setAIReadLocalSkills,
      setAISelectedModelId: s.setAISelectedModelId,
      saveAICustomConfig: s.saveAICustomConfig,
      setUToolsWindowHeight: s.setUToolsWindowHeight,
      privacy: s.privacy,
      setAutoOpenLastNote: s.setAutoOpenLastNote,
      singleTabMode: s.singleTabMode,
      setSingleTabMode: s.setSingleTabMode,
      setAutoCloseInactiveTabs: s.setAutoCloseInactiveTabs,
      setAutoCloseInactiveTabsHours: s.setAutoCloseInactiveTabsHours,
      showRecentInSearch: s.showRecentInSearch,
      setShowRecentInSearch: s.setShowRecentInSearch,
      closeTabShortcut: s.closeTabShortcut,
      setCloseTabShortcut: s.setCloseTabShortcut,
      searchPanelCloseShortcut: s.searchPanelCloseShortcut,
      setSearchPanelCloseShortcut: s.setSearchPanelCloseShortcut,
      appShortcuts: s.appShortcuts,
      setAppShortcut: s.setAppShortcut,
      resetAppShortcuts: s.resetAppShortcuts,
      customFonts: s.customFonts,
      setCustomLabel: s.setCustomLabel,
      setCustomFont: s.setCustomFont,
      uiFontSize: s.uiFontSize,
      setUIFontSize: s.setUIFontSize,
      hideExpandArrows: s.hideExpandArrows,
      setHideExpandArrows: s.setHideExpandArrows,
      customActions: s.customActions,
      addCustomAction: s.addCustomAction,
      updateCustomAction: s.updateCustomAction,
      removeCustomAction: s.removeCustomAction,
      notebookDropdownHoverExpand: s.notebookDropdownHoverExpand,
      setNotebookDropdownHoverExpand: s.setNotebookDropdownHoverExpand,
      localFolderFileManager: s.localFolderFileManager,
      setLocalFolderFileManager: s.setLocalFolderFileManager,
      localFolderExternalEditor: s.localFolderExternalEditor,
      setLocalFolderExternalEditor: s.setLocalFolderExternalEditor,
      localFolderTerminal: s.localFolderTerminal,
      setLocalFolderTerminal: s.setLocalFolderTerminal,
      localFolderHiddenFolders: s.localFolderHiddenFolders,
      setLocalFolderHiddenFolders: s.setLocalFolderHiddenFolders,
    })),
  );
  const { notebooks } = useNotebooks(
    useShallow((s) => ({ notebooks: s.notebooks })),
  );
  const { pages } = usePages(useShallow((s) => ({ pages: s.pages })));
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: SettingsTab }>;
      if (customEvent.detail?.tab) {
        setActiveTab(customEvent.detail.tab);
      }
    };

    window.addEventListener("goose-note:settings-tab-change", handleTabChange);
    return () => {
      window.removeEventListener(
        "goose-note:settings-tab-change",
        handleTabChange,
      );
    };
  }, []);

  // 数据管理状态
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportOptions["format"]>("md");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetInput, setResetInput] = useState("");
  const [resetting, setResetting] = useState(false);
  const {
    visible: appsBannerVisible,
    dismiss: dismissAppsBanner,
    reset: resetAppsBanner,
  } = usePersistentDismissState(SETTINGS_APPS_BANNER_ID);

  const notebookList = sortNotebooksByOrder(notebooks).filter(
    (n) => n.source !== "local-folder",
  );
  const { createNotebook } = useNotebooks(
    useShallow((s) => ({ createNotebook: s.createNotebook })),
  );
  const resetPhrase = "我已知晓风险";
  const canReset = resetInput.trim() === resetPhrase;

  const toggleNotebook = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const selectAll = () => {
    if (selectedIds.length === notebookList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(notebookList.map((n) => n.id));
    }
  };

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    setExporting(true);
    try {
      const { exportNotebooks } = await import("@/lib/export");
      await exportNotebooks(
        {
          format,
          notebookIds: selectedIds,
        },
        notebooks,
        Object.values(pages),
      );
      toast.success("导出成功");
    } catch (err) {
      console.error("Export failed", err);
      toast.error("导出失败", {
        description: err instanceof Error ? err.message : "请稍后重试。",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.mdzip";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        let firstWorkspaceId: string | null = null;
        let firstPageId: string | null = null;
        let notebookCount = 0;
        let pageCount = 0;

        const { importNotebooksFromZip } = await import("@/lib/export");
        await importNotebooksFromZip(
          file,
          (name, icon, id) => {
            notebookCount++;
            const newId = createNotebook(name, icon || "BookOpen", true, id);
            if (!firstWorkspaceId) firstWorkspaceId = newId;
            return newId;
          },
          async (data, workspaceId, parentId, id) => {
            pageCount++;
            await recordPreOverwriteHistory(id);
            const pageId = usePages.getState().createPageRecord({
              ...data,
              id,
              workspaceId,
              parentId,
            });
            if (!firstPageId) firstPageId = pageId;
            return pageId;
          },
        );

        const { setActiveNotebook } = useNotebooks.getState();
        const { setActivePage } = usePages.getState();

        if (firstWorkspaceId) setActiveNotebook(firstWorkspaceId);
        if (firstPageId) {
          closeNotebookAiIfFullscreen();
          setActivePage(firstPageId);
        }

        toast.success("导入成功", {
          description: `已恢复 ${notebookCount} 个记事本，共 ${pageCount} 个页面`,
        });
      } catch (err) {
        console.error("Import failed", err);
        toast.error("导入失败", {
          description: "请确保文件是有效的导出 ZIP 包",
        });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  useEffect(() => {
    if (!resetDialogOpen) {
      setResetInput("");
    }
  }, [resetDialogOpen]);

  const clearCurrentContent = async (options?: {
    preserveLocalFolders?: boolean;
    preserveWorkspaceState?: boolean;
  }) => {
    const preserveLocalFolders = options?.preserveLocalFolders ?? false;
    const preserveWorkspaceState = options?.preserveWorkspaceState ?? false;
    const currentNotebooks = useNotebooks.getState().notebooks;
    const localNotebooks = preserveLocalFolders
      ? Object.fromEntries(
          Object.entries(currentNotebooks).filter(
            ([, notebook]) => notebook.source === "local-folder",
          ),
        )
      : {};
    const localNotebookIds = new Set(Object.keys(localNotebooks));
    const allLocalNotebookIds = Object.values(currentNotebooks)
      .filter((notebook) => notebook.source === "local-folder")
      .map((notebook) => notebook.id);
    const localPages = preserveLocalFolders
      ? Object.fromEntries(
          Object.entries(usePages.getState().pages).filter(([, page]) =>
            localNotebookIds.has(page.workspaceId),
          ),
        )
      : {};

    // 本地文件夹内容属于用户磁盘数据，先落盘但绝不删除磁盘文件或 .goose/history。
    await usePages.getState().flushPendingLocalSaves();
    dataStorage.removeItem("goose-note-notebooks");
    historyRepository.clearAll();
    if (preserveLocalFolders) {
      clearPersistedInternalPages();
    } else {
      clearPersistedPages();
      allLocalNotebookIds.forEach(removeLocalPageIdMap);
      clearAllLocalMdSnapshots();
    }
    clearLegacyStorage();
    clearLocalPageMetadataCache();
    if (!preserveWorkspaceState) {
      useNotebookAiChats.getState().clearAllChats();
      useTabs.getState().clearAllTabs();
      window.localStorage.removeItem("goose-note-ai-panel-open");
    }
    useNotebooks.setState({
      notebooks: localNotebooks,
      activeNotebookId: null,
      lastActivePageByNotebook: {},
      localFolderLoadStates: {},
    });
    usePages.setState({
      pages: localPages,
      activePageId: null,
      pendingNavigatePageId: null,
      expandPageId: null,
      searchHighlightQuery: null,
      searchHighlightPageId: null,
      searchHighlightNonce: 0,
      handledSearchHighlightNonce: 0,
      hydrated: true,
      lastSavedAt: null,
      onboardingCompleted: false,
      dirtyLocalPageIds: {},
    });
  };

  const createDefaultNotebook = () => {
    const now = Date.now();
    const localNotebooks = Object.fromEntries(
      Object.entries(useNotebooks.getState().notebooks).filter(
        ([, notebook]) => notebook.source === "local-folder",
      ),
    );
    useNotebooks.setState({
      notebooks: {
        ...localNotebooks,
        [DEFAULT_NOTEBOOK]: {
          id: DEFAULT_NOTEBOOK,
          name: "Note",
          icon: "BookOpen",
          createdAt: now,
          updatedAt: now,
        },
      },
      activeNotebookId: DEFAULT_NOTEBOOK,
      lastActivePageByNotebook: {},
      localFolderLoadStates: {},
    });
  };

  const importBackupIntoEmptyState = async (blob: Blob) => {
    let firstWorkspaceId: string | null = null;
    let firstPageId: string | null = null;
    const { importNotebooksFromZip } = await import("@/lib/export");
    await importNotebooksFromZip(
      blob,
      (name, icon, id) => {
        const newId = createNotebook(name, icon || "BookOpen", true, id);
        if (!firstWorkspaceId) firstWorkspaceId = newId;
        return newId;
      },
      (data, workspaceId, parentId, id) => {
        const pageId = usePages.getState().createPageRecord({
          ...data,
          id,
          workspaceId,
          parentId,
        });
        if (!firstPageId && workspaceId === firstWorkspaceId)
          firstPageId = pageId;
        return pageId;
      },
    );
    if (!firstWorkspaceId) {
      throw new Error("备份中没有可恢复的记事本");
    }
    useNotebooks.setState({ activeNotebookId: firstWorkspaceId });
    closeNotebookAiIfFullscreen();
    usePages.setState({ activePageId: firstPageId });
  };

  const createRollbackBackup = async (): Promise<Blob | null> => {
    const notebookState = useNotebooks.getState().notebooks;
    const notebookIds = Object.values(notebookState)
      .filter((notebook) => notebook.source !== "local-folder")
      .map((notebook) => notebook.id);
    if (notebookIds.length === 0) return null;
    const { generateExportZip } = await import("@/lib/export");
    return generateExportZip(
      { format: "md", notebookIds },
      notebookState,
      Object.values(usePages.getState().pages),
    );
  };

  const restoreBackupWithRollback = async (zipBlob: Blob) => {
    const { inspectNotebookImportZip } = await import("@/lib/export");
    await inspectNotebookImportZip(zipBlob);
    const rollbackBlob = await createRollbackBackup();

    await clearCurrentContent({
      preserveLocalFolders: true,
      preserveWorkspaceState: true,
    });
    try {
      await importBackupIntoEmptyState(zipBlob);
      useTabs.getState().reconcileTabs();
    } catch (error) {
      console.error("[restore] 导入失败，开始回滚", error);
      try {
        await clearCurrentContent({
          preserveLocalFolders: true,
          preserveWorkspaceState: true,
        });
        if (rollbackBlob) {
          await importBackupIntoEmptyState(rollbackBlob);
        } else {
          createDefaultNotebook();
        }
        useTabs.getState().reconcileTabs();
      } catch (rollbackError) {
        console.error("[restore] 回滚失败", rollbackError);
        throw new Error("恢复失败，且自动回滚未完成，请从本地导出备份恢复", {
          cause: rollbackError,
        });
      }
      throw new Error("恢复失败，已自动恢复覆盖前的数据", { cause: error });
    }
    toast.success("恢复并同步成功");
  };

  const resetSettingsToDefaults = async () => {
    await useSettings.persist.clearStorage();
    useSettings.setState({
      ...structuredClone(AI_INITIAL_STATE),
      ...structuredClone(APPEARANCE_INITIAL_STATE),
      ...structuredClone(LOCAL_FOLDER_INITIAL_STATE),
      ...structuredClone(SEARCH_PROVIDERS_INITIAL_STATE),
      ...structuredClone(SHORTCUTS_INITIAL_STATE),
      ...structuredClone(UTOOLS_INITIAL_STATE),
      ...structuredClone(WEBDAV_INITIAL_STATE),
      _hasHydrated: true,
    });
    useSettings.getState().setTheme("system");
    useSettings.getState().setAccentColor(APPEARANCE_INITIAL_STATE.accentColor);
    useSettings.getState().setCodeStyle("default");
    resetAppsBanner();
  };

  const resetAuxiliaryAppState = () => {
    useQuickNote.persist.clearStorage();
    useQuickNote.setState({
      activeSlot: 1,
      drafts: createEmptyQuickNoteDrafts(),
      undoStacks: createEmptySlotStacks(),
      redoStacks: createEmptySlotStacks(),
      pinned: true,
      editorZoom: 1,
      windowWidth: QUICKNOTE_DEFAULT_WIDTH,
      windowHeight: QUICKNOTE_DEFAULT_HEIGHT,
      windowX: undefined,
      windowY: undefined,
    });

    useSidebarView.persist.clearStorage();
    useSidebarView.setState({
      expandedByNotebook: {},
      focusedByNotebook: {},
      selectedByNotebook: {},
      favoritesCollapsed: false,
      sidebarCollapsed: false,
    });

    [
      "goose-recent-excludes",
      "goose-note-ai-panel-open",
      "goose-note-ai-panel-width",
      "sidebar-width",
    ].forEach((key) => window.localStorage.removeItem(key));
  };

  const handleReset = async (zipBlob?: Blob) => {
    if (zipBlob) {
      await restoreBackupWithRollback(zipBlob);
      return;
    }
    if (!canReset) return;
    await clearCurrentContent();
    createDefaultNotebook();
    await resetSettingsToDefaults();
    resetAuxiliaryAppState();
    setResetDialogOpen(false);
    onOpenChange(false);
    toast.success("重置成功");
  };

  const handleManualReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await handleReset();
    } catch (error) {
      console.error("Reset failed", error);
      toast.error("重置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setResetting(false);
    }
  };

  const handleCloseAppsBanner = () => {
    dismissAppsBanner();
  };

  const handleOpenApp = (app: (typeof GOOSE_APPS)[number]) => {
    // 官方：redirect 未找到指令时会跳转插件应用市场并搜索该名称
    // https://www.u-tools.cn/docs/developer/api-reference/utools/window.html
    if (wnd.redirect(["插件应用市场", "插件应用市场搜一搜"], app.storeQuery)) return;
    if (wnd.redirect("插件应用市场搜一搜", app.storeQuery)) return;
    if (wnd.redirect(app.storeQuery)) return;
    UToolsAdapter.openUrl(app.url, false);
  };

  return (
    <>
      <DialogShell
        open={open}
        onOpenChange={onOpenChange}
        layout="fullscreen"
        overlayClassName="bg-transparent backdrop-blur-0"
        contentClassName="border-0 bg-[hsl(var(--goose-shell-bg))]"
        bodyClassName="h-full animate-in fade-in duration-200"
      >
        <SettingsScaffold
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabs={SETTINGS_TABS}
          feedbackBanner={null}
          appsBanner={
            appsBannerVisible ? (
              <div className="relative rounded-[10px] bg-[hsl(var(--goose-selected-bg)/0.62)] p-3">
                <button
                  type="button"
                  onClick={handleCloseAppsBanner}
                  className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                  aria-label="关闭鹅的全家桶"
                >
                  <LucideIcons.X className="h-3 w-3" />
                </button>
                <p className="mb-2 pr-4 text-xs font-medium text-muted-foreground">
                  鹅的全家桶
                </p>
                <div className="space-y-1">
                  {GOOSE_APPS.map((app) => (
                    <Button
                      key={app.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenApp(app)}
                      className="h-auto w-full justify-start gap-2 rounded-[10px] px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                    >
                      <img
                        src={app.icon}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-[4px] object-cover"
                      />
                      <span className="flex-1 truncate">{app.name}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                    </Button>
                  ))}
                </div>
              </div>
            ) : null
          }
        >
          {activeTab === "general" && (
            <div className="space-y-4">
              <SettingsGeneral
                searchProviders={searchProviders}
                toggleSearchProvider={toggleSearchProvider}
                reorderSearchProviders={reorderSearchProviders}
                addCustomSearchProvider={addCustomSearchProvider}
                updateCustomSearchProvider={updateCustomSearchProvider}
                removeCustomSearchProvider={removeCustomSearchProvider}
                openSearchInUtools={utools.openSearchInUtools}
                setOpenSearchInUtools={setOpenSearchInUtools}
                useInternalImageViewer={utools.useInternalImageViewer}
                setUseInternalImageViewer={setUseInternalImageViewer}
                windowHeight={utools.windowHeight ?? 600}
                setWindowHeight={setUToolsWindowHeight}
                autoOpenLastNote={privacy.autoOpenLastNote}
                setAutoOpenLastNote={setAutoOpenLastNote}
                singleTabMode={singleTabMode}
                setSingleTabMode={(enabled) => {
                  setSingleTabMode(enabled);
                  if (enabled) {
                    useTabs.getState().collapseToActiveTab();
                    toast.success("已开启极简工作区");
                  }
                }}
                autoCloseInactiveTabs={privacy.autoCloseInactiveTabs}
                setAutoCloseInactiveTabs={setAutoCloseInactiveTabs}
                autoCloseInactiveTabsHours={privacy.autoCloseInactiveTabsHours}
                setAutoCloseInactiveTabsHours={setAutoCloseInactiveTabsHours}
                showRecentInSearch={showRecentInSearch}
                setShowRecentInSearch={setShowRecentInSearch}
                notebookDropdownHoverExpand={notebookDropdownHoverExpand}
                setNotebookDropdownHoverExpand={setNotebookDropdownHoverExpand}
                customActions={customActions}
                addCustomAction={addCustomAction}
                updateCustomAction={updateCustomAction}
                removeCustomAction={removeCustomAction}
              />
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div>
              <SettingsShortcuts
                closeTabShortcut={closeTabShortcut}
                setCloseTabShortcut={setCloseTabShortcut}
                searchPanelCloseShortcut={searchPanelCloseShortcut}
                setSearchPanelCloseShortcut={setSearchPanelCloseShortcut}
                appShortcuts={appShortcuts}
                setAppShortcut={setAppShortcut}
                resetAppShortcuts={resetAppShortcuts}
                singleTabMode={singleTabMode}
              />
            </div>
          )}

          {activeTab === "local-folder" && (
            <div>
              <SettingsLocalFolder
                localFolderFileManager={localFolderFileManager}
                setLocalFolderFileManager={setLocalFolderFileManager}
                localFolderExternalEditor={localFolderExternalEditor}
                setLocalFolderExternalEditor={setLocalFolderExternalEditor}
                localFolderTerminal={localFolderTerminal}
                setLocalFolderTerminal={setLocalFolderTerminal}
                localFolderHiddenFolders={localFolderHiddenFolders}
                setLocalFolderHiddenFolders={setLocalFolderHiddenFolders}
              />
            </div>
          )}

          {activeTab === "appearance" && (
            <div>
              <SettingsAppearance
                theme={theme}
                setTheme={setTheme}
                accentColor={accentColor}
                setAccentColor={setAccentColor}
                codeStyle={codeStyle}
                setCodeStyle={setCodeStyle}
                tableEvenColumnWidth={tableEvenColumnWidth}
                setTableEvenColumnWidth={setTableEvenColumnWidth}
                customFonts={customFonts}
                setCustomLabel={setCustomLabel}
                setCustomFont={setCustomFont}
                uiFontSize={uiFontSize}
                setUIFontSize={setUIFontSize}
                hideExpandArrows={hideExpandArrows}
                setHideExpandArrows={setHideExpandArrows}
              />
            </div>
          )}

          {activeTab === "ai" && (
            <div>
              <SettingsAI
                ai={ai}
                enabled={ai.enabled}
                setEnabled={setAIEnabled}
                setReadGlobalPrompt={setAIReadGlobalPrompt}
                setReadLocalSkills={setAIReadLocalSkills}
                selectedModelId={ai.selectedModelId}
                setSelectedModelId={setAISelectedModelId}
                saveCustomConfig={saveAICustomConfig}
              />
            </div>
          )}

          {activeTab === "data" && (
            <SettingsDataPanel
              importing={importing}
              onImport={handleImport}
              selectedIds={selectedIds}
              notebookList={notebookList}
              onToggleNotebook={toggleNotebook}
              onSelectAll={selectAll}
              format={format}
              onFormatChange={setFormat}
              exporting={exporting}
              onExport={handleExport}
              onOpenResetDialog={() => setResetDialogOpen(true)}
              onResetAndImport={handleReset}
            />
          )}
        </SettingsScaffold>
      </DialogShell>

      <DialogShell
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        layout="center"
        title="确认重置所有数据？"
        description="这将永久删除内部记事本、页面、历史、AI 会话、标签和应用设置；不会删除本地文件夹中的磁盘文件"
        contentClassName="max-w-md"
        bodyClassName="px-6 pb-6"
      >
        <div className="mb-5 mt-1 space-y-3">
          <div className="text-xs text-muted-foreground select-none">
            请输入以下短语以确认重置：
            <code className="ml-1 select-text font-semibold text-foreground">
              {resetPhrase}
            </code>
          </div>
          <Input
            id="reset-all"
            value={resetInput}
            onChange={(e) => setResetInput(e.target.value)}
            placeholder={resetPhrase}
            className="h-9 w-full text-sm"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetDialogOpen(false)}
            className="flex-1"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleManualReset()}
            disabled={!canReset || resetting}
            className="flex-1"
          >
            {resetting ? "正在重置…" : "确认重置"}
          </Button>
        </div>
      </DialogShell>
    </>
  );
}
