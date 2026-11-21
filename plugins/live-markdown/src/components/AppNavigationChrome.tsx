import React from "react";
import { Sidebar } from "./Sidebar";
import { TopMenuBar } from "./TopMenuBar";
import { ParsedMarkdownDocument } from "../core/markdownParser";
import { OutlineItem } from "../types/typora";
import { useAppState } from "../hooks/useAppState";
import { useDocumentNavigation } from "../hooks/useDocumentNavigation";
import { useDocumentHistory } from "../hooks/useDocumentHistory";
import { useDocumentSaveActions } from "../hooks/useDocumentSaveActions";
import { useWebdavSync } from "../hooks/useWebdavSync";
import { useMarkdownEditorActions } from "../hooks/useMarkdownEditorActions";
import { useSidebarFileActions } from "../hooks/useSidebarFileActions";
import { useWorkspaceScanning } from "../hooks/useWorkspaceScanning";
import { useSearchActions } from "../hooks/useSearchActions";
import { useExportActions } from "../hooks/useExportActions";
import { TyporaBridgeApi, TyporaPreferences, ThemeName, WebdavConfig, WebdavRemoteFile } from "../types/typora";

type State = ReturnType<typeof useAppState>;
type Actions = Pick<ReturnType<typeof useDocumentNavigation>, "handleNewDocument" | "handleOpenFileDialog" | "handleOpenFolder" | "handleAddFolders" | "handleLoadSampleDoc"> &
  Pick<ReturnType<typeof useDocumentHistory>, "handleQuickUndoSnapshot" | "handleUndo" | "handleRedo"> &
  Pick<ReturnType<typeof useDocumentSaveActions>, "handleSaveDocument" | "handleSaveAsDocument"> &
  Pick<ReturnType<typeof useWebdavSync>, "handleOpenWebdavSettings" | "handleSyncWebdavNow" | "handlePushCurrentDocToWebdav" | "handlePullWebdavFile"> &
  Pick<ReturnType<typeof useMarkdownEditorActions>, "handleConvertBlock" | "handleInsertBlock" | "handleApplyInlineFormat" | "handleInsertLocalImage"> &
  Pick<ReturnType<typeof useSidebarFileActions>, "handleCreateFileInFolder" | "handleCreateSubfolder" | "handleRenameEntry" | "handleDuplicateFile" | "handleDeleteEntry"> &
  Pick<ReturnType<typeof useWorkspaceScanning>, "handleExpandDirectory" | "handleRemoveWorkspaceFolder" | "handleCloseWorkspace"> &
  Pick<ReturnType<typeof useSearchActions>, "handleRunWorkspaceSearch"> &
  Pick<ReturnType<typeof useExportActions>, "handleExportHtml" | "handlePrintPdf" | "handleCopyAs"> &
  { handleChangeViewMode: (mode: "live" | "source" | "reading") => void; handleToggleReadingMode: () => void;
    handleUpdatePreferences: (patch: Partial<TyporaPreferences>) => void; handleJumpToHeading: (id: string) => void;
    handleOpenLocalFile: (path: string) => void; showToast: (message: string) => void };
type Props = { state: State; bridge: TyporaBridgeApi | null; parsed: ParsedMarkdownDocument & { outline: OutlineItem[] }; historyCount: number; actions: Actions; webdav: { config: WebdavConfig; syncState: "idle" | "testing" | "error" | "syncing" | "success"; remoteFiles: WebdavRemoteFile[] }; cm6EditorApiRef: React.MutableRefObject<{ canUndo(): boolean; canRedo(): boolean } | null>; setHistoryModalOpen: (open: boolean) => void };

