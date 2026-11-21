import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
import { PromptDialogState } from "../components/FloatingPanels";
import { recordSnapshot } from "../core/historyManager";
import { clearDocumentRecovery } from "../core/documentRecovery";
import { findOwningWorkspace } from "../utils/pathUtils";
import { LoadedDocument, TyporaBridgeApi, WebdavConfig, WorkspaceScanResult } from "../types/typora";

export interface DocumentSaveActionsOptions {
  bridge: TyporaBridgeApi | null;
  asyncWriter: TyporaBridgeApi | null;
  doc: LoadedDocument;
  workspace: WorkspaceScanResult | null;
  workspaces: WorkspaceScanResult[];
  webdavConfig: WebdavConfig;
  docKey: string;
  setDoc: Dispatch<SetStateAction<LoadedDocument>>;
  setActiveSampleKey: Dispatch<SetStateAction<"quickstart" | "reference" | null>>;
  setPromptDialog: Dispatch<SetStateAction<PromptDialogState | null>>;
  setHistoryCount: Dispatch<SetStateAction<number>>;
  refreshWorkspace: (path: string, options?: { shallow?: boolean; append?: boolean }) => void;
  pushCurrentDocToWebdav: (showToastAfter?: boolean) => Promise<void>;
  showToast: (message: string) => void;
  docRef: MutableRefObject<LoadedDocument>;
  documentRevisionRef: MutableRefObject<number>;
  persistedContentRef: MutableRefObject<string>;
  persistedPathRef: MutableRefObject<string | null>;
  saveConflictRef: MutableRefObject<boolean>;
  saveInFlightRef: MutableRefObject<Promise<void> | null>;
}

