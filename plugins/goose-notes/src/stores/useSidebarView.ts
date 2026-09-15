import { create } from "zustand";
import { persist } from "zustand/middleware";

const EMPTY_ARRAY: string[] = [];

type State = {
  expandedByNotebook: Record<string, string[]>;
  focusedByNotebook: Record<string, string | null>;
  selectedByNotebook: Record<string, string | null>;
  favoritesCollapsed: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setExpanded: (notebookId: string, ids: string[]) => void;
  expand: (notebookId: string, id: string) => void;
  collapse: (notebookId: string, id: string) => void;
  setFocused: (notebookId: string, id: string | null) => void;
  setSelected: (notebookId: string, id: string | null) => void;
  setFavoritesCollapsed: (collapsed: boolean) => void;
};

export const useSidebarView = create<State>()(
  persist(
    (set, get) => ({
      expandedByNotebook: {},
      focusedByNotebook: {},
      selectedByNotebook: {},
      favoritesCollapsed: false,
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => {
        if (get().sidebarCollapsed === collapsed) return;
        set({ sidebarCollapsed: collapsed });
      },
      toggleSidebarCollapsed: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setExpanded: (notebookId, ids) => {
        const current = get().expandedByNotebook[notebookId];
        if (current && current.length === ids.length && current.every((v, i) => v === ids[i])) {
          return;
        }
        set((state) => ({
          expandedByNotebook: { ...state.expandedByNotebook, [notebookId]: ids },
        }));
      },
      expand: (notebookId, id) => {
        const list = get().expandedByNotebook[notebookId] ?? EMPTY_ARRAY;
        if (list.includes(id)) return;
        set((state) => ({
          expandedByNotebook: {
            ...state.expandedByNotebook,
            [notebookId]: [...list, id],
          },
        }));
      },
      collapse: (notebookId, id) => {
        const list = get().expandedByNotebook[notebookId];
        if (!list || !list.includes(id)) return;
        set((state) => ({
          expandedByNotebook: {
            ...state.expandedByNotebook,
            [notebookId]: list.filter((x) => x !== id),
          },
        }));
      },
      setFocused: (notebookId, id) => {
        if (get().focusedByNotebook[notebookId] === id) return;
        set((state) => ({
          focusedByNotebook: { ...state.focusedByNotebook, [notebookId]: id },
        }));
      },
      setSelected: (notebookId, id) => {
        if (get().selectedByNotebook[notebookId] === id) return;
        set((state) => ({
          selectedByNotebook: { ...state.selectedByNotebook, [notebookId]: id },
        }));
      },
      setFavoritesCollapsed: (collapsed) => {
        if (get().favoritesCollapsed === collapsed) return;
        set({ favoritesCollapsed: collapsed });
      },
    }),
    {
      name: "goose-sidebar-view",
      version: 1,
      partialize: (state) => ({ expandedByNotebook: state.expandedByNotebook, favoritesCollapsed: state.favoritesCollapsed, sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

export const selectExpandedIds = (notebookId: string | null) => (state: State) =>
  notebookId ? state.expandedByNotebook[notebookId] ?? EMPTY_ARRAY : EMPTY_ARRAY;

export const selectFocusedId = (notebookId: string | null) => (state: State) =>
  notebookId ? state.focusedByNotebook[notebookId] ?? null : null;

export const selectSelectedId = (notebookId: string | null) => (state: State) =>
  notebookId ? state.selectedByNotebook[notebookId] ?? null : null;

export const selectFavoritesCollapsed = (state: State) => state.favoritesCollapsed;
