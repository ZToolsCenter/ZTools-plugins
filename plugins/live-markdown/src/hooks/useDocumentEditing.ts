import { Dispatch, SetStateAction, useCallback, useEffect, useRef } from "react";
import { AiDocumentSnapshot, AiEditProposal } from "../types/aiEditing";
import { TyporaBridgeApi, LoadedDocument, MarkdownBlock } from "../types/typora";
import { recordSnapshot } from "../core/historyManager";
import { clearDocumentRecovery, persistDocumentRecovery } from "../core/documentRecovery";
import { getRawSelectionPosition, getRawSelectionRange } from "../core/ai/selectionRange";
import { isAiProposalCurrent, resolveAiEdit } from "../core/ai/editProposal";
import { CM6EditorApi } from "../components/CM6LivePreviewEditor";
import { documentIdentity } from "../core/documentIdentity";

type DocumentSetter = Dispatch<SetStateAction<LoadedDocument>>;
type StringStackSetter = Dispatch<SetStateAction<string[]>>;

export interface UseDocumentEditingOptions {
  doc: LoadedDocument;
  setDoc: DocumentSetter;
  bridge: TyporaBridgeApi | null;
  autoSave: boolean;
  editorEngine: string;
  sourceMode: boolean;
  readingMode: boolean;
  activeSampleKey: "quickstart" | "reference" | null;
  parsedBlocks: MarkdownBlock[];
  docKey: string;
  setUndoStack: StringStackSetter;
  setRedoStack: StringStackSetter;
  setHistoryCount: Dispatch<SetStateAction<number>>;
  showToast: (message: string) => void;
}

