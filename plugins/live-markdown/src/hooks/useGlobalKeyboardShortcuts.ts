import { Dispatch, SetStateAction, useEffect } from "react";
import { getSelectionBlockInfo } from "../utils/selectionUtils";
import { InlineFormatAction, MarkdownBlock } from "../types/typora";

export interface FindReplaceState {
  open: boolean; showReplace: boolean; query: string; replaceText: string;
  caseSensitive: boolean; wholeWord: boolean; isRegex: boolean; activeMatchIndex: number;
}
type ConvertTarget = "paragraph" | "heading" | "blockquote" | "alert" | "ul" | "ol" | "task" | "code" | "math";
type BlockKind = "table" | "code" | "math" | "mermaid" | "toc" | "hr" | "frontmatter" | "footnote";

export interface GlobalKeyboardShortcutsOptions {
  blocks: MarkdownBlock[];
  readingMode: boolean;
  selectedBlockIds: string[];
  setFocusedBlockId: (id: string | null) => void;
  setSelectedBlockIds: Dispatch<SetStateAction<string[]>>;
  deleteSelectedBlocks: (ids?: string[]) => void;
  deleteBlock: (id: string) => void;
  replaceBlockWithRaw: (id: string, raw: string) => void;
  updateMarkdownContent: (content: string, recordUndo?: boolean) => void;
  undo: () => void;
  redo: () => void;
  toggleReadingMode: () => void;
  quickUndoSnapshot: () => void;
  setHistoryModalOpen: Dispatch<SetStateAction<boolean>>;
  setQuickOpenVisible: Dispatch<SetStateAction<boolean>>;
  setFindReplace: Dispatch<SetStateAction<FindReplaceState>>;
  saveAsDocument: () => void;
  saveDocument: () => void;
  newDocument: () => void;
  openFileDialog: () => void;
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setTypewriterMode: Dispatch<SetStateAction<boolean>>;
  setReadingMode: Dispatch<SetStateAction<boolean>>;
  setSourceMode: Dispatch<SetStateAction<boolean>>;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;
  convertBlock: (target: ConvertTarget, options?: { headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 }) => void;
  setTableModalOpen: Dispatch<SetStateAction<boolean>>;
  insertBlock: (kind: BlockKind) => void;
  applyInlineFormat: (action: InlineFormatAction) => void;
  showToast: (message: string) => void;
}

