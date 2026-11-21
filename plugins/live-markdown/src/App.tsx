import React, { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { AppEditorColumn } from "./components/AppEditorColumn";
import { AppOverlayContainer } from "./components/AppOverlayContainer";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { AppNavigationChrome, AppSidebarRail } from "./components/AppNavigationChrome";
import { getDocStorageKey } from "./core/historyManager";
import {
  computeWordCountStats,
  parseMarkdownDocument
} from "./core/markdownParser";
import { getThemeCss } from "./core/themeStyles";
import { LoadedDocument, PreferencesTab, TyporaBridgeApi, TyporaPreferences } from "./types/typora";
import { useWebdavSync } from "./hooks/useWebdavSync";
import { useDocumentEditing } from "./hooks/useDocumentEditing";
import { useGlobalKeyboardShortcuts } from "./hooks/useGlobalKeyboardShortcuts";
import { useMarkdownEditorActions } from "./hooks/useMarkdownEditorActions";
import { useSidebarFileActions } from "./hooks/useSidebarFileActions";
import { useWorkspaceScanning } from "./hooks/useWorkspaceScanning";
import { useSearchActions } from "./hooks/useSearchActions";
import { useExportActions } from "./hooks/useExportActions";
import { usePluginEntryEvents } from "./hooks/usePluginEntryEvents";
import { useDocumentNavigation } from "./hooks/useDocumentNavigation";
import { useDocumentSaveActions } from "./hooks/useDocumentSaveActions";
import { useDocumentHistory } from "./hooks/useDocumentHistory";
import { useMarkdownCopyTransform } from "./hooks/useMarkdownCopyTransform";
import { useAppState } from "./hooks/useAppState";
import { useNavigationGuard } from "./hooks/useNavigationGuard";
import { useViewModeActions } from "./hooks/useViewModeActions";
import { runGuardedNavigation } from "./core/guardedNavigation";
import { createAiEntryIntent } from "./core/ai/aiEntryIntent";

function getBridge(): TyporaBridgeApi | null {
  if (typeof window === "undefined") return null;
  return window.typoraBridge || window.services || null;
}

export const App: React.FC = () => {
  const bridge = getBridge();
  const appState = useAppState(bridge);
  const {
    preferences, setPreferences, doc, setDoc, activeSampleKey, setActiveSampleKey,
    setUndoStack, setRedoStack, workspaces, setWorkspaces, workspace, setRecentFolders,
    sidebarVisible, setSidebarVisible, setSidebarTab,
    fileViewMode,
    sourceMode, setSourceMode, readingMode, setReadingMode, focusMode, setFocusMode,
    typewriterMode, setTypewriterMode, focusedBlockId, setFocusedBlockId, selectedBlockIds,
    setSelectedBlockIds, lastActiveBlockIdRef, findReplace, setFindReplace, quickOpenVisible,
    setQuickOpenVisible, setTableModalOpen, preferencesOpen, setPreferencesOpen,
    setPreferencesTab, wordCountPopoverOpen, setWordCountPopoverOpen,
    contextMenu, setContextMenu, setPromptDialog, toastMessage, setToastMessage,
    footerModeOpen, setFooterModeOpen, aiAssistantOpen, setAiAssistantOpen, selectedAiText,
    setSelectedAiText, setAiSelectionRevision, aiAssistantInitialAction, setAiAssistantInitialAction, hostAdapter,
    currentViewMode
  } = appState;
  const aiEntrySequence = useRef(0);
  const handleTriggerAiAction = useCallback((actionName: string, textContext?: string) => {
    setSelectedAiText(textContext ?? "");
    setAiAssistantInitialAction(createAiEntryIntent(actionName, ++aiEntrySequence.current));
    setAiAssistantOpen(true);
  }, []);

  const docKey = useMemo(() => getDocStorageKey(doc.path, doc.name), [doc.path, doc.name]);
  const [historyCount, setHistoryCount] = useState(0);

  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  }, []);

  const { handleToggleReadingMode, handleChangeViewMode } = useViewModeActions({
    setSourceMode, setReadingMode, setFocusedBlockId, setSelectedBlockIds, showToast
  });

  const deferredContent = useDeferredValue(doc.content);
  const analysisContent =
    preferences.editorEngine === "cm6" && !readingMode
      ? deferredContent
      : doc.content;
  const parsed = useMemo(
    () => parseMarkdownDocument(analysisContent),
    [analysisContent]
  );
  const stats = useMemo(
    () => computeWordCountStats(analysisContent),
    [analysisContent]
  );

  // Persist preferences
  const handleUpdatePreferences = useCallback(
    (patch: Partial<TyporaPreferences>) => {
      setPreferences((prev) => {
        const next = { ...prev, ...patch };
        try {
          bridge?.savePersistedState?.({ preferences: next });
          localStorage.setItem(
            "typora_ztools_preferences_v1",
            JSON.stringify(next)
          );
        } catch {
          // ignore
        }
        return next;
      });
    },
    [bridge]
  );

  const {
    addWorkspaceFolders,
    refreshWorkspace,
    handleExpandDirectory,
    handleRemoveWorkspaceFolder,
    handleCloseWorkspace
  } = useWorkspaceScanning({
    bridge,
    workspaces,
    setWorkspaces,
    setRecentFolders,
    fileViewMode,
    quickOpenVisible,
    showToast
  });

  const {
    docRef,
    documentRevisionRef,
    aiSelectionRangeRef,
    cm6EditorApiRef,
    persistedContentRef,
    persistedPathRef,
    saveConflictRef,
    saveInFlightRef,
    asyncWriter,
    updateMarkdownContent,
    buildAiDocumentSnapshot,
    applyAiEditProposal, flushPendingSave
  } = useDocumentEditing({
    doc,
    setDoc,
    bridge,
    autoSave: preferences.autoSave,
    editorEngine: preferences.editorEngine || "block",
    sourceMode,
    readingMode,
    activeSampleKey,
    parsedBlocks: parsed.blocks,
    docKey,
    setUndoStack,
    setRedoStack,
    setHistoryCount,
    showToast
  });

  const saveAsActionRef = useRef<(onSaved: () => void) => void>(() => {});
  const saveAsForNavigationGuard = useCallback((onSaved: () => void) => saveAsActionRef.current(onSaved), []);
  const navigationGuard = useNavigationGuard({
    getDocument: () => docRef.current,
    flushPendingSave,
    saveAs: saveAsForNavigationGuard
  });

  const {
    historyModalOpen,
    setHistoryModalOpen,
    handleQuickUndoSnapshot,
    handleRestoreFromHistory,
    handleUndo,
    handleRedo
  } = useDocumentHistory({
    doc,
    docKey,
    setDoc,
    setUndoStack,
    setRedoStack,
    editorEngine: preferences.editorEngine || "block",
    readingMode,
    setHistoryCount,
    docRef,
    documentRevisionRef,
    cm6EditorApiRef,
    updateMarkdownContent,
    showToast
  });

  const {
    openLocalFile,
    handleLoadSampleDoc,
    handleNewDocument,
    handleOpenFileDialog,
    handleOpenFolder,
    handleAddFolders
  } = useDocumentNavigation({
    bridge,
    doc,
    workspace,
    setDoc,
    setActiveSampleKey,
    setUndoStack,
    setRedoStack,
    setFocusedBlockId,
    setSidebarVisible,
    setSidebarTab,
    addWorkspaceFolders,
    showToast,
    beforeNavigate: navigationGuard.beforeNavigate
  });

  // WebDAV Cloud Sync Hook
  const handleAdoptPulledDocument = useCallback(async (nextDoc: LoadedDocument): Promise<boolean> => {
    if (!(await runGuardedNavigation(navigationGuard.beforeNavigate, () => undefined))) return false;
    setDoc(nextDoc);
    setActiveSampleKey(null);
    setUndoStack([]);
    setRedoStack([]);
    setFocusedBlockId(null);
    return true;
  }, [navigationGuard.beforeNavigate]);

  const handleOpenPreferencesTab = useCallback((tab: PreferencesTab) => {
    setPreferencesTab(tab);
    setPreferencesOpen(true);
  }, []);

  const {
    webdavConfig,
    webdavSyncState,
    webdavStatusMessage,
    webdavLastSyncAt,
    webdavRemoteFiles,
    handleUpdateWebdavConfig,
    handleOpenWebdavSettings,
    handleRefreshWebdavFiles,
    handleTestWebdavConnection,
    handlePushCurrentDocToWebdav,
    handlePullWebdavFile,
    handleDeleteWebdavFile,
    handleSyncWebdavNow
  } = useWebdavSync({
    bridge,
    doc,
    workspace,
    preferencesOpen,
    sidebarVisible,
    refreshWorkspace,
    openLocalFile,
    onAdoptPulledDocument: handleAdoptPulledDocument,
    onOpenPreferencesTab: handleOpenPreferencesTab,
    showToast
  });

  const { handleSaveAsDocument, handleSaveDocument } = useDocumentSaveActions({
    bridge,
    asyncWriter,
    doc,
    workspace,
    workspaces,
    webdavConfig,
    docKey,
    setDoc,
    setActiveSampleKey,
    setPromptDialog,
    setHistoryCount,
    refreshWorkspace,
    pushCurrentDocToWebdav: handlePushCurrentDocToWebdav,
    showToast,
    docRef,
    documentRevisionRef,
    persistedContentRef,
    persistedPathRef,
    saveConflictRef,
    saveInFlightRef
  });

  saveAsActionRef.current = handleSaveAsDocument;

  usePluginEntryEvents({
    bridge,
    newDocument: handleNewDocument,
    loadSampleDoc: handleLoadSampleDoc,
    openPreferences: () => setPreferencesOpen(true),
    openFolder: (path) => handleOpenFolder(path),
    openLocalFile
  });

  const {
    handleUpdateBlock,
    handleReplaceBlockWithRaw,
    handleInsertBlockAfter,
    handleExitListAndInsertBlockAfter,
    handleDeleteBlock,
    handleDeleteSelectedBlocks,
    handleConvertBlock,
    handleInsertBlock,
    handleConfirmInsertTable,
    handleApplyInlineFormat,
    handleInsertLocalImage,
    handlePasteImageDataUrl
  } = useMarkdownEditorActions({
    doc,
    parsedBlocks: parsed.blocks,
    bridge,
    preferences,
    focusedBlockId,
    selectedBlockIds,
    lastActiveBlockIdRef,
    setFocusedBlockId,
    setSelectedBlockIds,
    setTableModalOpen,
    updateMarkdownContent,
    showToast
  });

  const {
    handleCreateFileInFolder,
    handleCreateSubfolder,
    handleRenameEntry,
    handleDuplicateFile,
    handleDeleteEntry
  } = useSidebarFileActions({
    bridge,
    doc,
    setDoc,
    workspaces,
    refreshWorkspace,
    expandDirectory: handleExpandDirectory,
    openLocalFile,
    newDocument: handleNewDocument,
    setPromptDialog,
    showToast,
    flushPendingSave
  });

  // Jump to heading block from Outline or TOC
  const handleJumpToHeading = useCallback(
    (blockId: string) => {
      if (sourceMode) {
        setSourceMode(false);
      }
      setTimeout(() => {
        const el =
          document.getElementById(blockId) ||
          document.querySelector(`[data-block-id="${blockId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 30);
    },
    [sourceMode]
  );

  const { docMatches, handleRunWorkspaceSearch, handleReplaceCurrent, handleReplaceAll } = useSearchActions({
    bridge,
    workspaces,
    doc,
    findReplace,
    updateMarkdownContent,
    showToast
  });

  const { handleExportHtml, handlePrintPdf, handleCopyAs } = useExportActions({
    doc,
    parsed,
    preferences,
    bridge,
    workspace,
    showToast
  });

  useMarkdownCopyTransform({
    docPath: doc.path,
    blocks: parsed.blocks,
    yamlRootUrl: parsed.yamlMeta["typora-root-url"],
    copyImagesAsAbsolute: preferences.copyImagesAsAbsolute !== false
  });

  useGlobalKeyboardShortcuts({
    blocks: parsed.blocks,
    readingMode,
    selectedBlockIds,
    setFocusedBlockId,
    setSelectedBlockIds,
    deleteSelectedBlocks: handleDeleteSelectedBlocks,
    deleteBlock: handleDeleteBlock,
    replaceBlockWithRaw: handleReplaceBlockWithRaw,
    updateMarkdownContent,
    undo: handleUndo,
    redo: handleRedo,
    toggleReadingMode: handleToggleReadingMode,
    quickUndoSnapshot: handleQuickUndoSnapshot,
    setHistoryModalOpen,
    setQuickOpenVisible,
    setFindReplace,
    saveAsDocument: handleSaveAsDocument,
    saveDocument: handleSaveDocument,
    newDocument: handleNewDocument,
    openFileDialog: handleOpenFileDialog,
    setPreferencesOpen,
    setFocusMode,
    setTypewriterMode,
    setReadingMode,
    setSourceMode,
    setSidebarVisible,
    convertBlock: handleConvertBlock,
    setTableModalOpen,
    insertBlock: handleInsertBlock,
    applyInlineFormat: handleApplyInlineFormat,
    showToast
  });

  // Dynamic CSS injection for the active Typora theme + user font size / line width
  const dynamicThemeCss = useMemo(() => {
    const baseTheme = getThemeCss(preferences.theme);
    const maxWidthValue =
      preferences.lineWidth === "wide"
        ? "1120px"
        : preferences.lineWidth === "full"
        ? "100%"
        : "860px";
    return `${baseTheme}\n#write { font-size: ${preferences.fontSize}px; max-width: ${maxWidthValue}; }`;
  }, [preferences.fontSize, preferences.lineWidth, preferences.theme]);

  const navigationActions = {
    handleChangeViewMode, handleToggleReadingMode, handleUpdatePreferences,
    handleQuickUndoSnapshot, handleNewDocument, handleOpenFileDialog, handleOpenFolder, handleAddFolders,
    handleSaveDocument, handleSaveAsDocument, handleOpenWebdavSettings,
    handleSyncWebdavNow, handlePushCurrentDocToWebdav, handleExportHtml, handlePrintPdf,
    handleCopyAs, handleUndo, handleRedo, handleConvertBlock, handleInsertBlock,
    handleApplyInlineFormat, handleInsertLocalImage, handleLoadSampleDoc,
    handleOpenLocalFile: openLocalFile, handleExpandDirectory,
    handleCloseWorkspace, handleRemoveWorkspaceFolder, handleCreateFileInFolder,
    handleCreateSubfolder, handleRenameEntry, handleDuplicateFile, handleDeleteEntry,
    handleJumpToHeading, handleRunWorkspaceSearch, handlePullWebdavFile, handleUpdateWebdavConfig,
    handleTestWebdavConnection, handleRefreshWebdavFiles, handleDeleteWebdavFile, showToast,
    handleConfirmInsertTable, handleRestoreFromHistory, handleDeleteBlock, handleDeleteSelectedBlocks, openLocalFile, handleTriggerAiAction
  };

  return (
    <div
      className={`typora-workbench theme-${preferences.theme} ${
        focusMode ? "ty-focus-mode" : ""
      } ${typewriterMode ? "ty-typewriter-mode" : ""} ${
        readingMode ? "ty-reading-mode" : ""
      } ${
        sidebarVisible ? "ty-with-sidebar" : "ty-no-sidebar"
      }`}
      onClick={() => {
        if (wordCountPopoverOpen) setWordCountPopoverOpen(false);
        if (footerModeOpen) setFooterModeOpen(false);
      }}
    >
      <style>{dynamicThemeCss}</style>

      <AppNavigationChrome state={appState} bridge={bridge} parsed={parsed} historyCount={historyCount} actions={navigationActions} webdav={{ config: webdavConfig, syncState: webdavSyncState, remoteFiles: webdavRemoteFiles }} cm6EditorApiRef={cm6EditorApiRef} setHistoryModalOpen={setHistoryModalOpen} />

      {/* Main Workspace Area: Sidebar + Content Surface */}
      <div className="ty-main-body">
        <AppSidebarRail state={appState} bridge={bridge} parsed={parsed} actions={navigationActions} webdav={{ config: webdavConfig, syncState: webdavSyncState, remoteFiles: webdavRemoteFiles }} cm6EditorApiRef={cm6EditorApiRef} setHistoryModalOpen={setHistoryModalOpen} historyCount={historyCount} />
        <AppEditorColumn
          doc={doc}
          parsed={parsed}
          preferences={preferences}
          bridge={bridge}
          editorActions={{ handleUpdateBlock, handleReplaceBlockWithRaw, handleInsertBlockAfter, handleExitListAndInsertBlockAfter, handleDeleteBlock, handleDeleteSelectedBlocks, handlePasteImageDataUrl }}
          historyActions={{ handleUndo, handleRedo }}
          documentActions={{ updateMarkdownContent, buildAiDocumentSnapshot, applyAiEditProposal }}
          uiState={{ findReplace, selectedBlockIds, focusedBlockId, sourceMode, readingMode, typewriterMode, aiAssistantOpen, aiAssistantInitialAction, selectedAiText, contextMenu, footerModeOpen, toastMessage, focusMode, wordCountPopoverOpen }}
          uiSetters={{ setFindReplace, setFocusedBlockId, setSelectedBlockIds, setSelectedAiText, setAiSelectionRevision, setContextMenu, setAiAssistantOpen, setAiAssistantInitialAction, setFooterModeOpen, setFocusMode, setWordCountPopoverOpen }}
          actions={{ handleJumpToHeading, handleTriggerAiAction, handleSaveDocument, handleOpenFolder, handleSyncWebdavNow, handleOpenWebdavSettings, handleReplaceCurrent, handleReplaceAll }}
          sidebarVisible={sidebarVisible}
          workspaces={workspaces}
          webdav={{ webdavConfig, webdavSyncState, webdavStatusMessage }}
          editor={{ cm6EditorApiRef, aiSelectionRangeRef }}
          stats={stats}
          currentViewMode={currentViewMode}
          docMatches={docMatches}
          appStateExtras={{ hostAdapter, setSidebarVisible, setTypewriterMode }}
          onChangeViewMode={handleChangeViewMode}
        />
      </div>

      <AppOverlayContainer
        state={appState}
        doc={doc}
        workspaces={workspaces}
        webdav={{ webdavConfig, webdavRemoteFiles, webdavSyncState, webdavStatusMessage, webdavLastSyncAt }}
        actions={navigationActions}
        history={{ historyModalOpen, setHistoryModalOpen, handleRestoreFromHistory }}
      />
      <UnsavedChangesDialog
        open={navigationGuard.open}
        onSave={navigationGuard.saveAndContinue}
        onDiscard={navigationGuard.discardAndContinue}
        onCancel={navigationGuard.cancel}
      />
    </div>
  );
};
