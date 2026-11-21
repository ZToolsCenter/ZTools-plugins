import { normalizeCodeTheme } from "../core/codeThemes";
import { useEffect, useMemo, useRef, useState } from "react";
import { readScopedEditorSelectionText, type EditorSelectionMode } from "../core/ai/editorSelectionSync";
import { PromptDialogState } from "../components/FloatingPanels";
import { createHostAdapter } from "../core/host/hostAdapter";
import { SAMPLE_QUICKSTART_DOC } from "../core/sampleDocs";
import { readDocumentRecovery } from "../core/documentRecovery";
import { documentIdentity } from "../core/documentIdentity";
import { FindReplaceState } from "./useGlobalKeyboardShortcuts";
import { findOwningWorkspace } from "../utils/pathUtils";
import { FileViewMode, LoadedDocument, PreferencesTab, SidebarTab, SortDirection, SortField, TyporaBridgeApi, TyporaPreferences, WorkspaceScanResult } from "../types/typora";

export const DEFAULT_PREFERENCES: TyporaPreferences = {
  theme: "github", codeTheme: "auto", fontSize: 16, lineWidth: "default", autoSave: true,
  showLineNumbersInCode: true, wrapCodeBlocks: true, enableInlineMath: true,
  enableSubscriptSuperscript: true, enableHighlight: true, enableDiagrams: true,
  strictMode: false, imageRootPathMode: "assets", copyImagesAsAbsolute: true,
  defaultIndentSize: 2, spellcheck: false, editorEngine: "cm6", enableAiCopilot: true
};