export function useGlobalKeyboardShortcuts(options: GlobalKeyboardShortcutsOptions): void {
  const {
    blocks, readingMode, selectedBlockIds, setFocusedBlockId, setSelectedBlockIds,
    deleteSelectedBlocks: handleDeleteSelectedBlocks, deleteBlock: handleDeleteBlock,
    replaceBlockWithRaw: handleReplaceBlockWithRaw, updateMarkdownContent,
    undo: handleUndo, redo: handleRedo, toggleReadingMode: handleToggleReadingMode,
    quickUndoSnapshot: handleQuickUndoSnapshot, setHistoryModalOpen, setQuickOpenVisible,
    setFindReplace, saveAsDocument: handleSaveAsDocument, saveDocument: handleSaveDocument,
    newDocument: handleNewDocument, openFileDialog: handleOpenFileDialog, setPreferencesOpen,
    setFocusMode, setTypewriterMode, setReadingMode, setSourceMode, setSidebarVisible,
    convertBlock: handleConvertBlock, setTableModalOpen,
    insertBlock: handleInsertBlock, applyInlineFormat: handleApplyInlineFormat, showToast
  } = options;
  const parsed = { blocks };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const active = document.activeElement;
      const isInputOrTextarea =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        Boolean(active?.closest(".cm-editor")) ||
        active?.getAttribute("contenteditable") === "true";

      // 1. Typora Cmd+A: Select Entire Document when not in an active non-live input
      if (mod && e.key.toLowerCase() === "a" && !e.shiftKey) {
        if (!isInputOrTextarea) {
          e.preventDefault();
          setFocusedBlockId(null);
          const allIds = parsed.blocks.map((b) => b.id);
          setSelectedBlockIds(allIds);
          window.requestAnimationFrame(() => {
            const writeEl = document.getElementById("write");
            if (writeEl) {
              const range = document.createRange();
              range.selectNodeContents(writeEl);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            }
          });
          return;
        }
      }

      // 2. Handle Document All-Selected or Multi-Selected Key Actions
      if (selectedBlockIds.length > 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          setSelectedBlockIds([]);
          window.getSelection()?.removeAllRanges();
          return;
        }

        // Backspace / Delete with Multi-Selected Blocks
        if (e.key === "Backspace" || e.key === "Delete") {
          if (!isInputOrTextarea) {
            e.preventDefault();
            if (readingMode) {
              showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
              return;
            }
            window.getSelection()?.removeAllRanges();
            // If all blocks in document were selected, clear entire document
            if (
              selectedBlockIds.length === parsed.blocks.length ||
              parsed.blocks.length <= 1
            ) {
              updateMarkdownContent("");
              setSelectedBlockIds([]);
              setFocusedBlockId(null);
              showToast("已清空文档");
              return;
            }
            handleDeleteSelectedBlocks();
            return;
          }
        }

        // Typing a character while all blocks are selected -> replace document with character
        if (
          !isInputOrTextarea &&
          selectedBlockIds.length === parsed.blocks.length &&
          e.key.length === 1 &&
          !mod &&
          !e.altKey
        ) {
          e.preventDefault();
          if (readingMode) {
            showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
            return;
          }
          window.getSelection()?.removeAllRanges();
          setSelectedBlockIds([]);
          updateMarkdownContent(e.key);
          setFocusedBlockId("block-1");
          return;
        }
      }

      // 3. Typora Native Box-Selection / Mouse Range Selection Actions
      const selection = typeof window !== "undefined" ? window.getSelection() : null;
      if (!isInputOrTextarea && selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const info = getSelectionBlockInfo(selection, parsed.blocks);
        if (info) {
          // 3a. Delete / Backspace on mouse-selected text range
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            if (readingMode) {
              showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
              return;
            }
            selection.removeAllRanges();

            if (info.coveredBlocks.length > 1) {
              // Delete all covered blocks
              const coveredIds = info.coveredBlocks.map((b) => b.id);
              handleDeleteSelectedBlocks(coveredIds);
            } else {
              // Delete text inside single block
              const blk = info.startBlock;
              const selText = info.selectedText.trim();
              if (!selText || selText === blk.text?.trim() || selText === blk.raw.trim()) {
                handleDeleteBlock(blk.id);
              } else {
                const nextRaw = blk.raw.replace(info.selectedText, "");
                handleReplaceBlockWithRaw(blk.id, nextRaw);
              }
            }
            return;
          }

          // 3b. Typing a character directly into a selected range (replace & inline edit)
          if (e.key.length === 1 && !mod && !e.altKey) {
            e.preventDefault();
            if (readingMode) {
              showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
              return;
            }
            selection.removeAllRanges();

            const blk = info.startBlock;
            const nextRaw =
              info.coveredBlocks.length > 1
                ? e.key
                : blk.raw.includes(info.selectedText)
                ? blk.raw.replace(info.selectedText, e.key)
                : `${blk.raw} ${e.key}`;

            if (info.coveredBlocks.length > 1) {
              // Delete the rest covered blocks and replace start block
              const toDelete = new Set(info.coveredBlocks.slice(1).map((b) => b.id));
              const remaining = parsed.blocks
                .filter((b) => !toDelete.has(b.id))
                .map((b) => (b.id === blk.id ? nextRaw : b.raw));
              updateMarkdownContent(remaining.join("\n\n"));
            } else {
              handleReplaceBlockWithRaw(blk.id, nextRaw);
            }
            setFocusedBlockId(blk.id);
            return;
          }

          // 3c. Enter key on selected range -> focus into block inline editing
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (readingMode) return;
            selection.removeAllRanges();
            setFocusedBlockId(info.startBlock.id);
            return;
          }
        }
      }

      // Cmd+Z -> Undo
      if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (!isInputOrTextarea) {
          e.preventDefault();
          if (readingMode) {
            showToast("只读阅读模式：无法执行编辑撤销");
            return;
          }
          handleUndo();
          return;
        }
      }

      // Cmd+Shift+Z / Cmd+Y -> Redo
      if (
        (mod && e.shiftKey && e.key.toLowerCase() === "z") ||
        (mod && !e.shiftKey && e.key.toLowerCase() === "y")
      ) {
        if (!isInputOrTextarea) {
          e.preventDefault();
          if (readingMode) {
            showToast("只读阅读模式：无法执行编辑重做");
            return;
          }
          handleRedo();
          return;
        }
      }

      // Cmd+/ -> Toggle Source Code Mode
      if (mod && e.key === "/") {
        e.preventDefault();
        if (readingMode) {
          setReadingMode(false);
          setSourceMode(true);
          showToast("已退出阅读模式，进入源码模式");
          return;
        }
        setSourceMode((s) => !s);
        return;
      }
      // Cmd+Shift+R -> Toggle Reading Mode (Read-only)
      if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        handleToggleReadingMode();
        return;
      }
      // Cmd+Shift+L -> Toggle Sidebar
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
        return;
      }
      // Cmd+Shift+H -> File History & Diff Modal
      if (mod && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHistoryModalOpen((prev) => !prev);
        return;
      }
      // Cmd+Alt+Z -> Undo to Previous Snapshot
      if (mod && e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleQuickUndoSnapshot();
        return;
      }
      // Cmd+P -> Quick Open
      if (mod && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpenVisible((v) => !v);
        return;
      }
      // Cmd+F / Cmd+Alt+F -> Find & Replace
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindReplace((prev) => ({
          ...prev,
          open: true,
          showReplace: e.altKey ? true : prev.showReplace
        }));
        return;
      }
      // Cmd+S / Cmd+Shift+S -> Save / Save As
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) handleSaveAsDocument();
        else handleSaveDocument();
        return;
      }
      // Cmd+N -> New Document
      if (mod && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewDocument();
        return;
      }
      // Cmd+O -> Open File
      if (mod && !e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenFileDialog();
        return;
      }
      // Cmd+, -> Preferences
      if (mod && e.key === ",") {
        e.preventDefault();
        setPreferencesOpen((v) => !v);
        return;
      }
      // F8 -> Focus Mode
      if (e.key === "F8") {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      // F9 -> Typewriter Mode
      if (e.key === "F9") {
        e.preventDefault();
        setTypewriterMode((v) => !v);
        return;
      }
      // Cmd+1..6 -> Heading 1..6, Cmd+0 -> Paragraph
      if (mod && !e.shiftKey && !e.altKey && /^[0-6]$/.test(e.key)) {
        e.preventDefault();
        if (readingMode) {
          showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
          return;
        }
        const num = Number(e.key);
        if (num === 0) {
          handleConvertBlock("paragraph");
        } else {
          handleConvertBlock("heading", {
            headingLevel: num as 1 | 2 | 3 | 4 | 5 | 6
          });
        }
        return;
      }
      // Cmd+Alt+T -> Insert Table
      if (mod && e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (readingMode) {
          showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
          return;
        }
        setTableModalOpen(true);
        return;
      }
      // Cmd+Alt+C -> Insert Code Block
      if (mod && e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (readingMode) {
          showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
          return;
        }
        handleInsertBlock("code");
        return;
      }
      // Cmd+Alt+M -> Insert Math Block
      if (mod && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (readingMode) {
          showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
          return;
        }
        handleInsertBlock("math");
        return;
      }
      // Cmd+Alt+Q -> Blockquote
      if (mod && e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        if (readingMode) {
          showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
          return;
        }
        handleConvertBlock("blockquote");
        return;
      }
      // Inline formatting shortcuts when editing
      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (["b", "i", "u", "k", "`"].includes(k)) {
          if (readingMode) {
            e.preventDefault();
            showToast("只读阅读模式：文档不可编辑 (⇧⌘R 退出)");
            return;
          }
          if (k === "b") {
            e.preventDefault();
            handleApplyInlineFormat("bold");
          } else if (k === "i") {
            e.preventDefault();
            handleApplyInlineFormat("italic");
          } else if (k === "u") {
            e.preventDefault();
            handleApplyInlineFormat("underline");
          } else if (k === "k") {
            e.preventDefault();
            handleApplyInlineFormat("link");
          } else if (k === "`") {
            e.preventDefault();
            handleApplyInlineFormat("code");
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleApplyInlineFormat,
    handleConvertBlock,
    handleDeleteBlock,
    handleDeleteSelectedBlocks,
    handleInsertBlock,
    handleNewDocument,
    handleOpenFileDialog,
    handleRedo,
    handleReplaceBlockWithRaw,
    handleSaveAsDocument,
    handleSaveDocument,
    handleToggleReadingMode,
    handleUndo,
    parsed.blocks,
    readingMode,
    selectedBlockIds,
    showToast,
    updateMarkdownContent
  ]);

}
