import { readEditorSelectionText } from "./editorSelectionText";

export type EditorSelectionMode = "cm6" | "source" | "reading" | "legacy";

export interface ScopedEditorSelectionOptions {
  mode: EditorSelectionMode;
  selection: Selection | null;
  editorRoot: HTMLElement | null;
  sourceTextarea: HTMLTextAreaElement | null;
  activeElement?: Element | null;
}

const CM6_READONLY_WIDGET_SELECTOR =
  ".ty-cm6-table-widget, .cm-math-block, .cm-mermaid-block, .cm-alert-block, .cm-frontmatter-card, [contenteditable='false']";

function nodeElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/**
 * Keeps AI selection text aligned with the active editor's authoritative source mapping:
 * - CM6 mode: `CM6LivePreviewEditor` owns `.cm-content` selections via `view.state.selection.main`;
 *   native `selectionchange` only tracks read-only block widgets (which ignore CM6 events).
 * - Source mode: tracks `textarea.ty-source-textarea` while focused.
 * - Legacy / reading mode: tracks native DOM selection inside `#write`.
 */
export function readScopedEditorSelectionText(options: ScopedEditorSelectionOptions): string | null {
  const { mode, selection, editorRoot, sourceTextarea, activeElement } = options;

  if (mode === "source") {
    if (!sourceTextarea) return null;
    const focusedTextarea = activeElement === sourceTextarea || sourceTextarea.contains(activeElement ?? null);
    if (!focusedTextarea) return null;
    const start = sourceTextarea.selectionStart ?? 0;
    const end = sourceTextarea.selectionEnd ?? 0;
    if (start === end) return "";
    return sourceTextarea.value.slice(start, end).trim();
  }

  if (mode === "cm6") {
    if (!selection || !editorRoot || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    if (!editorRoot.contains(range.startContainer) || !editorRoot.contains(range.endContainer)) {
      return null;
    }
    const startWidget = nodeElement(range.startContainer)?.closest(CM6_READONLY_WIDGET_SELECTOR);
    const endWidget = nodeElement(range.endContainer)?.closest(CM6_READONLY_WIDGET_SELECTOR);
    if (!startWidget && !endWidget) return null;
    if (selection.isCollapsed) return "";
    return selection.toString().trim();
  }

  return readEditorSelectionText(selection, editorRoot);
}
