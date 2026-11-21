import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useState } from "react";
import { loadSnapshots, MAX_SNAPSHOTS_PER_DOC, recordSnapshot, undoToPreviousSnapshot } from "../core/historyManager";
import { CM6EditorApi } from "../components/CM6LivePreviewEditor";
import { LoadedDocument } from "../types/typora";

export interface DocumentHistoryOptions {
  doc: LoadedDocument;
  docKey: string;
  setHistoryCount: Dispatch<SetStateAction<number>>;
  setDoc: Dispatch<SetStateAction<LoadedDocument>>;
  setUndoStack: Dispatch<SetStateAction<string[]>>;
  setRedoStack: Dispatch<SetStateAction<string[]>>;
  editorEngine: string;
  readingMode?: boolean;
  docRef: MutableRefObject<LoadedDocument>;
  documentRevisionRef: MutableRefObject<number>;
  cm6EditorApiRef: MutableRefObject<CM6EditorApi | null>;
  updateMarkdownContent: (content: string, recordUndo?: boolean) => void;
  showToast: (message: string) => void;
}

export function useDocumentHistory(options: DocumentHistoryOptions) {
  const { doc, docKey, setDoc, setUndoStack, setRedoStack, editorEngine, readingMode = false, setHistoryCount, docRef,
    documentRevisionRef, cm6EditorApiRef, updateMarkdownContent, showToast } = options;
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  useEffect(() => {
    const list = loadSnapshots(docKey);
    setHistoryCount(list.length);
  }, [docKey]);

  useEffect(() => {
    if (doc.content && doc.content.trim()) {
      const list = loadSnapshots(docKey);
      if (list.length === 0) {
        const { list: updated } = recordSnapshot(
          docKey,
          doc.name,
          doc.path,
          doc.content,
          "初始打开版本"
        );
        setHistoryCount(updated.length);
      }
    }
  }, [docKey, doc.name, doc.path]);

  const handleQuickUndoSnapshot = useCallback(() => {
    const res = undoToPreviousSnapshot(docKey, doc.name, doc.path, doc.content);
    if (res) {
      updateMarkdownContent(res.restoredContent, true);
      setHistoryCount(res.updatedList.length);
      showToast(
        `已撤销回退至快照: ${new Date(res.restoredSnapshot.timestamp).toLocaleTimeString()}`
      );
    } else {
      showToast("当前无更多可撤销的历史快照");
    }
  }, [docKey, doc.name, doc.path, doc.content, updateMarkdownContent, showToast]);

  // Restore content from File History modal to any selected snapshot
  const handleRestoreFromHistory = useCallback(
    (content: string, summary: string) => {
      // If current workspace has edits differing from target, back it up first
      if (doc.content && doc.content.trim() && doc.content !== content) {
        recordSnapshot(docKey, doc.name, doc.path, doc.content, "回滚前工作区备份");
      }
      // Apply the restored content to the document
      updateMarkdownContent(content, true);
      // Record the audit snapshot for this restore action (force=true)
      const { list: updated } = recordSnapshot(
        docKey,
        doc.name,
        doc.path,
        content,
        summary,
        MAX_SNAPSHOTS_PER_DOC,
        true
      );
      setHistoryCount(updated.length);
      showToast(summary);
    },
    [docKey, doc.name, doc.path, doc.content, updateMarkdownContent, showToast]
  );

  // Undo / Redo handlers
  const handleUndo = useCallback(() => {
    if (readingMode) return;
    if (editorEngine === "cm6" && cm6EditorApiRef.current) {
      if (cm6EditorApiRef.current.undo()) showToast("已撤销");
      return;
    }
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const previousContent = prevUndo[prevUndo.length - 1];
      setRedoStack((prevRedo) => [...prevRedo.slice(-60), doc.content]);
      setDoc((d) => ({
        ...d,
        content: previousContent,
        isDirty: true
      }));
      docRef.current = { ...docRef.current, content: previousContent, isDirty: true };
      documentRevisionRef.current += 1;
      showToast("已撤销");
      return prevUndo.slice(0, -1);
    });
  }, [doc.content, editorEngine, readingMode, showToast]);

  const handleRedo = useCallback(() => {
    if (readingMode) return;
    if (editorEngine === "cm6" && cm6EditorApiRef.current) {
      if (cm6EditorApiRef.current.redo()) showToast("已恢复");
      return;
    }
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextContent = prevRedo[prevRedo.length - 1];
      setUndoStack((prevUndo) => [...prevUndo.slice(-60), doc.content]);
      setDoc((d) => ({
        ...d,
        content: nextContent,
        isDirty: true
      }));
      docRef.current = { ...docRef.current, content: nextContent, isDirty: true };
      documentRevisionRef.current += 1;
      showToast("已恢复");
      return prevRedo.slice(0, -1);
    });
  }, [doc.content, editorEngine, readingMode, showToast]);


  return { historyModalOpen, setHistoryModalOpen,
    handleQuickUndoSnapshot, handleRestoreFromHistory, handleUndo, handleRedo };
}
