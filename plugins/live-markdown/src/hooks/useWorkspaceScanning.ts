import { Dispatch, SetStateAction, useCallback, useEffect, useRef } from "react";
import { findOwningWorkspace, getParentPath, injectDirectoryChildren, mergeLoadedWorkspaceSubtrees } from "../utils/pathUtils";
import { TyporaBridgeApi, FileViewMode, WorkspaceScanResult } from "../types/typora";

export interface WorkspaceScanningOptions {
  bridge: TyporaBridgeApi | null;
  workspaces: WorkspaceScanResult[];
  setWorkspaces: Dispatch<SetStateAction<WorkspaceScanResult[]>>;
  setRecentFolders: Dispatch<SetStateAction<string[]>>;
  fileViewMode: FileViewMode;
  quickOpenVisible: boolean;
  showToast: (message: string) => void;
}

export function useWorkspaceScanning(options: WorkspaceScanningOptions) {
  const {
    bridge,
    workspaces,
    setWorkspaces,
    setRecentFolders,
    fileViewMode,
    quickOpenVisible,
    showToast
  } = options;

  // Keep preload MCP workspace search roots aligned with active workspace folders
  useEffect(() => {
    bridge?.setWorkspaceRoots?.(workspaces.map((w) => w.rootDir));
  }, [bridge, workspaces]);

  const addWorkspaceFolders = useCallback(
    (
      folderPaths: string[],
      scanOpts?: { shallow?: boolean; replace?: boolean; silent?: boolean }
    ): WorkspaceScanResult[] => {
      if (!bridge?.scanWorkspace) return [];
      const uniqueInput = Array.from(
        new Set(folderPaths.map((p) => String(p || "").trim()).filter(Boolean))
      );
      if (uniqueInput.length === 0) return [];

      const shallow = scanOpts?.shallow ?? fileViewMode === "tree";
      const scannedList: WorkspaceScanResult[] = [];
      const seenRootDirs = new Set<string>();

      for (const folderPath of uniqueInput) {
        try {
          const scanned = bridge.scanWorkspace(folderPath, { shallow });
          if (!seenRootDirs.has(scanned.rootDir)) {
            seenRootDirs.add(scanned.rootDir);
            scannedList.push(scanned);
          }
        } catch (err) {
          showToast(
            `读取工作区失败: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (scannedList.length === 0) return [];

      setWorkspaces((prev) => {
        if (scanOpts?.replace) {
          return scannedList;
        }
        const prevByRoot = new Map(prev.map((w) => [w.rootDir, w]));
        const byRoot = new Map(
          scannedList.map((item) => [
            item.rootDir,
            mergeLoadedWorkspaceSubtrees(item, prevByRoot.get(item.rootDir))
          ])
        );
        const next = prev.map((existing) => byRoot.get(existing.rootDir) ?? existing);
        const existingRoots = new Set(prev.map((w) => w.rootDir));
        for (const item of scannedList) {
          if (!existingRoots.has(item.rootDir)) {
            next.push(item);
          }
        }
        return next;
      });

      setRecentFolders((prev) => {
        const addedRoots = scannedList.map((s) => s.rootDir);
        const next = [
          ...addedRoots,
          ...prev.filter((p) => !seenRootDirs.has(p))
        ].slice(0, 8);
        try {
          bridge.savePersistedState?.({
            userRecentFolders: next
          });
        } catch {
          // ignore
        }
        return next;
      });

      if (!scanOpts?.silent) {
        if (scannedList.length > 1) {
          showToast(`已添加 ${scannedList.length} 个文件夹到工作区`);
        } else {
          showToast(`已加载文件夹: ${scannedList[0].rootName}`);
        }
      }

      return scannedList;
    },
    [bridge, fileViewMode, setRecentFolders, setWorkspaces, showToast]
  );

  // Scan/refresh a single workspace directory (defaults to shallow 1-level scan in tree mode)
  const refreshWorkspace = useCallback(
    (folderPath: string, scanOpts?: { shallow?: boolean; append?: boolean; silent?: boolean }) => {
      if (!folderPath) return;
      addWorkspaceFolders([folderPath], {
        shallow: scanOpts?.shallow,
        replace: scanOpts?.append === false,
        silent: scanOpts?.silent ?? true
      });
    },
    [addWorkspaceFolders]
  );

  // Lazy-load a subdirectory's direct children on demand when expanded in Tree View
  const handleExpandDirectory = useCallback(
    (dirPath: string) => {
      if (!bridge?.listDirectoryChildren) return;
      const owner = findOwningWorkspace(workspaces, dirPath);
      if (!owner) return;
      try {
        const result = bridge.listDirectoryChildren(dirPath, owner.rootDir);
        setWorkspaces((prev) =>
          prev.map((ws) => {
            if (ws.rootDir !== owner.rootDir) return ws;
            const updatedTree = injectDirectoryChildren(
              ws.tree,
              dirPath,
              result.children
            );
            const keptFiles = ws.files.filter(
              (f) => getParentPath(f.path) !== dirPath
            );
            const existingMap = new Map(keptFiles.map((f) => [f.path, f]));
            for (const file of result.files) {
              existingMap.set(file.path, file);
            }
            return {
              ...ws,
              tree: updatedTree,
              files: Array.from(existingMap.values())
            };
          })
        );
      } catch (err) {
        showToast(
          `展开目录失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [bridge, setWorkspaces, showToast, workspaces]
  );

  // Remove a single folder from the multi-folder workspace
  const handleRemoveWorkspaceFolder = useCallback(
    (folderPath: string) => {
      setWorkspaces((prev) => prev.filter((w) => w.rootDir !== folderPath));
      showToast("已从工作区移除文件夹");
    },
    [setWorkspaces, showToast]
  );

  // Close all workspace folders
  const handleCloseWorkspace = useCallback(() => {
    setWorkspaces([]);
    showToast("已关闭本地工作区");
  }, [setWorkspaces, showToast]);

  const attemptedUpgradeRootsRef = useRef<Set<string>>(new Set());

  // Upgrade shallow workspaces to full scan in one batch when switching to List View or opening Quick Open
  useEffect(() => {
    if (fileViewMode !== "list" && !quickOpenVisible) {
      attemptedUpgradeRootsRef.current.clear();
      return;
    }
    const pendingRoots = workspaces
      .filter((w) => w.isShallow && !attemptedUpgradeRootsRef.current.has(w.rootDir))
      .map((w) => w.rootDir);
    if (pendingRoots.length === 0) return;
    for (const root of pendingRoots) {
      attemptedUpgradeRootsRef.current.add(root);
    }
    addWorkspaceFolders(pendingRoots, { shallow: false, silent: true });
  }, [addWorkspaceFolders, fileViewMode, quickOpenVisible, workspaces]);

  return {
    addWorkspaceFolders,
    refreshWorkspace,
    handleExpandDirectory,
    handleRemoveWorkspaceFolder,
    handleCloseWorkspace
  };
}