export const AppNavigationChrome: React.FC<Props> = ({ state, historyCount, actions, webdav, cm6EditorApiRef, setHistoryModalOpen }) => {
  const { doc, preferences, sidebarVisible, sourceMode, readingMode, focusMode, typewriterMode, currentViewMode, undoStack, redoStack, workspaces, setSidebarVisible, setReadingMode, setSourceMode, setFocusMode, setTypewriterMode, setPreferencesTab, setPreferencesOpen, setQuickOpenVisible, setFindReplace, setTableModalOpen, setAiAssistantOpen } = state;
  const { handleChangeViewMode, handleToggleReadingMode, handleUpdatePreferences, handleQuickUndoSnapshot, handleNewDocument, handleOpenFileDialog, handleOpenFolder, handleAddFolders, handleCloseWorkspace, handleSaveDocument, handleSaveAsDocument, handleOpenWebdavSettings, handleSyncWebdavNow, handlePushCurrentDocToWebdav, handleExportHtml, handlePrintPdf, handleCopyAs, handleUndo, handleRedo, handleConvertBlock, handleInsertBlock, handleApplyInlineFormat, handleInsertLocalImage, handleLoadSampleDoc } = actions;
  return <TopMenuBar
    docName={doc.name} isDirty={doc.isDirty} sidebarVisible={sidebarVisible} sourceMode={sourceMode} readingMode={readingMode}
    viewMode={currentViewMode} onChangeViewMode={handleChangeViewMode} focusMode={focusMode} typewriterMode={typewriterMode}
    activeTheme={preferences.theme} canUndo={!readingMode && (!sourceMode && preferences.editorEngine === "cm6" ? Boolean(cm6EditorApiRef.current?.canUndo()) : undoStack.length > 0)}
    canRedo={!readingMode && (!sourceMode && preferences.editorEngine === "cm6" ? Boolean(cm6EditorApiRef.current?.canRedo()) : redoStack.length > 0)}
    onOpenHistory={() => setHistoryModalOpen(true)} onQuickUndoSnapshot={handleQuickUndoSnapshot} historyCount={historyCount}
    webdavEnabled={webdav.config.enabled} webdavSyncState={webdav.syncState}
    onToggleSidebar={() => setSidebarVisible((v) => !v)} onToggleSourceMode={() => { if (readingMode) setReadingMode(false); setSourceMode((v) => !v); }}
    onToggleReadingMode={handleToggleReadingMode} onToggleFocusMode={() => setFocusMode((v) => !v)} onToggleTypewriterMode={() => setTypewriterMode((v) => !v)}
    onSelectTheme={(theme: ThemeName) => handleUpdatePreferences({ theme })} onNewDocument={handleNewDocument} onOpenFile={handleOpenFileDialog}
    onOpenFolder={() => handleOpenFolder(undefined, false)} onAddFolders={handleAddFolders} onCloseWorkspace={handleCloseWorkspace} workspaceCount={workspaces.length} onSaveDocument={handleSaveDocument} onSaveAsDocument={handleSaveAsDocument}
    onOpenQuickOpen={() => setQuickOpenVisible(true)} onOpenFindReplace={(showReplace) => setFindReplace((prev) => ({ ...prev, open: true, showReplace }))}
    onOpenTableDialog={() => setTableModalOpen(true)} onOpenPreferences={() => { setPreferencesTab("appearance"); setPreferencesOpen(true); }}
    onOpenWebdavSettings={handleOpenWebdavSettings} onSyncWebdavNow={() => void handleSyncWebdavNow()} onPushCurrentDocToWebdav={() => void handlePushCurrentDocToWebdav(false)}
    onExportHtml={handleExportHtml} onPrintPdf={handlePrintPdf} onCopyAs={handleCopyAs} onUndo={handleUndo} onRedo={handleRedo}
    onConvertBlock={handleConvertBlock} onInsertBlock={handleInsertBlock} onApplyInlineFormat={handleApplyInlineFormat} onInsertLocalImage={handleInsertLocalImage}
    onLoadSampleDoc={handleLoadSampleDoc} editorEngine={preferences.editorEngine || "block"}
    onChangeEditorEngine={(engine) => handleUpdatePreferences({ editorEngine: engine })} onToggleAiCopilot={() => setAiAssistantOpen((v) => !v)} isAiCopilotOpen={state.aiAssistantOpen}
  />;
};

export const AppSidebarRail: React.FC<Props> = ({ state, bridge, parsed, actions, webdav }) => {
  const { sidebarVisible, sidebarWidth, sidebarTab, fileViewMode, sortField, sortDirection, workspaces, doc, focusedBlockId, recentFolders, setSidebarWidth, setSidebarTab, setFileViewMode, setSortField, setSortDirection } = state;
  const { handleOpenLocalFile, handleOpenFolder, handleAddFolders, handleExpandDirectory, handleRemoveWorkspaceFolder, handleCreateFileInFolder, handleCreateSubfolder, handleRenameEntry, handleDuplicateFile, handleDeleteEntry, handleJumpToHeading, handleRunWorkspaceSearch, handleSyncWebdavNow, handlePushCurrentDocToWebdav, handlePullWebdavFile, handleOpenWebdavSettings } = actions;
  if (!sidebarVisible) return null;
  return <>
    <Sidebar width={sidebarWidth} activeTab={sidebarTab} fileViewMode={fileViewMode} sortField={sortField} sortDirection={sortDirection}
      workspaces={workspaces} activeFilePath={doc.path} outline={parsed.outline}
      activeHeadingBlockId={focusedBlockId} recentFolders={recentFolders} webdavEnabled={webdav.config.enabled} webdavSyncState={webdav.syncState} webdavRemoteFiles={webdav.remoteFiles}
      onChangeTab={setSidebarTab} onChangeFileViewMode={setFileViewMode} onChangeSort={(f, d) => { setSortField(f); setSortDirection(d); }}
      onSelectFile={handleOpenLocalFile} onOpenFolder={handleOpenFolder} onAddFolder={handleAddFolders} onExpandDirectory={handleExpandDirectory}
      onRemoveWorkspaceFolder={handleRemoveWorkspaceFolder} onCreateFileInFolder={handleCreateFileInFolder}
      onCreateSubfolder={handleCreateSubfolder} onRenameEntry={handleRenameEntry} onDuplicateFile={handleDuplicateFile} onDeleteEntry={handleDeleteEntry}
      onRevealInFinder={(path) => bridge?.revealInFinder?.(path)} onJumpToHeading={handleJumpToHeading} onRunWorkspaceSearch={handleRunWorkspaceSearch}
      onSyncWebdavNow={() => void handleSyncWebdavNow()} onPushCurrentDocToWebdav={() => void handlePushCurrentDocToWebdav(false)}
      onPullWebdavFile={(name) => void handlePullWebdavFile(name)} onOpenWebdavSettings={handleOpenWebdavSettings} />
    <div className="ty-sidebar-resizer" title="拖拽调整侧边栏宽度" onMouseDown={(e) => {
      e.preventDefault(); const startX = e.clientX; const startWidth = sidebarWidth;
      const onMove = (event: MouseEvent) => setSidebarWidth(Math.max(200, Math.min(440, startWidth + event.clientX - startX)));
      const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    }} />
  </>;
};
