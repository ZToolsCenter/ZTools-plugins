import { create } from "zustand";

/**
 * 历史模式（整页接管）状态。
 * 与旧版 useHistoryPanel（Sheet 侧栏）的区别：
 *  - active 不再是 boolean，而是 pageId（null = 未启用）。
 *  - selectedVersionId 默认为最新版本（由视图自行选中）。
 *  - 无 modal/overlay 概念。
 */
interface HistoryViewState {
  /** 当前正在历史模式查看的 pageId；null 表示未进入历史模式 */
  active: string | null;
  /** 当前在主区渲染的版本 id */
  selectedVersionId: string | null;
  /** 触发列表重新加载的 key */
  refreshTick: number;

  enter: (pageId: string) => void;
  exit: () => void;
  select: (versionId: string | null) => void;
  bumpRefresh: () => void;
}

export const useHistoryView = create<HistoryViewState>((set) => ({
  active: null,
  selectedVersionId: null,
  refreshTick: 0,

  enter: (pageId) =>
    set({ active: pageId, selectedVersionId: null, refreshTick: 0 }),
  exit: () => set({ active: null, selectedVersionId: null }),
  select: (versionId) => set({ selectedVersionId: versionId }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
