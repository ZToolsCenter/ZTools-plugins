import { CellSelection } from "prosemirror-tables";
import { NodeSelection, type EditorState } from "prosemirror-state";

import { normalizeClipboardLineEndings } from "./clipboard";

/** 当前是否选中了单个图片块；是则返回图片原始引用。 */
export function getSelectedImageUrl(state: EditorState): string | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)) return null;

  const readImageUrl = (node: typeof selection.node): string | null => {
    if (node.type.name !== "image" && node.type.name !== "imageResize") {
      return null;
    }
    const url = node.attrs?.url;
    return typeof url === "string" && url ? url : null;
  };

  const selectedNodeUrl = readImageUrl(selection.node);
  if (selectedNodeUrl) return selectedNodeUrl;

  let imageUrl: string | null = null;
  selection.node.descendants((node) => {
    if (imageUrl) return false;
    imageUrl = readImageUrl(node);
    return !imageUrl;
  });
  return imageUrl;
}

/**
 * 表格单元格选区（CellSelection）的纯文本提取。
 * 选中一个或多个表格单元格时，原生 window.getSelection() 往往是塌缩的——
 * 单元格高亮由 ProseMirror decoration 绘制，DOM 选区并未真正覆盖文字。
 * 复制时需直接从 CellSelection 读单元格文本，绕过 DOM 选区。
 *
 * @returns 选中单元格的纯文本（多格按行连接、同行各格用 Tab 连接）；
 *          当前选区不是 CellSelection 时返回 null（交回常规复制流程）。
 */
export function getSelectedCellPlainText(state: EditorState): string | null {
  const selection = state.selection;
  if (!(selection instanceof CellSelection)) return null;

  // forEachCell 按文档顺序遍历选中单元格；按所在表格行分组，
  // 同行各格用 Tab 连接、行间用换行连接，单格场景即纯单格文本。
  const rows: string[][] = [];
  let lastRowTop = Number.NaN;
  selection.forEachCell((cellNode, cellPos) => {
    const $cell = state.doc.resolve(cellPos);
    const rowTop = $cell.before($cell.depth);
    if (rowTop !== lastRowTop) {
      rows.push([]);
      lastRowTop = rowTop;
    }
    rows[rows.length - 1].push(cellNode.textContent);
  });

  const text = rows.map((cells) => cells.join("\t")).join("\n");
  return normalizeClipboardLineEndings(text);
}

export function getElementFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node instanceof HTMLElement) return node;
  return node.parentElement;
}

export function isInteractiveEditorTarget(target: HTMLElement): boolean {
  return Boolean(
    target.closest(
      [
        "button",
        "input",
        "textarea",
        "select",
        "a",
        "[role='button']",
        "[contenteditable='false']",
        "[data-radix-popper-content-wrapper]",
        "[data-notion-slash-root='true']",
        ".bn-side-menu",
        "[data-formatting-toolbar]",
        "[data-goose-formatting-toolbar-dock]",
        ".bn-table-handle",
        ".goose-table-extend-button",
        ".goose-code-toolbar-host",
      ].join(","),
    ),
  );
}

export function isBottomEditorBlankClick(
  event: React.MouseEvent<HTMLDivElement> | MouseEvent,
  container: HTMLElement,
): boolean {
  const target = event.target as HTMLElement | null;
  if (!target || !container.contains(target)) return false;
  if (isInteractiveEditorTarget(target)) return false;
  if (target.closest(".bn-block-outer, .bn-block-content")) return false;

  const editorSurface = target.closest(
    ".workspace-editor-surface, .bn-container, .bn-root, .bn-editor, .tiptap",
  );
  if (!editorSurface || !container.contains(editorSurface)) return false;

  const blocks = container.querySelectorAll<HTMLElement>(".bn-block-outer");
  const lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) return true;

  return event.clientY >= lastBlock.getBoundingClientRect().bottom;
}

export function getSelectedPlainTextContext(container: HTMLElement): {
  selectedText: string;
  withinCodeBlock: boolean;
} | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const commonAncestor =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!commonAncestor || !container.contains(commonAncestor)) return null;

  const selectedText = normalizeClipboardLineEndings(selection.toString());
  if (!selectedText) return null;

  const startElement = getElementFromNode(range.startContainer);
  const endElement = getElementFromNode(range.endContainer);
  const withinCodeBlock =
    !!startElement?.closest(".goose-code-block-node") &&
    !!endElement?.closest(".goose-code-block-node");

  return {
    selectedText,
    withinCodeBlock,
  };
}