export function useDocumentSaveActions(options: DocumentSaveActionsOptions) {
  const { bridge, asyncWriter, doc, workspace, workspaces, webdavConfig, docKey, setDoc,
    setActiveSampleKey, setPromptDialog, setHistoryCount, refreshWorkspace,
    pushCurrentDocToWebdav: handlePushCurrentDocToWebdav, showToast, docRef,
    documentRevisionRef, persistedContentRef, persistedPathRef, saveConflictRef,
    saveInFlightRef } = options;
  const handleSaveAsDocument = useCallback((onSaved?: () => void) => {
    if (!bridge?.writeDocument) {
      const blob = new Blob([doc.content], {
        type: "text/markdown;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name || "Untitled.md";
      a.click();
      URL.revokeObjectURL(url);
      showToast(`已下载 ${doc.name}`);
      clearDocumentRecovery(localStorage);
      onSaved?.();
      return;
    }

    const chosenPath = bridge.selectSaveFile?.({
      title: "保存 Markdown 文档",
      defaultPath: doc.recoveryNeedsSaveAs ? undefined : (doc.path || `${workspace?.rootDir || doc.dir}/${doc.name}`)
    });

    if (chosenPath) {
      try {
        const saved = bridge.writeDocument(chosenPath, doc.content);
        const savedDoc = { ...doc, path: saved.path, name: saved.name, dir: saved.dir, content: saved.content, isDirty: false, mtimeMs: saved.mtimeMs, recoveryNeedsSaveAs: false, recoveryBaselineKnown: true, recoveryBaselineContent: saved.content, recoveryBaselinePath: saved.path };
        docRef.current = savedDoc;
        documentRevisionRef.current += 1;
        persistedPathRef.current = saved.path;
        persistedContentRef.current = saved.content;
        saveConflictRef.current = false;
        setDoc(savedDoc);
        clearDocumentRecovery(localStorage);
        setActiveSampleKey(null);
        const owner = findOwningWorkspace(workspaces, saved.path);
        if (owner) {
          refreshWorkspace(owner.rootDir, { append: true });
        }
        showToast(`已保存至 ${saved.name}`);
        onSaved?.();
        if (
          webdavConfig.enabled &&
          webdavConfig.autoSyncOnSave &&
          webdavConfig.serverUrl.trim()
        ) {
          void handlePushCurrentDocToWebdav(true);
        }
      } catch (err) {
        showToast(
          `保存失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else if (workspace?.rootDir && bridge.createDocument) {
      setPromptDialog({
        open: true,
        title: "保存文档到当前工作区",
        placeholder: "输入文件名，例如笔记.md",
        initialValue: doc.name || "Untitled.md",
        confirmLabel: "保存",
        onConfirm: (fileName) => {
          try {
            const created = bridge.createDocument(
              workspace.rootDir,
              fileName,
              doc.content
            );
            const savedDoc = { ...doc, path: created.path, name: created.name, dir: created.dir, content: created.content, isDirty: false, mtimeMs: created.mtimeMs, recoveryNeedsSaveAs: false, recoveryBaselineKnown: true, recoveryBaselineContent: created.content, recoveryBaselinePath: created.path };
            docRef.current = savedDoc;
            documentRevisionRef.current += 1;
            persistedPathRef.current = created.path;
            persistedContentRef.current = created.content;
            saveConflictRef.current = false;
            setDoc(savedDoc);
            clearDocumentRecovery(localStorage);
            setActiveSampleKey(null);
            refreshWorkspace(workspace.rootDir);
            showToast(`已保存 ${created.name}`);
            onSaved?.();
            if (
              webdavConfig.enabled &&
              webdavConfig.autoSyncOnSave &&
              webdavConfig.serverUrl.trim()
            ) {
              void handlePushCurrentDocToWebdav(true);
            }
          } catch (err) {
            showToast(
              `保存失败: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      });
    }
  }, [
    bridge,
    doc,
    docRef,
    documentRevisionRef,
    persistedPathRef,
    persistedContentRef,
    saveConflictRef,
    handlePushCurrentDocToWebdav,
    refreshWorkspace,
    showToast,
    webdavConfig.autoSyncOnSave,
    webdavConfig.enabled,
    webdavConfig.serverUrl,
    workspace,
    workspaces
  ]);

  const handleSaveDocument = useCallback(async () => {
    if (docRef.current.recoveryNeedsSaveAs) {
      handleSaveAsDocument();
      return;
    }
    if (doc.path && asyncWriter?.writeDocumentAsync) {
      if (saveInFlightRef.current) await saveInFlightRef.current;
      const current = docRef.current;
      if (!current.path) return;
      const savePath = current.path;
      const saveContent = current.content;
      const revision = documentRevisionRef.current;
      const operation = asyncWriter.writeDocumentAsync(savePath, saveContent, {
        expectedContent: persistedContentRef.current
      }).then((saved) => {
        if (persistedPathRef.current === savePath) persistedContentRef.current = saved.content;
        setDoc((latest) => {
          if (latest.path !== savePath || latest.content !== saveContent || documentRevisionRef.current !== revision) return latest;
          const clean = { ...latest, isDirty: false, mtimeMs: saved.mtimeMs };
          docRef.current = clean;
          return clean;
        });
        showToast(`已保存 ${saved.name}`);
        if (docRef.current.path === savePath && docRef.current.content === saveContent && documentRevisionRef.current === revision) clearDocumentRecovery(localStorage);
        const { list: updated } = recordSnapshot(docKey, current.name, savePath, saveContent, "手动保存文档");
        setHistoryCount(updated.length);
        if (webdavConfig.enabled && webdavConfig.autoSyncOnSave && webdavConfig.serverUrl.trim()) {
          void handlePushCurrentDocToWebdav(true);
        }
      }).catch((error: unknown) => {
        if ((error as { code?: string })?.code === "DOCUMENT_CONFLICT") {
          saveConflictRef.current = true;
          showToast("文件已在外部修改，已取消保存以保护外部内容");
        } else {
          showToast(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }).finally(() => { if (saveInFlightRef.current === operation) saveInFlightRef.current = null; });
      saveInFlightRef.current = operation;
      await operation;
    } else if (
      webdavConfig.enabled &&
      webdavConfig.autoSyncOnSave &&
      webdavConfig.serverUrl.trim() &&
      !workspace?.rootDir
    ) {
      // Allow direct cloud save when WebDAV autoSync is enabled even if no local file path is bound
      void handlePushCurrentDocToWebdav(false);
    } else {
      handleSaveAsDocument();
    }
  }, [
    asyncWriter,
    bridge,
    doc.content,
    doc.path,
    doc.recoveryNeedsSaveAs,
    docRef,
    handlePushCurrentDocToWebdav,
    handleSaveAsDocument,
    showToast,
    webdavConfig.autoSyncOnSave,
    webdavConfig.enabled,
    webdavConfig.serverUrl,
    workspace?.rootDir
  ]);


  return { handleSaveAsDocument, handleSaveDocument };
}
