import React from "react";
import { ReadingImageBoundary } from "./ReadingImageBoundary";
import { FindReplacePanel } from "./FloatingPanels";
import { LivePreviewEditor } from "./LivePreviewEditor";
import { CM6LivePreviewEditor, CM6EditorApi } from "./CM6LivePreviewEditor";
import { CM6HistorySnapshot, isCM6HistorySnapshotFor } from "../core/cm6/historySnapshot";
import { TyporaAiAssistant } from "./TyporaAiAssistant";
import { AppFooterStatusBar } from "./AppFooterStatusBar";
import { LoadedDocument, TyporaBridgeApi, TyporaPreferences, WordCountStats, WorkspaceScanResult } from "../types/typora";
import { parseMarkdownDocument } from "../core/markdownParser";
import { useAppState } from "../hooks/useAppState";
import { useMarkdownEditorActions } from "../hooks/useMarkdownEditorActions";
import { useDocumentEditing } from "../hooks/useDocumentEditing";
import { useDocumentHistory } from "../hooks/useDocumentHistory";
import { useDocumentNavigation } from "../hooks/useDocumentNavigation";
import { useDocumentSaveActions } from "../hooks/useDocumentSaveActions";
import { useSearchActions } from "../hooks/useSearchActions";
import { useWebdavSync } from "../hooks/useWebdavSync";

type EditorActions = Pick<ReturnType<typeof useMarkdownEditorActions>,
  "handleUpdateBlock" | "handleReplaceBlockWithRaw" | "handleInsertBlockAfter" |
  "handleExitListAndInsertBlockAfter" | "handleDeleteBlock" | "handleDeleteSelectedBlocks" |
  "handlePasteImageDataUrl">;
type AppState = ReturnType<typeof useAppState>;
type WebdavActions = ReturnType<typeof useWebdavSync>;
type Props = {
  doc: LoadedDocument;
  parsed: ReturnType<typeof parseMarkdownDocument>;
  preferences: TyporaPreferences;
  bridge: TyporaBridgeApi | null;
  editorActions: EditorActions;
  historyActions: Pick<ReturnType<typeof useDocumentHistory>, "handleUndo" | "handleRedo">;
  documentActions: Pick<ReturnType<typeof useDocumentEditing>, "updateMarkdownContent" | "buildAiDocumentSnapshot" | "applyAiEditProposal">;
  uiState: Pick<AppState, "findReplace" | "selectedBlockIds" | "focusedBlockId" | "sourceMode" | "readingMode" | "typewriterMode" | "aiAssistantOpen" | "aiAssistantInitialAction" | "selectedAiText" | "contextMenu" | "footerModeOpen" | "toastMessage" | "focusMode" | "wordCountPopoverOpen">;
  uiSetters: Pick<AppState, "setFindReplace" | "setFocusedBlockId" | "setSelectedBlockIds" | "setSelectedAiText" | "setAiSelectionRevision" | "setContextMenu" | "setAiAssistantOpen" | "setAiAssistantInitialAction" | "setFooterModeOpen" | "setFocusMode" | "setWordCountPopoverOpen">;
  actions: Pick<ReturnType<typeof useDocumentNavigation>, "handleOpenFolder"> &
    Pick<ReturnType<typeof useDocumentSaveActions>, "handleSaveDocument"> &
    Pick<ReturnType<typeof useSearchActions>, "handleReplaceCurrent" | "handleReplaceAll"> &
    Pick<WebdavActions, "handleSyncWebdavNow" | "handleOpenWebdavSettings"> &
    { handleJumpToHeading: (id: string) => void; handleTriggerAiAction: (action: string, text?: string) => void };
  sidebarVisible: boolean;
  workspaces: WorkspaceScanResult[];
  webdav: Pick<WebdavActions, "webdavConfig" | "webdavSyncState" | "webdavStatusMessage">;
  editor: { cm6EditorApiRef: React.MutableRefObject<CM6EditorApi | null>; aiSelectionRangeRef: React.MutableRefObject<{ from: number; to: number } | null> };
  stats: WordCountStats;
  docMatches: ReturnType<typeof useSearchActions>["docMatches"];
  currentViewMode: "live" | "source" | "reading";
  appStateExtras: Pick<AppState, "hostAdapter" | "setSidebarVisible" | "setTypewriterMode">;
  onChangeViewMode: (mode: "live" | "source" | "reading") => void;
};

