import React, { useMemo } from "react";
import { AppOverlayLayer } from "./AppOverlayLayer";
import { useAppState } from "../hooks/useAppState";
import { useDocumentNavigation } from "../hooks/useDocumentNavigation";
import { useMarkdownEditorActions } from "../hooks/useMarkdownEditorActions";
import { useExportActions } from "../hooks/useExportActions";
import { useWebdavSync } from "../hooks/useWebdavSync";
import { useDocumentHistory } from "../hooks/useDocumentHistory";
import { LoadedDocument, WorkspaceFileNode, WorkspaceScanResult } from "../types/typora";

type State = ReturnType<typeof useAppState>;
type Webdav = ReturnType<typeof useWebdavSync>;
type Actions = Pick<ReturnType<typeof useDocumentNavigation>, "openLocalFile" | "handleLoadSampleDoc"> &
  Pick<ReturnType<typeof useMarkdownEditorActions>, "handleConfirmInsertTable" | "handleApplyInlineFormat" | "handleConvertBlock" | "handleDeleteBlock" | "handleDeleteSelectedBlocks"> &
  Pick<ReturnType<typeof useExportActions>, "handleCopyAs"> &
  Pick<Webdav, "handleUpdateWebdavConfig" | "handleTestWebdavConnection" | "handleRefreshWebdavFiles" | "handlePushCurrentDocToWebdav" | "handlePullWebdavFile" | "handleDeleteWebdavFile" | "handleSyncWebdavNow"> &
  Pick<ReturnType<typeof useDocumentHistory>, "handleRestoreFromHistory"> &
  { handleTriggerAiAction: (action: string, text?: string) => void };

export const AppOverlayContainer: React.FC<{
  state: State;
  doc: LoadedDocument;
  workspaces: WorkspaceScanResult[];
  webdav: Pick<Webdav, "webdavConfig" | "webdavRemoteFiles" | "webdavSyncState" | "webdavStatusMessage" | "webdavLastSyncAt">;
  actions: Actions & { handleUpdatePreferences: (patch: Partial<State["preferences"]>) => void };
  history: Pick<ReturnType<typeof useDocumentHistory>, "historyModalOpen" | "setHistoryModalOpen" | "handleRestoreFromHistory">;
}> = ({ state, doc, workspaces, webdav, actions, history }) => {
  const allFiles = useMemo(() => {
    const seen = new Set<string>();
    const list: WorkspaceFileNode[] = [];
    const multiFolder = workspaces.length > 1;
    for (const ws of workspaces) {
      for (const file of ws.files) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        list.push(
          multiFolder
            ? { ...file, relativePath: `${ws.rootName}/${file.relativePath}` }
            : file
        );
      }
    }
    return list;
  }, [workspaces]);

  return (
  <AppOverlayLayer
    quickOpen={{ open: state.quickOpenVisible, files: allFiles, onSelectFile: actions.openLocalFile, onSelectSampleDoc: actions.handleLoadSampleDoc, onClose: () => state.setQuickOpenVisible(false) }}
    tableInsert={{ open: state.tableModalOpen, onInsertTable: actions.handleConfirmInsertTable, onClose: () => state.setTableModalOpen(false) }}
    selectionToolbar={{ selectedText: state.selectedAiText, onTriggerAiAction: actions.handleTriggerAiAction, onClose: () => state.setSelectedAiText("") }}
    contextMenu={{
      state: state.contextMenu, readingMode: state.readingMode, selectedText: state.selectedAiText,
      onTriggerAiAction: actions.handleTriggerAiAction,
      onClose: () => state.setContextMenu((prev) => ({ ...prev, open: false })),
      onApplyInlineFormat: actions.handleApplyInlineFormat, onCopyAs: actions.handleCopyAs,
      onConvertBlock: actions.handleConvertBlock, onOpenTableDialog: () => state.setTableModalOpen(true),
      onDeleteBlock: actions.handleDeleteBlock, selectedBlockIds: state.selectedBlockIds,
      onDeleteSelectedBlocks: actions.handleDeleteSelectedBlocks
    }}
    preferences={{
      open: state.preferencesOpen, initialTab: state.preferencesTab, preferences: state.preferences,
      webdavConfig: webdav.webdavConfig, webdavRemoteFiles: webdav.webdavRemoteFiles,
      webdavSyncState: webdav.webdavSyncState, webdavStatusMessage: webdav.webdavStatusMessage || "",
      webdavLastSyncAt: webdav.webdavLastSyncAt, activeDocName: doc.name,
      onUpdatePreferences: actions.handleUpdatePreferences,
      onUpdateWebdavConfig: actions.handleUpdateWebdavConfig,
      onTestWebdavConnection: () => void actions.handleTestWebdavConnection(),
      onRefreshWebdavFiles: () => void actions.handleRefreshWebdavFiles(),
      onPushCurrentDocToWebdav: () => void actions.handlePushCurrentDocToWebdav(false),
      onPullWebdavFile: (name) => void actions.handlePullWebdavFile(name),
      onDeleteWebdavFile: (name) => void actions.handleDeleteWebdavFile(name),
      onSyncWebdavNow: () => void actions.handleSyncWebdavNow(), onClose: () => state.setPreferencesOpen(false)
    }}
    promptDialog={{ state: state.promptDialog, onClose: () => state.setPromptDialog(null) }}
    history={history.historyModalOpen ? {
      open: history.historyModalOpen, docName: doc.name, docPath: doc.path, currentContent: doc.content,
      onClose: () => history.setHistoryModalOpen(false), onRestoreContent: history.handleRestoreFromHistory
    } : null}
  />
  );
};
