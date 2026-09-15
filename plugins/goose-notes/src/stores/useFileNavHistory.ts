import { create } from "zustand";

export const FILE_NAV_WELCOME = "welcome";
export const FILE_NAV_AI_PANEL = "ai-panel";

const MAX_FILE_NAV_HISTORY = 80;

export function pageFileNavKey(pageId: string): string {
  return `page:${pageId}`;
}

export function fileNavKeyForTab(tab: {
  type?: string;
  pageId: string;
}): string {
  if (tab.type === "welcome") return FILE_NAV_WELCOME;
  if (tab.type === "notebook-ai") return FILE_NAV_AI_PANEL;
  return pageFileNavKey(tab.pageId);
}

export type FileNavLocation =
  | { type: "welcome" }
  | { type: "ai-panel" }
  | { type: "page"; pageId: string };

export function parseFileNavKey(key: string): FileNavLocation {
  if (key === FILE_NAV_WELCOME) return { type: "welcome" };
  if (key === FILE_NAV_AI_PANEL) return { type: "ai-panel" };
  if (key.startsWith("page:")) return { type: "page", pageId: key.slice(5) };
  return { type: "page", pageId: key };
}

interface FileNavHistoryState {
  entries: string[];
  index: number;
  navigating: boolean;
  push: (key: string) => void;
  markNavigating: (navigating: boolean) => void;
  moveBack: () => string | null;
  moveForward: () => string | null;
  canBack: () => boolean;
  canForward: () => boolean;
  reset: () => void;
}

export const useFileNavHistory = create<FileNavHistoryState>()((set, get) => ({
  entries: [],
  index: -1,
  navigating: false,

  push: (key) => {
    const { entries, index, navigating } = get();
    if (!key || navigating) return;
    const current = index >= 0 && index < entries.length ? entries[index] : null;
    if (current === key) return;

    const next = [...entries.slice(0, index + 1), key].slice(
      -MAX_FILE_NAV_HISTORY,
    );
    set({
      entries: next,
      index: next.length - 1,
    });
  },

  markNavigating: (navigating) => {
    if (get().navigating === navigating) return;
    set({ navigating });
  },

  moveBack: () => {
    const { entries, index } = get();
    if (index <= 0) return null;
    const nextIndex = index - 1;
    set({ index: nextIndex });
    return entries[nextIndex] ?? null;
  },

  moveForward: () => {
    const { entries, index } = get();
    if (index < 0 || index >= entries.length - 1) return null;
    const nextIndex = index + 1;
    set({ index: nextIndex });
    return entries[nextIndex] ?? null;
  },

  canBack: () => get().index > 0,

  canForward: () => {
    const { entries, index } = get();
    return index >= 0 && index < entries.length - 1;
  },

  reset: () =>
    set({
      entries: [],
      index: -1,
      navigating: false,
    }),
}));