export function useAppState(bridge: TyporaBridgeApi | null) {
  const [preferences, setPreferences] = useState<TyporaPreferences>(() => {
    try {
      const saved = bridge?.loadPersistedState?.();
      if (saved?.preferences && typeof saved.preferences === "object") return { ...DEFAULT_PREFERENCES, ...(saved.preferences as Partial<TyporaPreferences>), codeTheme: normalizeCodeTheme((saved.preferences as Partial<TyporaPreferences>).codeTheme) };
      const localRaw = localStorage.getItem("typora_ztools_preferences_v1");
      if (localRaw) return { ...DEFAULT_PREFERENCES, ...(JSON.parse(localRaw) as Partial<TyporaPreferences>), codeTheme: normalizeCodeTheme(JSON.parse(localRaw).codeTheme) };
    } catch { /* ignore */ }
    return DEFAULT_PREFERENCES;
  });
  useEffect(() => { document.documentElement.dataset.codeTheme = normalizeCodeTheme(preferences.codeTheme); }, [preferences.codeTheme]);
  const [doc, setDoc] = useState<LoadedDocument>(() => {
    let lastDoc: LoadedDocument | null = null;
    try {
      const saved = bridge?.loadPersistedState?.() as Record<string, unknown> | undefined;
      const persisted = saved?.lastOpenDoc as LoadedDocument | undefined;
      if (persisted && typeof persisted.content === "string") lastDoc = persisted;
    } catch { /* ignore */ }
    try {
      const recovered = typeof localStorage === "undefined" ? null : readDocumentRecovery(localStorage);
      if (recovered) return { ...recovered, documentId: recovered.documentId || documentIdentity(recovered.path) };
    } catch { /* recovery storage is optional */ }
    if (lastDoc) return { ...lastDoc, documentId: lastDoc.documentId || documentIdentity(lastDoc.path) };
    return { documentId: documentIdentity(null, "sample:quickstart"), path: null, name: "Markdown 快速上手指南.md", dir: bridge?.getDefaultNotesDir?.() || "", content: SAMPLE_QUICKSTART_DOC, isDirty: false, mtimeMs: Date.now() };
  });
  const [activeSampleKey, setActiveSampleKey] = useState<"quickstart" | "reference" | null>(() => {
    try {
      const saved = bridge?.loadPersistedState?.() as Record<string, unknown> | undefined;
      if (saved?.lastOpenDoc) return null;
    } catch { /* ignore */ }
    return "quickstart";
  });
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceScanResult[]>([]);
  const workspace = useMemo(
    () => findOwningWorkspace(workspaces, doc.path) ?? workspaces[0] ?? null,
    [workspaces, doc.path]
  );
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try { const saved = bridge?.loadPersistedState?.(); return saved && Array.isArray(saved.userRecentFolders) ? saved.userRecentFolders as string[] : []; }
    catch { return []; }
  });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>("tree");
  const [sortField, setSortField] = useState<SortField>("mtime");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sourceMode, setSourceMode] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const lastActiveBlockIdRef = useRef<string | null>(null);
  useEffect(() => { if (focusedBlockId) lastActiveBlockIdRef.current = focusedBlockId; }, [focusedBlockId]);
  const [findReplace, setFindReplace] = useState<FindReplaceState>({ open: false, showReplace: false, query: "", replaceText: "", caseSensitive: false, wholeWord: false, isRegex: false, activeMatchIndex: 0 });
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesTab, setPreferencesTab] = useState<PreferencesTab>("appearance");
  const [wordCountPopoverOpen, setWordCountPopoverOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number; blockId: string | null }>({ open: false, x: 0, y: 0, blockId: null });
  const [promptDialog, setPromptDialog] = useState<PromptDialogState | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [footerModeOpen, setFooterModeOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [selectedAiText, setSelectedAiText] = useState("");
  const [aiSelectionRevision, setAiSelectionRevision] = useState(0);
  const [aiAssistantInitialAction, setAiAssistantInitialAction] = useState<string | null>(null);
  const hostAdapter = useMemo(() => createHostAdapter(), []);
  const selectionMode: EditorSelectionMode = sourceMode
    ? "source"
    : readingMode
      ? "reading"
      : preferences.editorEngine === "cm6"
        ? "cm6"
        : "legacy";
  const selectionModeRef = useRef<EditorSelectionMode>(selectionMode);
  selectionModeRef.current = selectionMode;
  useEffect(() => {
    setSelectedAiText("");
    setAiSelectionRevision((revision) => revision + 1);
  }, [selectionMode, doc.documentId]);
  useEffect(() => {
    const handleSelectionChange = () => {
      const text = readScopedEditorSelectionText({
        mode: selectionModeRef.current,
        selection: window.getSelection(),
        editorRoot: document.querySelector<HTMLElement>("#write"),
        sourceTextarea: document.querySelector<HTMLTextAreaElement>("textarea.ty-source-textarea"),
        activeElement: document.activeElement
      });
      if (text !== null) {
        setSelectedAiText(text);
        setAiSelectionRevision((revision) => revision + 1);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);
  const currentViewMode: "live" | "source" | "reading" = readingMode ? "reading" : sourceMode ? "source" : "live";
  return {
    preferences, setPreferences, doc, setDoc, activeSampleKey, setActiveSampleKey, undoStack, setUndoStack, redoStack, setRedoStack,
    workspaces, setWorkspaces, workspace, recentFolders, setRecentFolders,
    sidebarVisible, setSidebarVisible, sidebarWidth, setSidebarWidth, sidebarTab, setSidebarTab, fileViewMode, setFileViewMode,
    sortField, setSortField, sortDirection, setSortDirection, sourceMode, setSourceMode, readingMode, setReadingMode,
    focusMode, setFocusMode, typewriterMode, setTypewriterMode, focusedBlockId, setFocusedBlockId, selectedBlockIds, setSelectedBlockIds,
    lastActiveBlockIdRef, findReplace, setFindReplace, quickOpenVisible, setQuickOpenVisible, tableModalOpen, setTableModalOpen,
    preferencesOpen, setPreferencesOpen, preferencesTab, setPreferencesTab, wordCountPopoverOpen, setWordCountPopoverOpen,
    contextMenu, setContextMenu, promptDialog, setPromptDialog, toastMessage, setToastMessage, footerModeOpen, setFooterModeOpen,
    aiAssistantOpen, setAiAssistantOpen, selectedAiText, setSelectedAiText, aiSelectionRevision, setAiSelectionRevision, aiAssistantInitialAction, setAiAssistantInitialAction,
    hostAdapter, currentViewMode
  };
}