export const AppEditorColumn: React.FC<Props> = (props) => {
  const { doc, parsed, preferences, bridge, editorActions: ea, historyActions: ha, documentActions: da, uiState: s, uiSetters: set, actions: act, workspaces, webdav, editor, stats, currentViewMode, docMatches, appStateExtras, onChangeViewMode } = props;
  const { findReplace, selectedBlockIds, focusedBlockId, sourceMode, readingMode, typewriterMode, aiAssistantOpen, aiAssistantInitialAction, selectedAiText, footerModeOpen, toastMessage, focusMode, wordCountPopoverOpen } = s;
  const { setFindReplace, setFocusedBlockId, setSelectedBlockIds, setSelectedAiText, setAiSelectionRevision, setContextMenu, setAiAssistantOpen, setAiAssistantInitialAction, setFooterModeOpen, setFocusMode, setWordCountPopoverOpen } = set;
  const { webdavConfig, webdavSyncState } = webdav;
  const { handleUndo, handleRedo } = ha;
  const { updateMarkdownContent, buildAiDocumentSnapshot, applyAiEditProposal } = da;
  const { cm6EditorApiRef, aiSelectionRangeRef } = editor;
  const { handleJumpToHeading, handleTriggerAiAction, handleSaveDocument, handleOpenFolder, handleSyncWebdavNow, handleOpenWebdavSettings, handleReplaceCurrent, handleReplaceAll } = act;
  const { handleUpdateBlock, handleReplaceBlockWithRaw, handleInsertBlockAfter, handleExitListAndInsertBlockAfter, handleDeleteBlock, handleDeleteSelectedBlocks, handlePasteImageDataUrl } = ea;
  const { hostAdapter, setSidebarVisible, setTypewriterMode } = appStateExtras;
  const editorDocumentId = doc.documentId || (doc.path ? `file:${doc.path}` : `draft:${doc.name}:${doc.mtimeMs}`);
  const cm6HistorySnapshotRef = React.useRef<CM6HistorySnapshot | null>(null);
  if (!isCM6HistorySnapshotFor(cm6HistorySnapshotRef.current, editorDocumentId, doc.content)) {
    cm6HistorySnapshotRef.current = null;
  }

  return (
        <div className="ty-editor-column">
          {/* Find & Replace Floating Bar (#md-searchpanel) */}
          <FindReplacePanel
            open={findReplace.open}
            showReplace={findReplace.showReplace}
            query={findReplace.query}
            replaceText={findReplace.replaceText}
            caseSensitive={findReplace.caseSensitive}
            wholeWord={findReplace.wholeWord}
            isRegex={findReplace.isRegex}
            matchCount={docMatches.length}
            activeMatchIndex={findReplace.activeMatchIndex}
            onChangeQuery={(q) =>
              setFindReplace((prev) => ({
                ...prev,
                query: q,
                activeMatchIndex: 0
              }))
            }
            onChangeReplaceText={(r) =>
              setFindReplace((prev) => ({ ...prev, replaceText: r }))
            }
            onToggleReplaceMode={() =>
              setFindReplace((prev) => ({
                ...prev,
                showReplace: !prev.showReplace
              }))
            }
            onToggleCaseSensitive={() =>
              setFindReplace((prev) => ({
                ...prev,
                caseSensitive: !prev.caseSensitive
              }))
            }
            onToggleWholeWord={() =>
              setFindReplace((prev) => ({
                ...prev,
                wholeWord: !prev.wholeWord
              }))
            }
            onToggleRegex={() =>
              setFindReplace((prev) => ({
                ...prev,
                isRegex: !prev.isRegex
              }))
            }
            onNextMatch={() =>
              setFindReplace((prev) => ({
                ...prev,
                activeMatchIndex:
                  docMatches.length > 0
                    ? (prev.activeMatchIndex + 1) % docMatches.length
                    : 0
              }))
            }
            onPrevMatch={() =>
              setFindReplace((prev) => ({
                ...prev,
                activeMatchIndex:
                  docMatches.length > 0
                    ? (prev.activeMatchIndex - 1 + docMatches.length) %
                      docMatches.length
                    : 0
              }))
            }
            onReplaceCurrent={handleReplaceCurrent}
            onReplaceAll={handleReplaceAll}
            onClose={() =>
              setFindReplace((prev) => ({ ...prev, open: false }))
            }
          />

          {/* Seamless Live Preview / Source Code Editor */}
          <ReadingImageBoundary active={readingMode && !sourceMode} documentId={editorDocumentId} content={doc.content}>
          {!sourceMode && !readingMode && preferences.editorEngine === "cm6" ? (
            <CM6LivePreviewEditor
              key={editorDocumentId}
              documentId={editorDocumentId}
              markdown={doc.content}
              historySnapshot={cm6HistorySnapshotRef.current}
              onHistorySnapshot={(snapshot) => {
                cm6HistorySnapshotRef.current = snapshot && isCM6HistorySnapshotFor(snapshot, editorDocumentId, doc.content) ? snapshot : null;
              }}
              preferences={preferences}
              docPath={doc.path}
              readingMode={readingMode}
              typewriterMode={typewriterMode}
              searchHighlight={findReplace.open ? findReplace.query : ""}
              onChangeFullMarkdown={(next) => updateMarkdownContent(next, false)}
              onAiSelectionRangeChange={(range) => { aiSelectionRangeRef.current = range; setAiSelectionRevision((revision) => revision + 1); }}
              onAiEditorApiChange={(api) => { cm6EditorApiRef.current = api; }}
              onOpenLink={(url) => {
                if (url.startsWith("#")) {
                  const slug = url.slice(1);
                  const h = parsed.outline.find((item) => item.slug === slug);
                  if (h) handleJumpToHeading(h.blockId);
                  return;
                }
                bridge?.openExternalUrl?.(url);
              }}
              onContextMenuRequest={(e, _pos) => {
                e.preventDefault();
                setContextMenu({
                  open: true,
                  x: e.clientX,
                  y: e.clientY,
                  blockId: null
                });
              }}
              onSelectionChange={(sel) => setSelectedAiText(sel)}
              onTriggerAiAction={handleTriggerAiAction}
            />
          ) : (
            <LivePreviewEditor
              markdown={doc.content}
              blocks={parsed.blocks}
              outline={parsed.outline}
              yamlMeta={parsed.yamlMeta}
              refLinks={parsed.refLinks}
              footnotes={parsed.footnotes}
              focusedBlockId={focusedBlockId}
              sourceMode={sourceMode}
              readingMode={readingMode}
              typewriterMode={typewriterMode}
              searchHighlight={findReplace.open ? findReplace.query : ""}
              docPath={doc.path}
              preferences={preferences}
              onFocusBlock={setFocusedBlockId}
              onUpdateBlock={handleUpdateBlock}
              onReplaceBlockWithRaw={handleReplaceBlockWithRaw}
              onInsertBlockAfter={handleInsertBlockAfter}
              onExitListAndInsertBlockAfter={handleExitListAndInsertBlockAfter}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onDeleteBlock={handleDeleteBlock}
              onChangeFullMarkdown={(next) => updateMarkdownContent(next)}
              onOpenLink={(url) => {
                if (url.startsWith("#")) {
                  const slug = url.slice(1);
                  const h = parsed.outline.find((item) => item.slug === slug);
                  if (h) handleJumpToHeading(h.blockId);
                  return;
                }
                bridge?.openExternalUrl?.(url);
              }}
              onJumpToHeading={handleJumpToHeading}
              onContextMenuRequest={(e, blockId) => {
                e.preventDefault();
                const target = e.target as HTMLElement | null;
                if (target instanceof HTMLTextAreaElement) {
                  const start = target.selectionStart ?? 0;
                  const end = target.selectionEnd ?? 0;
                  if (start !== end) {
                    const sel = target.value.substring(start, end).trim();
                    if (sel) setSelectedAiText(sel);
                  }
                } else {
                  const winSel = window.getSelection()?.toString().trim();
                  if (winSel) setSelectedAiText(winSel);
                }
                setContextMenu({
                  open: true,
                  x: e.clientX,
                  y: e.clientY,
                  blockId
                });
              }}
              onPasteImageDataUrl={handlePasteImageDataUrl}
              selectedBlockIds={selectedBlockIds}
              onSelectBlocks={setSelectedBlockIds}
              onTriggerAiAction={handleTriggerAiAction}
            />
          )}

          </ReadingImageBoundary>

          {/* AI Copilot & Skills Drawer */}
          <TyporaAiAssistant
            isOpen={aiAssistantOpen}
            onClose={() => {
              setAiAssistantOpen(false);
              setAiAssistantInitialAction(null);
              setSelectedAiText("");
            }}
            currentDocumentContent={doc.content}
            selectedText={selectedAiText}
            documentSnapshot={buildAiDocumentSnapshot()}
            onApplyEdit={applyAiEditProposal}
            onClearSelection={() => {
              setSelectedAiText("");
              setAiSelectionRevision((revision) => revision + 1);
            }}
            hostAdapter={hostAdapter}
            initialAction={aiAssistantInitialAction}
            onInsertText={(text, mode) => {
              applyAiEditProposal({ snapshot: buildAiDocumentSnapshot(), text, mode });
            }}
          />

          <AppFooterStatusBar
            sidebarVisible={props.sidebarVisible}
            onToggleSidebar={() => setSidebarVisible((v) => !v)}
            currentViewMode={currentViewMode}
            footerModeOpen={footerModeOpen}
            setFooterModeOpen={setFooterModeOpen}
            onChangeViewMode={onChangeViewMode}
            workspaces={workspaces}
            onOpenFolder={() => handleOpenFolder()}
            webdavEnabled={webdavConfig.enabled}
            webdavHasServer={Boolean(webdavConfig.serverUrl.trim())}
            webdavSyncState={webdavSyncState}
            webdavStatusMessage={webdav.webdavStatusMessage || ""}
            onSyncWebdav={() => void handleSyncWebdavNow()}
            onOpenWebdavSettings={handleOpenWebdavSettings}
            selectedBlockCount={selectedBlockIds.length}
            onDeleteSelectedBlocks={() => handleDeleteSelectedBlocks()}
            onClearSelectedBlocks={() => { setSelectedBlockIds([]); window.getSelection()?.removeAllRanges(); }}
            toastMessage={toastMessage}
            focusMode={focusMode}
            onToggleFocusMode={() => setFocusMode((f) => !f)}
            typewriterMode={typewriterMode}
            onToggleTypewriterMode={() => setTypewriterMode((t) => !t)}
            isDirty={doc.isDirty}
            onSave={handleSaveDocument}
            stats={stats}
            wordCountPopoverOpen={wordCountPopoverOpen}
            setWordCountPopoverOpen={setWordCountPopoverOpen}
          />
        </div>
  );
};
