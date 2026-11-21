import { Dispatch, SetStateAction, useCallback } from "react";
import { PromptDialogState } from "../components/FloatingPanels";
import { findOwningWorkspace, getParentPath } from "../utils/pathUtils";
import { LoadedDocument, TyporaBridgeApi, WorkspaceScanResult } from "../types/typora";

export interface SidebarFileActionsOptions {
  bridge: TyporaBridgeApi | null;
  doc: LoadedDocument;
  setDoc: Dispatch<SetStateAction<LoadedDocument>>;
  workspaces: WorkspaceScanResult[];
  refreshWorkspace: (path: string, options?: { shallow?: boolean; append?: boolean }) => void;
  expandDirectory: (path: string) => void;
  openLocalFile: (path: string) => void;
  newDocument: () => void;
  setPromptDialog: Dispatch<SetStateAction<PromptDialogState | null>>;
  showToast: (message: string) => void;
  flushPendingSave?: () => Promise<boolean>;
}

export function useSidebarFileActions(options: SidebarFileActionsOptions) {
  const { bridge, doc, setDoc, workspaces, refreshWorkspace,
    expandDirectory: handleExpandDirectory, openLocalFile, newDocument: handleNewDocument,
    setPromptDialog, showToast, flushPendingSave } = options;
  // Sidebar file operations (create / subfolder / rename / duplicate / delete)
  const refreshParentDirectory = useCallback(
    (parentDir: string) => {
      const owner = findOwningWorkspace(workspaces, parentDir);
      if (!owner) {
        refreshWorkspace(parentDir);
        return;
      }
      if (parentDir !== owner.rootDir && owner.isShallow) {
        handleExpandDirectory(parentDir);
      } else {
        refreshWorkspace(owner.rootDir, { append: true });
      }
    },
    [handleExpandDirectory, refreshWorkspace, workspaces]
  );

  const handleCreateFileInFolder = useCallback(
    (parentDir: string) => {
      if (!bridge?.createDocument) return;
      setPromptDialog({
        open: true,
        title: "新建 Markdown 文档",
        placeholder: "输入文件名，例如 架构设计.md",
        initialValue: "Untitled.md",
        confirmLabel: "创建",
        onConfirm: (fileName) => {
          try {
            const created = bridge.createDocument(parentDir, fileName);
            refreshParentDirectory(parentDir);
            openLocalFile(created.path);
            showToast(`已创建 ${created.name}`);
          } catch (err) {
            showToast(
              `创建失败: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      });
    },
    [bridge, openLocalFile, refreshParentDirectory, showToast]
  );

  const handleCreateSubfolder = useCallback(
    (parentDir: string) => {
      if (!bridge?.createFolder) return;
      setPromptDialog({
        open: true,
        title: "新建子文件夹",
        placeholder: "输入文件夹名称",
        initialValue: "New Folder",
        confirmLabel: "创建",
        onConfirm: (folderName) => {
          try {
            bridge.createFolder(parentDir, folderName);
            refreshParentDirectory(parentDir);
            showToast(`已创建文件夹 ${folderName}`);
          } catch (err) {
            showToast(
              `创建文件夹失败: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      });
    },
    [bridge, refreshParentDirectory, showToast]
  );

  const handleRenameEntry = useCallback(
    (targetPath: string, currentName: string) => {
      if (!bridge?.renameEntry) return;
      setPromptDialog({
        open: true,
        title: "重命名",
        placeholder: "输入新名称",
        initialValue: currentName,
        confirmLabel: "重命名",
        onConfirm: async (newName) => {
          try {
            if (doc.path === targetPath && doc.isDirty && flushPendingSave && !(await flushPendingSave())) {
              showToast("保存失败或文件冲突，未重命名当前文档");
              return;
            }
            const renamed = bridge.renameEntry(targetPath, newName);
            if (doc.path === targetPath) {
              setDoc((prev) => ({
                ...prev,
                path: renamed.newPath,
                name: renamed.name
              }));
            }
            const parentDir = getParentPath(targetPath);
            if (parentDir) {
              refreshParentDirectory(parentDir);
            }
            showToast(`已重命名为 ${renamed.name}`);
          } catch (err) {
            showToast(
              `重命名失败: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      });
    },
    [bridge, doc.isDirty, doc.path, flushPendingSave, refreshParentDirectory, showToast]
  );

  const handleDuplicateFile = useCallback(
    (filePath: string) => {
      if (!bridge?.duplicateDocument) return;
      try {
        const copy = bridge.duplicateDocument(filePath);
        const parentDir = getParentPath(filePath);
        if (parentDir) {
          refreshParentDirectory(parentDir);
        }
        openLocalFile(copy.path);
        showToast(`已创建副本 ${copy.name}`);
      } catch (err) {
        showToast(
          `创建副本失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [bridge, openLocalFile, refreshParentDirectory, showToast]
  );

  const handleDeleteEntry = useCallback(
    (targetPath: string, name: string) => {
      if (!bridge?.deleteEntry) return;
      try {
        bridge.deleteEntry(targetPath);
        if (doc.path === targetPath) {
          handleNewDocument();
        }
        const parentDir = getParentPath(targetPath);
        if (parentDir) {
          refreshParentDirectory(parentDir);
        }
        showToast(`已删除 ${name}`);
      } catch (err) {
        showToast(
          `删除失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [bridge, doc.path, handleNewDocument, refreshParentDirectory, showToast]
  );


  return { refreshParentDirectory, handleCreateFileInFolder, handleCreateSubfolder, handleRenameEntry, handleDuplicateFile, handleDeleteEntry };
}
