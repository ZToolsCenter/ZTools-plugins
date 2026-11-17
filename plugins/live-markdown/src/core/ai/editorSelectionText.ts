/**
 * Reads native DOM selection text only when it belongs entirely to the editor.
 * `null` means the selection is unrelated to the editor and must be ignored;
 * an empty string means the editor selection was collapsed or blank and should
 * clear any previously tracked AI selection.
 */
export function readEditorSelectionText(
  selection: Selection | null,
  editor: HTMLElement | null
): string | null {
  if (!selection || !editor || selection.rangeCount !== 1) return null;

  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return null;
  }

  if (selection.isCollapsed) return "";
  return selection.toString().trim();
}
