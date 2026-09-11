import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { gaStateStorage } from "@/stores/settings/gaStorage";
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  PERMISSION_MODE_LABELS,
  PERMISSION_MODES,
  type PermissionMode,
} from "@/lib/agent/permission";

export type { PermissionMode };
export {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODE_LABELS,
  PERMISSION_MODES,
};

/**
 * Composer 旁三档权限（ADR 0007 / DESIGN）。
 * 完整权限切换立即生效，**无** Dialog / confirm。
 * 档位与 `lib/agent/permission` 同源：workspace-read | workspace-write | full-access。
 */
export const PERMISSION_MODE_OPTIONS: ReadonlyArray<{
  id: PermissionMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "workspace-read",
    label: PERMISSION_MODE_LABELS["workspace-read"],
    shortLabel: "只读",
    description: "仅当前工作区内只读",
  },
  {
    id: "workspace-write",
    label: PERMISSION_MODE_LABELS["workspace-write"],
    shortLabel: "读写",
    description: "当前工作区内可读可写",
  },
  {
    id: "full-access",
    label: PERMISSION_MODE_LABELS["full-access"],
    shortLabel: "完整",
    description: "整机文件系统（无二次确认）",
  },
];

interface PermissionModeState {
  mode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
}

function normalizeMode(value: unknown): PermissionMode {
  // 兼容早期 UI 草稿 id
  if (value === "read-only") return "workspace-read";
  if (isPermissionMode(value)) return value;
  return DEFAULT_PERMISSION_MODE;
}

/**
 * 持久化名 `permission-mode` → 物理键 `ga:permission-mode`。
 */
export const usePermissionMode = create<PermissionModeState>()(
  persist(
    (set) => ({
      mode: DEFAULT_PERMISSION_MODE,
      setMode: (mode) => set({ mode: normalizeMode(mode) }),
    }),
    {
      name: "permission-mode",
      version: 1,
      storage: createJSONStorage(() => gaStateStorage),
      partialize: (state) => ({ mode: state.mode }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as { mode?: unknown })
            : {};
        return {
          ...current,
          mode: normalizeMode(raw.mode),
        };
      },
    },
  ),
);
