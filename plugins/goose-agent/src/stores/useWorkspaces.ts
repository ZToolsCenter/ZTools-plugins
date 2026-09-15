import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { pickDirectory } from "@/lib/fs";
import { gaStateStorage } from "./settings/gaStorage";

/** 工作区：用户选定的本地文件夹（ADR 0007，可空） */
export interface WorkspaceItem {
  id: string;
  /** 显示名（通常为文件夹名） */
  name: string;
  /** 本地绝对路径 */
  path: string;
}

interface WorkspacesState {
  workspaces: WorkspaceItem[];
  activeId: string | null;
  /** 多展开：当前展开的工作区 id 列表（ADR 0015） */
  expandedIds: string[];
  setActive: (id: string | null) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  toggleExpanded: (id: string) => void;
  collapseAll: () => void;
  /** 弹出选目录并挂载；取消返回 null */
  addFromPicker: () => Promise<WorkspaceItem | null>;
  /** 直接加入一项（测试 / 恢复用） */
  addWorkspace: (item: Omit<WorkspaceItem, "id"> & { id?: string }) => WorkspaceItem;
  remove: (id: string) => void;
}

function folderNameFromPath(dirPath: string): string {
  const parts = dirPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dirPath;
}

function normalizePathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function newId(): string {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withExpanded(
  expandedIds: string[],
  id: string,
  expanded: boolean,
): string[] {
  const has = expandedIds.includes(id);
  if (expanded) {
    return has ? expandedIds : [...expandedIds, id];
  }
  return has ? expandedIds.filter((x) => x !== id) : expandedIds;
}

/**
 * 工作区列表 + 当前选中 + 多展开状态。
 * persist 逻辑键 `workspaces` → 物理 `ga:workspaces`（gaStateStorage）。
 */
export const useWorkspaces = create<WorkspacesState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeId: null,
      expandedIds: [],

      setActive: (id) =>
        set((s) => {
          if (id == null) {
            return { activeId: null };
          }
          return {
            activeId: id,
            expandedIds: withExpanded(s.expandedIds, id, true),
          };
        }),

      setExpanded: (id, expanded) =>
        set((s) => ({
          expandedIds: withExpanded(s.expandedIds, id, expanded),
        })),

      toggleExpanded: (id) =>
        set((s) => {
          const open = s.expandedIds.includes(id);
          return { expandedIds: withExpanded(s.expandedIds, id, !open) };
        }),

      collapseAll: () => set({ expandedIds: [] }),

      addWorkspace: (item) => {
        const pathKey = normalizePathKey(item.path);
        const existing = get().workspaces.find(
          (w) => normalizePathKey(w.path) === pathKey,
        );
        if (existing) {
          set((s) => ({
            activeId: existing.id,
            expandedIds: withExpanded(s.expandedIds, existing.id, true),
          }));
          return existing;
        }
        const entry: WorkspaceItem = {
          id: item.id ?? newId(),
          name: item.name || folderNameFromPath(item.path),
          path: item.path,
        };
        set((s) => ({
          workspaces: [...s.workspaces, entry],
          activeId: entry.id,
          expandedIds: withExpanded(s.expandedIds, entry.id, true),
        }));
        return entry;
      },

      addFromPicker: async () => {
        const dir = await pickDirectory();
        if (!dir) return null;
        return get().addWorkspace({
          name: folderNameFromPath(dir),
          path: dir,
        });
      },

      remove: (id) =>
        set((s) => {
          const workspaces = s.workspaces.filter((w) => w.id !== id);
          const activeId =
            s.activeId === id ? (workspaces[0]?.id ?? null) : s.activeId;
          const expandedIds = s.expandedIds.filter((x) => x !== id);
          // 若切到新 active，确保其展开
          const nextExpanded =
            activeId && activeId !== s.activeId
              ? withExpanded(expandedIds, activeId, true)
              : expandedIds;
          return { workspaces, activeId, expandedIds: nextExpanded };
        }),
    }),
    {
      name: "workspaces",
      version: 2,
      storage: createJSONStorage(() => gaStateStorage),
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeId: state.activeId,
        expandedIds: state.expandedIds,
      }),
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as {
          workspaces?: WorkspaceItem[];
          activeId?: string | null;
          expandedIds?: string[];
        };
        if (fromVersion < 2) {
          // v1 无 expandedIds：若有 activeId 则默认展开该项
          const activeId = p.activeId ?? null;
          return {
            workspaces: p.workspaces ?? [],
            activeId,
            expandedIds:
              activeId && typeof activeId === "string" ? [activeId] : [],
          };
        }
        const expandedIds = Array.isArray(p.expandedIds)
          ? p.expandedIds.filter((id): id is string => typeof id === "string")
          : [];
        // rehydrate 后若 expanded 空且有 active，展开 active
        if (
          expandedIds.length === 0 &&
          p.activeId &&
          typeof p.activeId === "string"
        ) {
          return {
            workspaces: p.workspaces ?? [],
            activeId: p.activeId,
            expandedIds: [p.activeId],
          };
        }
        return {
          workspaces: p.workspaces ?? [],
          activeId: p.activeId ?? null,
          expandedIds,
        };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkspacesState>;
        const activeId =
          p.activeId !== undefined ? p.activeId : current.activeId;
        let expandedIds = Array.isArray(p.expandedIds)
          ? p.expandedIds
          : current.expandedIds;
        if (
          (!expandedIds || expandedIds.length === 0) &&
          activeId &&
          typeof activeId === "string"
        ) {
          expandedIds = [activeId];
        }
        return {
          ...current,
          ...p,
          workspaces: Array.isArray(p.workspaces)
            ? p.workspaces
            : current.workspaces,
          activeId: activeId ?? null,
          expandedIds: expandedIds ?? [],
        };
      },
    },
  ),
);

/** 当前选中工作区根路径；无可空 */
export function getActiveWorkspaceRoot(): string | null {
  const { workspaces, activeId } = useWorkspaces.getState();
  if (!activeId) return null;
  const active = workspaces.find((w) => w.id === activeId);
  const path = active?.path?.trim();
  return path || null;
}