export function useDocumentEditing(options: UseDocumentEditingOptions) {
  const {
    doc, setDoc, bridge, autoSave, editorEngine, sourceMode, readingMode,
    activeSampleKey, parsedBlocks, docKey, setUndoStack, setRedoStack,
    setHistoryCount, showToast
  } = options;
  const documentRevisionRef = useRef(0);
  const docRef = useRef(doc);
  if (docRef.current.path !== doc.path || docRef.current.content !== doc.content || docRef.current.documentId !== doc.documentId) {
    docRef.current = doc;
    documentRevisionRef.current += 1;
  }
  const aiSelectionRangeRef = useRef<{ from: number; to: number } | null>(null);
  const cm6EditorApiRef = useRef<CM6EditorApi | null>(null);
  const persistedContentRef = useRef(doc.recoveryBaselineKnown ? (doc.recoveryBaselineContent || "") : doc.content);
  const persistedPathRef = useRef(doc.recoveryBaselineKnown ? doc.recoveryBaselinePath ?? null : doc.path);
  const pendingSaveStartedAtRef = useRef<number | null>(null);
  const saveConflictRef = useRef(false);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const historyDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asyncWriter = bridge;

  const updateMarkdownContent = useCallback((nextContent: string, recordUndo = true) => {
    const prev = docRef.current;
    if (prev.content === nextContent) return;
    if (recordUndo) {
      setUndoStack((stack) => [...stack.slice(-60), prev.content]);
      setRedoStack([]);
    }
    const updated: LoadedDocument = { ...prev, content: nextContent, isDirty: true, mtimeMs: Date.now() };
    docRef.current = updated;
    documentRevisionRef.current += 1;
    setDoc(updated);
    if (historyDebounceTimerRef.current) clearTimeout(historyDebounceTimerRef.current);
    historyDebounceTimerRef.current = setTimeout(() => {
      const { list } = recordSnapshot(docKey, doc.name, doc.path, nextContent, "自动编辑快照");
      setHistoryCount(list.length);
    }, 1800);
  }, [doc.name, doc.path, docKey, setDoc, setHistoryCount, setRedoStack, setUndoStack]);

  const buildAiDocumentSnapshot = useCallback((): AiDocumentSnapshot => {
    const current = docRef.current;
    let selection: AiDocumentSnapshot["selection"] = null;
    let cursor: number | null = null;
    let selectionValid = true;
    if (!sourceMode && editorEngine === "cm6" && cm6EditorApiRef.current) {
      const position = cm6EditorApiRef.current.getSelection();
      selection = position.from === position.to ? null : { from: position.from, to: position.to };
      cursor = position.cursor;
    } else if (sourceMode) {
      const textarea = document.querySelector<HTMLTextAreaElement>("textarea.ty-source-textarea");
      if (textarea) {
        const from = textarea.selectionStart;
        const to = textarea.selectionEnd;
        selection = from === to ? null : { from, to };
        cursor = textarea.selectionDirection === "backward" ? from : to;
      }
    } else {
      const nativeSelection = window.getSelection();
      const editor = document.querySelector<HTMLElement>("#write");
      selection = getRawSelectionRange(editor, parsedBlocks, nativeSelection);
      cursor = getRawSelectionPosition(editor, parsedBlocks, nativeSelection);
      if (nativeSelection && !nativeSelection.isCollapsed && nativeSelection.toString().trim() && !selection) selectionValid = false;
      const activeTextarea = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
      if (activeTextarea?.classList.contains("ty-live-textarea") && activeTextarea.selectionStart !== activeTextarea.selectionEnd) {
        selectionValid = false;
      }
    }
    return {
      documentId: current.documentId || documentIdentity(current.path, activeSampleKey || undefined),
      revision: documentRevisionRef.current,
      content: current.content,
      selection,
      cursor,
      selectionValid,
      readOnly: readingMode
    };
  }, [activeSampleKey, editorEngine, parsedBlocks, readingMode, sourceMode]);

  const applyAiEditProposal = useCallback((proposal: AiEditProposal): boolean => {
    const currentSnapshot = buildAiDocumentSnapshot();
    if (!isAiProposalCurrent(proposal, currentSnapshot) || currentSnapshot.readOnly) {
      showToast("文档或选区已变化，请重新生成后再应用");
      return false;
    }
    const edit = resolveAiEdit(proposal);
    if (!edit) return false;
    if (!sourceMode && editorEngine === "cm6" && cm6EditorApiRef.current) {
      if (!cm6EditorApiRef.current.applyText(edit.from, edit.to, edit.expectedText, edit.insertText)) {
        showToast("编辑器内容与 AI 结果不一致，已取消应用");
        return false;
      }
    } else {
      updateMarkdownContent(edit.content, true);
    }
    showToast("AI 生成内容已成功更新至文档");
    return true;
  }, [buildAiDocumentSnapshot, editorEngine, showToast, sourceMode, updateMarkdownContent]);

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (saveInFlightRef.current) await saveInFlightRef.current;
      const current = docRef.current;
      if (!current.isDirty) return true;
      if (!current.path || current.recoveryNeedsSaveAs || !asyncWriter?.writeDocumentAsync || saveConflictRef.current) return false;
      const path = current.path;
      const content = current.content;
      const revision = documentRevisionRef.current;
      let succeeded = false;
      const operation = asyncWriter.writeDocumentAsync(path, content, { expectedContent: persistedContentRef.current })
        .then((saved) => {
          if (persistedPathRef.current !== path) return;
          persistedContentRef.current = saved.content;
          if (docRef.current.path === path && docRef.current.content === content && documentRevisionRef.current === revision) {
            const clean = { ...docRef.current, isDirty: false, mtimeMs: saved.mtimeMs };
            docRef.current = clean;
            setDoc(clean);
            clearDocumentRecovery(localStorage);
          }
          succeeded = true;
        })
        .catch((error: unknown) => {
          if ((error as { code?: string })?.code === "DOCUMENT_CONFLICT") {
            saveConflictRef.current = true;
            showToast("文件已在外部修改，自动保存已暂停以保护外部内容");
          } else {
            showToast("切换文档前保存失败，当前文稿仍保留在编辑器中");
          }
        })
        .finally(() => { if (saveInFlightRef.current === operation) saveInFlightRef.current = null; });
      saveInFlightRef.current = operation;
      await operation;
      if (!succeeded) return false;
      if (!docRef.current.isDirty) return true;
    }
    return !docRef.current.isDirty;
  }, [asyncWriter, setDoc, showToast]);

  useEffect(() => {
    const persist = () => persistDocumentRecovery(docRef.current, localStorage, {
      path: persistedPathRef.current,
      content: persistedContentRef.current,
      known: !docRef.current.recoveryNeedsSaveAs
    });
    if (!doc.isDirty) {
      clearDocumentRecovery(localStorage);
      return;
    }
    const timer = window.setTimeout(persist, 250);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [doc.content, doc.isDirty, doc.name, doc.path]);

  useEffect(() => {
    if (persistedPathRef.current !== doc.path) {
      persistedPathRef.current = doc.path;
      persistedContentRef.current = doc.content;
      saveConflictRef.current = false;
      pendingSaveStartedAtRef.current = null;
    }
    if (!doc.path || doc.recoveryNeedsSaveAs || !doc.isDirty || !autoSave || !asyncWriter?.writeDocumentAsync || saveConflictRef.current) {
      if (!doc.isDirty) pendingSaveStartedAtRef.current = null;
      return;
    }
    const startedAt = pendingSaveStartedAtRef.current ?? Date.now();
    pendingSaveStartedAtRef.current = startedAt;
    const delay = Math.max(0, Math.min(800, 5000 - (Date.now() - startedAt)));
    const timer = window.setTimeout(() => {
      const saveLatest = async () => {
        if (saveInFlightRef.current) await saveInFlightRef.current;
        const latest = docRef.current;
        if (!latest.path || latest.path !== persistedPathRef.current || !latest.isDirty || saveConflictRef.current) return;
        const revision = documentRevisionRef.current;
        const savingPath = latest.path;
        const savingContent = latest.content;
        const operation = asyncWriter.writeDocumentAsync!(savingPath, savingContent, { expectedContent: persistedContentRef.current })
          .then((saved) => {
            if (persistedPathRef.current !== savingPath) return;
            persistedContentRef.current = saved.content;
            setDoc((current) => {
              if (current.path !== savingPath || current.content !== saved.content || documentRevisionRef.current !== revision) return current;
              const clean = { ...current, isDirty: false, mtimeMs: saved.mtimeMs };
              docRef.current = clean;
              return clean;
            });
          })
          .catch((error: unknown) => {
            if ((error as { code?: string })?.code === "DOCUMENT_CONFLICT") {
              saveConflictRef.current = true;
              showToast("文件已在外部修改，自动保存已暂停以保护外部内容");
            }
          })
          .finally(() => { if (saveInFlightRef.current === operation) saveInFlightRef.current = null; });
        saveInFlightRef.current = operation;
        await operation;
      };
      void saveLatest();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [asyncWriter, autoSave, doc.content, doc.isDirty, doc.path, setDoc, showToast]);

  return {
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
    applyAiEditProposal,
    flushPendingSave
  };
}
