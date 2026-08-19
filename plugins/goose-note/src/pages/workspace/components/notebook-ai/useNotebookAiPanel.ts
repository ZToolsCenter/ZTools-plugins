/**
 * AI 面板开关 + 打开方式（侧栏并排 / 全屏）
 *
 * - 默认全屏打开
 * - 侧栏模式：右侧并排，可拖宽
 * - 全屏模式：主内容区铺满 AI，不创建标签页，仅标签栏最左图标入口
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useTabs, isNotebookAiTab } from "@/stores/useTabs";

const OPEN_STORAGE_KEY = "goose-note-ai-panel-open";
const LAYOUT_STORAGE_KEY = "goose-note-ai-layout-mode";

/** tab 为历史取值，等同 fullscreen */
export type NotebookAiLayoutMode = "side-panel" | "fullscreen" | "tab";

export interface NotebookAiPanelSelectionCapture<TSelection = unknown> {
  version: 1;
  pageId: string;
  selection: TSelection;
}

export function isFullscreenAiLayout(
  mode: NotebookAiLayoutMode | undefined,
): boolean {
  return mode === "fullscreen" || mode === "tab";
}

/** 无记录或读失败时视为关闭。 */
function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === "true";
  } catch {
    // ignore
  }
  return false;
}

/** 默认全屏。兼容旧值 tab → fullscreen */
function readStoredLayoutMode(): NotebookAiLayoutMode {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === "side-panel") return "side-panel";
    if (raw === "fullscreen" || raw === "tab") return "fullscreen";
  } catch {
    // ignore
  }
  return "fullscreen";
}

function persistOpen(next: boolean) {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, String(next));
  } catch {
    // ignore
  }
}

function persistLayoutMode(mode: NotebookAiLayoutMode) {
  try {
    // 统一落盘为 fullscreen / side-panel
    const normalized =
      mode === "tab" || mode === "fullscreen" ? "fullscreen" : "side-panel";
    localStorage.setItem(LAYOUT_STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
}

/** 清掉历史遗留的 notebook-ai 标签（现已不再使用标签承载 AI）。 */
function purgeLegacyNotebookAiTabs() {
  useTabs.setState((state) => {
    const legacyIds = new Set(
      state.openTabs.filter((tab) => isNotebookAiTab(tab)).map((tab) => tab.id),
    );
    if (legacyIds.size === 0) return state;
    const openTabs = state.openTabs.filter((tab) => !legacyIds.has(tab.id));
    const activeTabId =
      state.activeTabId && !legacyIds.has(state.activeTabId)
        ? state.activeTabId
        : (openTabs[openTabs.length - 1]?.id ?? null);
    const tabHistory = state.tabHistory.filter((id) => !legacyIds.has(id));
    return {
      openTabs,
      activeTabId,
      tabHistory,
      tabHistoryIndex: tabHistory.length - 1,
    };
  });
}

/**
 * 模块级关闭句柄：侧栏选页等非 React 树路径需要在 AI 全屏时退出会话。
 * 仅在 useNotebookAiPanel 挂载期间有效。
 */
let closeAiPanelHandler: (() => void) | null = null;

/** 当前是否处于「AI 已打开且全屏」——侧栏点页面时应退出 AI 回到该标签。 */
export function isNotebookAiFullscreenOpen(): boolean {
  return readStoredOpen() && isFullscreenAiLayout(readStoredLayoutMode());
}

/**
 * 从侧栏打开页面时调用：若 AI 全屏覆盖主区域，只关掉面板 UI，
 * 让用户回到对应页面标签（与点标签栏 onBeforeActivateTab 一致）。
 * 不会中止后台会话：请求生命周期由 NotebookAiSessionProvider 持有。
 */
export function closeNotebookAiIfFullscreen(): void {
  if (!isNotebookAiFullscreenOpen()) return;
  closeAiPanelHandler?.();
}

export function useNotebookAiPanel() {
  const [isOpen, setIsOpen] = useState<boolean>(readStoredOpen);
  const [layoutMode, setLayoutModeState] = useState<NotebookAiLayoutMode>(
    readStoredLayoutMode,
  );
  const [capturedSelection, setCapturedSelection] =
    useState<NotebookAiPanelSelectionCapture | null>(null);
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;

  const open = useCallback(
    (capture?: NotebookAiPanelSelectionCapture | null) => {
      setCapturedSelection(capture ?? null);
      setIsOpen(true);
      persistOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setCapturedSelection(null);
    setIsOpen(false);
    persistOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setCapturedSelection(null);
    setIsOpen((prev) => {
      const next = !prev;
      persistOpen(next);
      return next;
    });
  }, []);

  const setLayoutMode = useCallback((mode: NotebookAiLayoutMode) => {
    const normalized: NotebookAiLayoutMode =
      mode === "tab" || mode === "fullscreen" ? "fullscreen" : "side-panel";
    if (normalized === layoutModeRef.current) return;
    layoutModeRef.current = normalized;
    setLayoutModeState(normalized);
    persistLayoutMode(normalized);
  }, []);

  const consumeCapturedSelection = useCallback(() => {
    setCapturedSelection(null);
  }, []);

  // 暴露关闭句柄给侧栏导航等外部路径
  useEffect(() => {
    closeAiPanelHandler = close;
    return () => {
      if (closeAiPanelHandler === close) {
        closeAiPanelHandler = null;
      }
    };
  }, [close]);

  // 启动时清理旧 AI 标签
  useEffect(() => {
    purgeLegacyNotebookAiTabs();
  }, []);

  return {
    isOpen,
    layoutMode,
    setLayoutMode,
    open,
    close,
    toggle,
    capturedSelection,
    consumeCapturedSelection,
  };
}
