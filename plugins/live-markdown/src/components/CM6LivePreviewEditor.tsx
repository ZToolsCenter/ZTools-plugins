import React, { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { livePreviewPlugin } from "../core/cm6/livePreviewPlugin";
import { livePreviewFocus } from "../core/cm6/previewFocus";
import { cm6VerticalNavigation } from "../core/cm6/verticalNavigation";
import "../styles/cm6-code-block.css";
import "../styles/cm6-document-meta.css";
import "../styles/cm6-paragraph-flow.css";
import { cm6TableLinkHandler } from "../core/cm6/tableBlockWidget";
import { typoraCM6Theme } from "../core/cm6/typoraTheme";
import { typoraCM6Keymap } from "../core/cm6/cm6Keymap";
import { createAiEditTransaction } from "../core/cm6/aiEditTransaction";
import { buildTocSlashCommandTransaction } from "../core/cm6/slashCommandTransaction";
import { captureCM6HistorySnapshot, CM6HistorySnapshot, restoreCM6EditorState } from "../core/cm6/historySnapshot";
import { TyporaPreferences } from "../types/typora";
import {
  SlashCommandItem,
  SlashCommandMenu,
  getGroupedSlashCommands
} from "./SlashCommandMenu";

export interface CM6LivePreviewEditorProps {
  documentId?: string;
  markdown: string;
  preferences: TyporaPreferences;
  docPath: string | null;
  readingMode?: boolean;
  typewriterMode?: boolean;
  searchHighlight?: string;
  onChangeFullMarkdown: (nextMarkdown: string) => void;
  onAiSelectionRangeChange?: (range: { from: number; to: number } | null) => void;
  onAiEditorApiChange?: (api: CM6EditorApi | null) => void;
  onOpenLink?: (url: string) => void;
  onContextMenuRequest?: (e: React.MouseEvent, pos: number | null) => void;
  onSelectionChange?: (selectedText: string) => void;
  onTriggerAiAction?: (actionName: string, selectedText?: string) => void;
  historySnapshot?: CM6HistorySnapshot | null;
  onHistorySnapshot?: (snapshot: CM6HistorySnapshot | null) => void;
}

export interface CM6EditorApi {
  getSelection(): { from: number; to: number; cursor: number };
  applyText(from: number, to: number, expectedText: string, text: string): boolean;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

export const CM6LivePreviewEditor: React.FC<CM6LivePreviewEditorProps> = ({
  markdown: initialMarkdown,
  documentId,
  preferences,
  readingMode = false,
  typewriterMode = false,
  onChangeFullMarkdown,
  onAiSelectionRangeChange,
  onAiEditorApiChange,
  onOpenLink,
  onContextMenuRequest,
  onSelectionChange,
  onTriggerAiAction,
  historySnapshot,
  onHistorySnapshot
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const isInternalChangeRef = useRef(false);
  const typewriterModeRef = useRef(typewriterMode);
  typewriterModeRef.current = typewriterMode;
  const readingModeRef = useRef(readingMode);
  readingModeRef.current = readingMode;
  const callbacksRef = useRef({ onChangeFullMarkdown, onAiSelectionRangeChange, onAiEditorApiChange, onOpenLink, onContextMenuRequest, onSelectionChange, onTriggerAiAction, onHistorySnapshot });
  callbacksRef.current = { onChangeFullMarkdown, onAiSelectionRangeChange, onAiEditorApiChange, onOpenLink, onContextMenuRequest, onSelectionChange, onTriggerAiAction, onHistorySnapshot };
  const [slashMenu, setSlashMenu] = React.useState<{
    query: string;
    from: number;
    to: number;
    selectedIndex: number;
    coords: { x: number; y: number } | null;
  } | null>(null);
  const slashMenuRef = useRef(slashMenu);
  slashMenuRef.current = slashMenu;

  const handleSlashMenuKey = (key: string): boolean => {
    const current = slashMenuRef.current;
    if (!current) return false;

    const { orderedItems } = getGroupedSlashCommands(current.query);
    if (key === "ArrowDown" || key === "ArrowUp") {
      const delta = key === "ArrowDown" ? 1 : -1;
      const selectedIndex = orderedItems.length
        ? Math.max(0, Math.min(orderedItems.length - 1, current.selectedIndex + delta))
        : 0;
      const next = { ...current, selectedIndex };
      slashMenuRef.current = next;
      setSlashMenu(next);
      return true;
    }
    if (key === "Enter" || key === "Tab") {
      if (orderedItems.length) {
        const chosen = orderedItems[current.selectedIndex] || orderedItems[0];
        handleExecuteSlashCommand(chosen);
      }
      return true;
    }
    if (key === "Escape") {
      slashMenuRef.current = null;
      setSlashMenu(null);
      return true;
    }
    return false;
  };

  // Initialize CodeMirror 6 EditorView on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      markdown({
          extensions: [Table, TaskList, Strikethrough]
        }),
      livePreviewFocus,
      livePreviewPlugin,
      cm6TableLinkHandler.of((url) => callbacksRef.current.onOpenLink?.(url)),
        drawSelection(),
        dropCursor(),
        typoraCM6Theme,
        history(),
        Prec.highest(keymap.of([
          { key: "ArrowDown", run: () => handleSlashMenuKey("ArrowDown") },
          { key: "ArrowUp", run: () => handleSlashMenuKey("ArrowUp") },
          { key: "Enter", run: () => handleSlashMenuKey("Enter") },
          { key: "Tab", run: () => handleSlashMenuKey("Tab") },
          { key: "Escape", run: () => handleSlashMenuKey("Escape") }
        ])),
        cm6VerticalNavigation,
        keymap.of([...typoraCM6Keymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        readOnlyCompartmentRef.current.of([
          EditorView.editable.of(!readingMode),
          EditorState.readOnly.of(readingMode),
          EditorState.changeFilter.of(() => !readingModeRef.current)
        ]),
      EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            isInternalChangeRef.current = true;
            callbacksRef.current.onChangeFullMarkdown(update.state.doc.toString());
            isInternalChangeRef.current = false;
          }
          if (update.selectionSet && callbacksRef.current.onSelectionChange) {
            const sel = update.state.selection.main;
            const text = update.state.sliceDoc(sel.from, sel.to);
            callbacksRef.current.onSelectionChange(text);
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            callbacksRef.current.onAiSelectionRangeChange?.(sel.empty ? null : { from: sel.from, to: sel.to });
          }
          if (typewriterModeRef.current && (update.docChanged || update.selectionSet)) {
            const head = update.state.selection.main.head;
            update.view.dispatch({
              effects: EditorView.scrollIntoView(head, { y: "center" })
            });
          }
          if ((update.docChanged || update.selectionSet) && !readingModeRef.current) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            const textBefore = line.text.slice(0, head - line.from);
            const slashMatch = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9_\u4e00-\u9fa5-]*)$/);
            if (slashMatch) {
              const query = slashMatch[1] || "";
              const slashStart = head - slashMatch[0].trim().length;
              const coords = update.view.coordsAtPos(head);
              setSlashMenu({
                query,
                from: slashStart,
                to: head,
                selectedIndex: 0,
                coords: coords ? { x: coords.left, y: coords.bottom + 6 } : null
              });
            } else {
              setSlashMenu(null);
            }
          }
        }),
        EditorView.domEventHandlers({
          copy(event, view) {
            const sel = view.state.selection.main;
            if (!sel.empty && event.clipboardData) {
              event.preventDefault();
              const sourceText = view.state.sliceDoc(sel.from, sel.to);
              event.clipboardData.setData("text/plain", sourceText);
              event.clipboardData.setData("text/markdown", sourceText);
            }
          },
          click(event, view) {
            const target = event.target as HTMLElement | null;
            const linkEl = target?.closest(".cm-link-text") as HTMLElement | null;
            if (linkEl && callbacksRef.current.onOpenLink) {
              const pos = view.posAtDOM(linkEl);
              const line = view.state.doc.lineAt(pos);
              const urlMatch = line.text.match(/\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
              if (urlMatch && urlMatch[1]) {
                callbacksRef.current.onOpenLink(urlMatch[1]);
              }
            }
          },
          contextmenu(event, view) {
            const sel = view.state.selection.main;
            if (!sel.empty && callbacksRef.current.onSelectionChange) {
              const text = view.state.sliceDoc(sel.from, sel.to);
              callbacksRef.current.onSelectionChange(text);
            }
            if (callbacksRef.current.onContextMenuRequest) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              callbacksRef.current.onContextMenuRequest(event as unknown as React.MouseEvent, pos);
            }
          }
        })
    ];
    const startState = restoreCM6EditorState(documentId || "", initialMarkdown, extensions, historySnapshot);
    if (historySnapshot) callbacksRef.current.onHistorySnapshot?.(null);

    const view = new EditorView({
      state: startState,
      parent: containerRef.current
    });

    viewRef.current = view;
    const selection = view.state.selection.main;
    callbacksRef.current.onAiSelectionRangeChange?.(selection.empty ? null : { from: selection.from, to: selection.to });
    callbacksRef.current.onAiEditorApiChange?.({
      getSelection: () => {
        const current = view.state.selection.main;
        return { from: current.from, to: current.to, cursor: current.head };
      },
      applyText: (from, to, expectedText, text) => {
        if (readingModeRef.current) return false;
        const transaction = createAiEditTransaction(view.state, from, to, expectedText, text);
        if (!transaction) return false;
        view.dispatch(transaction);
        return true;
      },
      undo: () => !view.state.readOnly && undo(view),
      redo: () => !view.state.readOnly && redo(view),
      canUndo: () => !view.state.readOnly && undoDepth(view.state) > 0,
      canRedo: () => !view.state.readOnly && redoDepth(view.state) > 0
    });

    return () => {
      callbacksRef.current.onHistorySnapshot?.(captureCM6HistorySnapshot(documentId || "", view.state));
      view.destroy();
      viewRef.current = null;
      callbacksRef.current.onAiEditorApiChange?.(null);
    };
  }, [documentId]); // A new document gets a fresh EditorView and isolated history.

  // Synchronize external markdown changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isInternalChangeRef.current) return;

    const currentDoc = view.state.doc.toString();
    if (initialMarkdown !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: initialMarkdown }
      });
    }
  }, [initialMarkdown]);

  // Center cursor line when typewriterMode is enabled
  useEffect(() => {
    const view = viewRef.current;
    if (typewriterMode && view) {
      const head = view.state.selection.main.head;
      view.dispatch({
        effects: EditorView.scrollIntoView(head, { y: "center" })
      });
    }
  }, [typewriterMode]);

  function handleExecuteSlashCommand(item: SlashCommandItem) {
    const view = viewRef.current;
    const sm = slashMenuRef.current;
    if (!view || !sm) return;

    if (item.action) {
      view.dispatch({
        changes: { from: sm.from, to: sm.to, insert: "" }
      });
      slashMenuRef.current = null;
      setSlashMenu(null);
      callbacksRef.current.onTriggerAiAction?.(item.action);
      return;
    }

    if (item.id === "toc") {
      const line = view.state.doc.lineAt(sm.from);
      const transaction = buildTocSlashCommandTransaction(line.from, line.text, sm.from, sm.to);
      view.dispatch({
        changes: { from: transaction.from, to: transaction.to, insert: transaction.insert },
        selection: { anchor: transaction.cursor }
      });
      slashMenuRef.current = null;
      setSlashMenu(null);
      view.focus();
      return;
    }

    const template = item.template || "";
    view.dispatch({
      changes: { from: sm.from, to: sm.to, insert: template },
      selection: {
        anchor: sm.from + (typeof item.cursorOffset === "number" ? item.cursorOffset : template.length)
      }
    });
    slashMenuRef.current = null;
    setSlashMenu(null);
    view.focus();
  };

  // Synchronize readOnly state
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorView.editable.of(!readingMode),
        EditorState.readOnly.of(readingMode),
        EditorState.changeFilter.of(() => !readingModeRef.current)
      ])
    });
  }, [readingMode]);

  const lineWidthClass =
    preferences.lineWidth === "wide"
      ? "line-width-wide"
      : preferences.lineWidth === "full"
      ? "line-width-full"
      : "";

  return (
    <div className="cm-stage-wrapper">
      <div
        id="write"
        className={`is-node cm-write-container ${lineWidthClass} ${
          typewriterMode ? "ty-typewriter-active" : ""
        }`}
        style={{
          fontSize: `${preferences.fontSize}px`,
          "--editor-font-size": `${preferences.fontSize}px`,
          outline: "none"
        } as React.CSSProperties}
        ref={containerRef}
      />
      {slashMenu && slashMenu.coords && (
        <div
          style={{
            position: "fixed",
            left: Math.max(16, Math.min(window.innerWidth - 360, slashMenu.coords.x)),
            top: Math.min(window.innerHeight - 340, slashMenu.coords.y),
            zIndex: 600
          }}
        >
          <SlashCommandMenu
            filterText={slashMenu.query}
            selectedIndex={slashMenu.selectedIndex}
            onSelect={handleExecuteSlashCommand}
            onClose={() => setSlashMenu(null)}
            onHoverIndex={(idx) =>
              setSlashMenu((prev) =>
                prev ? { ...prev, selectedIndex: idx } : null
              )
            }
          />
        </div>
      )}
    </div>
  );
};
