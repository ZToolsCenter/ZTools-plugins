import { useCallback, useState } from "react";
import { readPersistent, writePersistent } from "@/lib/pluginHost";

/**
 * Board view mode:
 * - "3d": free orbit camera
 * - "2d": locked top-down camera, rotation disabled, zoom kept
 */
export type ViewMode = "2d" | "3d";

const STORAGE_KEY = "view-mode";

/**
 * 读取并校验持久化的棋盘视图。
 * @returns 有效的 2D 或 3D 视图模式。
 */
function loadViewMode(): ViewMode {
  const value = readPersistent<unknown>(STORAGE_KEY, "3d");
  return value === "2d" || value === "3d" ? value : "3d";
}

/**
 * 提供持久化的棋盘视图状态。
 * @returns 当前视图和更新函数。
 */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    writePersistent(STORAGE_KEY, mode);
  }, []);

  return [viewMode, setViewMode];
}
