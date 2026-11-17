import { Dispatch, SetStateAction, useCallback } from "react";
import { LoadedDocument, SidebarTab, TyporaBridgeApi, WorkspaceScanResult } from "../types/typora";
import { SAMPLE_MARKDOWN_REFERENCE_DOC, SAMPLE_QUICKSTART_DOC } from "../core/sampleDocs";
import { parseMarkdownDocument } from "../core/markdownParser";
import { runGuardedNavigation } from "../core/guardedNavigation";
import { documentIdentity } from "../core/documentIdentity";

export interface DocumentNavigationOptions {
  bridge: TyporaBridgeApi | null;
  doc: LoadedDocument;
  workspace: WorkspaceScanResult | null;
  setDoc: Dispatch<SetStateAction<LoadedDocument>>;
  setActiveSampleKey: Dispatch<SetStateAction<"quickstart" | "reference" | null>>;
  setUndoStack: Dispatch<SetStateAction<string[]>>;
  setRedoStack: Dispatch<SetStateAction<string[]>>;
  setFocusedBlockId: Dispatch<SetStateAction<string | null>>;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;
  setSidebarTab: Dispatch<SetStateAction<SidebarTab>>;
  addWorkspaceFolders: (paths: string[], options?: { shallow?: boolean; replace?: boolean; silent?: boolean }) => unknown;
  showToast: (message: string) => void;
  beforeNavigate?: () => Promise<boolean>;
}

export function useDocumentNavigation(options: DocumentNavigationOptions) {
  const { bridge, doc, workspace, setDoc, setActiveSampleKey, setUndoStack, setRedoStack,
    setFocusedBlockId, setSidebarVisible, setSidebarTab,
    addWorkspaceFolders, showToast, beforeNavigate = async () => true } = options;
  const openLocalFile = useCallback(
    async (filePath: string, jumpToLine?: number) => {
      if (!bridge?.readDocument || !(await runGuardedNavigation(beforeNavigate, () => undefined))) return;
      try {
        const loaded = bridge.readDocument(filePath);
        setDoc({
          documentId: documentIdentity(loaded.path),
          path: loaded.path,
          name: loaded.name,
          dir: loaded.dir,
          content: loaded.content,
          isDirty: false,
          mtimeMs: loaded.mtimeMs
        });
        setActiveSampleKey(null);
        setUndoStack([]);
        setRedoStack([]);
        setFocusedBlockId(null);

        if (jumpToLine && jumpToLine > 0) {
          setTimeout(() => {
            const targetParse = parseMarkdownDocument(loaded.content);
            const block = targetParse.blocks.find(
              (b) => jumpToLine >= b.startLine && jumpToLine <= b.endLine
            );
            if (block) {
              setFocusedBlockId(block.id);
              const el =
                document.getElementById(block.id) ||
                document.querySelector(`[data-block-id="${block.id}"]`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 60);
        }
      } catch (err) {
        showToast(
          `无法打开文件: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [beforeNavigate, bridge, showToast]
  );

  // Load sample doc
  const handleLoadSampleDoc = useCallback(
    async (which: "quickstart" | "reference") => {
      if (!(await runGuardedNavigation(beforeNavigate, () => undefined))) return;
      const isQuick = which === "quickstart";
      setDoc({
        documentId: documentIdentity(null, `sample:${which}`),
        path: null,
        name: isQuick ? "Live Markdown 快速上手指南.md" : "Markdown 语法完整手册.md",
        dir: workspace?.rootDir || bridge?.getDefaultNotesDir?.() || "",
        content: isQuick ? SAMPLE_QUICKSTART_DOC : SAMPLE_MARKDOWN_REFERENCE_DOC,
        isDirty: false,
        mtimeMs: Date.now()
      });
      setActiveSampleKey(which);
      setUndoStack([]);
      setRedoStack([]);
      setFocusedBlockId(null);
      showToast(
        isQuick
          ? "已载入《Live Markdown 快速上手指南》"
          : "已载入《Markdown 语法完整手册》"
      );
    },
    [beforeNavigate, bridge, showToast, workspace]
  );

  // New Document
  const handleNewDocument = useCallback(async () => {
    if (!(await runGuardedNavigation(beforeNavigate, () => undefined))) return;
    setDoc({
      documentId: documentIdentity(null),
      path: null,
      name: "Untitled.md",
      dir: workspace?.rootDir || bridge?.getDefaultNotesDir?.() || "",
      content: "# Untitled\n\n在此开始编写 Markdown 内容…\n",
      isDirty: true,
      mtimeMs: Date.now()
    });
    setActiveSampleKey(null);
    setUndoStack([]);
    setRedoStack([]);
    setFocusedBlockId("block-1");
  }, [beforeNavigate, bridge, workspace]);

  // Open File via dialog
  const handleOpenFileDialog = useCallback(() => {
    if (!bridge?.selectOpenFile) {
      showToast("当前环境不支持原生文件对话框，请使用左侧文件树或快速打开");
      return;
    }
    const chosen = bridge.selectOpenFile({
      defaultPath: workspace?.rootDir || doc.dir || undefined
    });
    if (chosen) {
      openLocalFile(chosen);
    }
  }, [bridge, doc.dir, openLocalFile, showToast, workspace]);

  // Open or add folder(s) via dialog or direct path
  const handleOpenFolder = useCallback(
    (folderPath?: string | string[], appendMode?: boolean) => {
      const replace = appendMode === false;
      if (folderPath) {
        const paths = Array.isArray(folderPath) ? folderPath : [folderPath];
        if (paths.length === 0) return;
        addWorkspaceFolders(paths, { replace });
        setSidebarVisible(true);
        setSidebarTab("files");
        return;
      }
      let chosenPaths: string[] = [];
      if (typeof bridge?.selectOpenFolders === "function") {
        chosenPaths = bridge.selectOpenFolders({
          defaultPath: workspace?.rootDir || doc.dir || undefined
        });
      } else if (typeof bridge?.selectOpenFolder === "function") {
        const chosen = bridge.selectOpenFolder({
          defaultPath: workspace?.rootDir || doc.dir || undefined
        });
        if (chosen) chosenPaths = [chosen];
      } else {
        showToast("当前环境不支持文件夹选择对话框");
        return;
      }
      if (chosenPaths.length > 0) {
        addWorkspaceFolders(chosenPaths, { replace });
        setSidebarVisible(true);
        setSidebarTab("files");
      }
    },
    [addWorkspaceFolders, bridge, doc.dir, setSidebarTab, setSidebarVisible, showToast, workspace]
  );

  const handleAddFolders = useCallback(() => {
    handleOpenFolder(undefined, true);
  }, [handleOpenFolder]);

  return { openLocalFile, handleLoadSampleDoc, handleNewDocument, handleOpenFileDialog, handleOpenFolder, handleAddFolders };
}
