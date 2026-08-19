import { useEditorState } from "@blocknote/react";
import {
  blockHasType,
  defaultProps,
  editorHasBlockWithType,
  mapTableCell,
  type BlockNoteEditor,
  type TableContent,
} from "@blocknote/core";
import { TableHandlesExtension } from "@blocknote/core/extensions";
import { CellSelection } from "prosemirror-tables";

export const NON_FORMATTABLE_TYPES = new Set([
  "image",
  "file",
  "audio",
  "video",
  "divider",
  // table 内是可格式化的单元格文字：选中后应显示文字工具栏 / AI。
  // 不可格式化的是整块媒体/代码，不是表格容器本身。
  "codeBlock",
]);

export const BOOLEAN_MARK_NAMES = [
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
] as const;
export type BooleanMarkName = (typeof BOOLEAN_MARK_NAMES)[number];

/**
 * Walk the selection so partial-coverage marks register as inactive.
 * BlockNote's useActiveStyles() only inspects selection.$to which misses ranges.
 */
export function useSelectionMarkStates(editor: BlockNoteEditor<any, any, any>) {
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      const { selection, doc } = editor.prosemirrorState;
      const from = selection.from;
      const to = selection.to;

      const result: Record<BooleanMarkName, boolean> = {
        bold: false,
        italic: false,
        strike: false,
        underline: false,
        code: false,
      };

      if (from === to) {
        const marks = selection.$to.marks();
        for (const name of BOOLEAN_MARK_NAMES) {
          result[name] = marks.some((m: any) => m.type.name === name);
        }
        return result;
      }

      const counts: Record<BooleanMarkName, { with: number; total: number }> = {
        bold: { with: 0, total: 0 },
        italic: { with: 0, total: 0 },
        strike: { with: 0, total: 0 },
        underline: { with: 0, total: 0 },
        code: { with: 0, total: 0 },
      };

      doc.nodesBetween(from, to, (node: any) => {
        if (!node.isText) return true;
        for (const name of BOOLEAN_MARK_NAMES) {
          counts[name].total += 1;
          if (node.marks.some((m: any) => m.type.name === name)) {
            counts[name].with += 1;
          }
        }
        return false;
      });

      for (const name of BOOLEAN_MARK_NAMES) {
        result[name] =
          counts[name].total > 0 && counts[name].with === counts[name].total;
      }
      return result;
    },
  });
}

/**
 * 选区是否完全落在同一个不可格式化块内（代码块、图片、视频等）。
 * 仅整段选区都在该块内时禁用工具栏；跨块混合选区（含 Cmd+A 全选）照常显示，
 * 避免「文档里有一个代码块就无法全选加粗」。
 *
 * 直读 prosemirrorState：
 * BlockNote 的 getSelection()/getTextCursorPosition() 在 useEditorState
 * selector 回调里可能因事务重入抛错，不能依赖。PM 节点名与 block type 同名。
 */
export function selectionHasNonFormattableBlock(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection, doc } = editor.prosemirrorState;

  const nearestNonFormattable = ($pos: any) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (NON_FORMATTABLE_TYPES.has(node.type.name)) return node;
    }
    return null;
  };

  const fromNode = nearestNonFormattable(selection.$from);
  if (fromNode && fromNode === nearestNonFormattable(selection.$to)) {
    return true;
  }

  if (selection.empty) return false;

  // 整块选择（例如拖拽选中代码块或代码块独占文档时 Cmd+A）的端点会落在
  // blockContainer / codeBlock 外侧，单看 $from、$to 的祖先会漏判。继续核对
  // 选区实际覆盖的文本：只要所有被选文本都属于同一个不可格式化节点，就隐藏工具栏。
  let coveredNode: any = null;
  let hasSelectedText = false;
  let entirelyNonFormattable = true;

  doc.nodesBetween(selection.from, selection.to, (node: any, pos: number) => {
    if (!entirelyNonFormattable) return false;
    if (!node.isText) return true;

    const selectedFrom = Math.max(selection.from, pos);
    const selectedTo = Math.min(selection.to, pos + node.nodeSize);
    if (selectedFrom >= selectedTo) return false;

    hasSelectedText = true;
    const nonFormattableNode = nearestNonFormattable(doc.resolve(selectedFrom));
    if (!nonFormattableNode) {
      entirelyNonFormattable = false;
      return false;
    }
    if (coveredNode && coveredNode !== nonFormattableNode) {
      entirelyNonFormattable = false;
      return false;
    }
    coveredNode = nonFormattableNode;
    return false;
  });

  return hasSelectedText && entirelyNonFormattable;
}

/** 选区中的全部文字是否都带有行内代码样式。 */
export function selectionIsEntirelyInlineCode(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection, doc } = editor.prosemirrorState;
  if (selection.empty) return false;

  let hasSelectedText = false;
  let entirelyInlineCode = true;

  doc.nodesBetween(selection.from, selection.to, (node: any, pos: number) => {
    if (!entirelyInlineCode) return false;
    if (!node.isText) return true;

    const selectedFrom = Math.max(selection.from, pos);
    const selectedTo = Math.min(selection.to, pos + node.nodeSize);
    if (selectedFrom >= selectedTo) return false;

    hasSelectedText = true;
    if (!node.marks.some((mark: any) => mark.type.name === "code")) {
      entirelyInlineCode = false;
    }
    return false;
  });

  return hasSelectedText && entirelyInlineCode;
}

export function selectionDisallowsFormattingToolbar(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  // 纯行内 code 选区仍应显示工具栏，方便一键取消 code（Mod+E / 工具栏切换）。
  // 代码块、媒体等非格式化块才真正禁用。
  return selectionHasNonFormattableBlock(editor);
}

/**
 * 选区是否完全落在标题一（文档物理首块、heading level 1）内部。
 * 跨块选区（含 Cmd+A 全选）返回 false，保证全选时工具栏可用。
 * 虚拟标题不在 BlockNote 文档里，调用方应按 contentMode 自行豁免。
 */
export function selectionIsInsideFirstTitleBlock(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection, doc } = editor.prosemirrorState;
  // doc > blockGroup > blockContainer
  const firstContainer = doc.firstChild?.firstChild ?? null;
  if (!firstContainer) return false;

  const nearestContainer = ($pos: any) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (node.type.name === "blockContainer") return node;
    }
    return null;
  };

  const fromContainer = nearestContainer(selection.$from);
  if (!fromContainer || fromContainer !== nearestContainer(selection.$to)) {
    return false;
  }
  if (fromContainer !== firstContainer) return false;

  const contentNode = fromContainer.firstChild;
  return (
    contentNode?.type.name === "heading" && contentNode.attrs?.level === 1
  );
}

/**
 * 选区是否完全落在 heading 块内部（任意 level 1-6，文档任意位置）。
 * 跨块混合选区（含 Cmd+A 全选）返回 false，保证全选时不误伤。
 * 用于禁用 heading 内的字符级样式（bold/italic/underline/strike/code）。
 */
export function selectionIsInsideHeadingBlock(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection } = editor.prosemirrorState;
  const nearestContainer = ($pos: any) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (node.type.name === "blockContainer") return node;
    }
    return null;
  };
  const fromContainer = nearestContainer(selection.$from);
  if (!fromContainer || fromContainer !== nearestContainer(selection.$to)) {
    return false;
  }
  const contentNode = fromContainer.firstChild;
  return contentNode?.type.name === "heading";
}

export function shouldRenderFormattingToolbar(
  editor: BlockNoteEditor<any, any, any>,
) {
  const { selection, doc } = editor.prosemirrorState;

  if (selection.empty) return false;
  // 单元格 / 多 cell 选区：只要覆盖到实际文字就允许工具栏（含 AI）。
  if (doc.textBetween(selection.from, selection.to).length === 0) return false;
  // 代码块、媒体块等非格式化块不触发格式工具栏。
  // 纯行内 code 选区仍允许（便于取消 code / 改其它样式 / AI）。
  // 表格已从 NON_FORMATTABLE 移除，单元格文字可选中后加粗/着色/调 AI。
  if (selectionDisallowsFormattingToolbar(editor)) return false;

  return true;
}

/**
 * AI 菜单需要 block id 锚点。表格 / CellSelection 下 getTextCursorPosition 可能抛错，
 * 依次回退：光标块 → 选区首块 → 选区起点最近 blockContainer。
 */
export function resolveFormattingToolbarAiBlockId(
  editor: BlockNoteEditor<any, any, any>,
): string | null {
  try {
    const cursorBlock = editor.getTextCursorPosition()?.block;
    if (cursorBlock?.id) return cursorBlock.id;
  } catch {
    /* table cell selection */
  }

  try {
    const selected = editor.getSelection()?.blocks;
    const first = selected?.[0];
    if (first?.id) return first.id;
  } catch {
    /* ignore */
  }

  try {
    const { selection, doc } = editor.prosemirrorState;
    const $pos = selection.$from;
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (node.type.name === "blockContainer" && typeof node.attrs?.id === "string") {
        return node.attrs.id;
      }
    }
    // 少数 schema 把 id 挂在内容节点上
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (typeof node.attrs?.id === "string" && node.attrs.id) {
        return node.attrs.id;
      }
    }
    void doc;
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * 选区是否完全落在同一个表格单元格内。
 */
export function isSelectionInsideSingleCell(selection: any): boolean {
  const $from = selection.$from;
  const $to = selection.$to;
  if (!$from || !$to) return false;
  const fromCell = findAncestorOfRole($from, "cell");
  const toCell = findAncestorOfRole($to, "cell");
  if (!fromCell || !toCell) return false;
  return fromCell.depth === toCell.depth && fromCell.pos === toCell.pos;
}

function findAncestorOfRole(
  $pos: any,
  role: "cell" | "row" | "table",
): { depth: number; pos: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    const nodeRole = node?.type?.spec?.tableRole;
    const matches =
      nodeRole === role ||
      (role === "cell" && nodeRole === "header_cell");
    if (matches) {
      return { depth: d, pos: $pos.before(d) };
    }
  }
  return null;
}

// ── Selection mode + capabilities + alignment ──────────────────────────────

export type FormattingSelectionMode =
  | "none"
  | "cellText" // text selection touching table (single continuous text range inside table)
  | "cellGrid" // prosemirror-tables CellSelection (multi-cell grid)
  | "singleBlock" // one non-table block
  | "multiBlock"; // ≥2 blocks

export type FormattingTextAlignment = "left" | "center" | "right";

export interface FormattingToolbarCapabilities {
  mode: FormattingSelectionMode;
  showMarks: boolean; // bold/italic/strike/underline/code
  showColors: boolean;
  showLink: boolean;
  showAlign: boolean;
  showAi: boolean; // presence of extractable text; AI enabled is UI concern
  showClear: boolean;
  textAlignment: FormattingTextAlignment;
}

type RelativeCell = { row: number; col: number };

type CellSelectionInfo = {
  from: RelativeCell;
  to: RelativeCell;
  cells: RelativeCell[];
};

/** 选区是否触及表格（tableRole 或 type.name === "table"）。 */
function selectionTouchesTable(selection: {
  $from: any;
  $to: any;
}): boolean {
  if (findAncestorOfRole(selection.$from, "table")) return true;
  if (findAncestorOfRole(selection.$to, "table")) return true;
  for (const $pos of [selection.$from, selection.$to]) {
    for (let d = $pos.depth; d > 0; d -= 1) {
      if ($pos.node(d)?.type?.name === "table") return true;
    }
  }
  return false;
}

/**
 * Safe selected-blocks lookup. Table / CellSelection 下 getSelection 可能抛错。
 */
export function getSelectedBlocksSafe(
  editor: BlockNoteEditor<any, any, any>,
): any[] {
  try {
    const selected = editor.getSelection()?.blocks;
    if (selected && selected.length > 0) return selected;
  } catch {
    /* table cell selection */
  }

  try {
    const cursorBlock = editor.getTextCursorPosition()?.block;
    if (cursorBlock) return [cursorBlock];
  } catch {
    /* ignore */
  }

  // PM 回退：收集选区覆盖的 blockContainer id 对应块
  try {
    const { selection, doc } = editor.prosemirrorState;
    const ids = new Set<string>();
    doc.nodesBetween(selection.from, selection.to, (node: any) => {
      if (
        node.type?.name === "blockContainer" &&
        typeof node.attrs?.id === "string"
      ) {
        ids.add(node.attrs.id);
      }
      return true;
    });
    if (ids.size === 0) {
      for (let d = selection.$from.depth; d > 0; d -= 1) {
        const node = selection.$from.node(d);
        if (
          node.type?.name === "blockContainer" &&
          typeof node.attrs?.id === "string"
        ) {
          ids.add(node.attrs.id);
          break;
        }
      }
    }
    if (ids.size === 0) return [];
    return editor.document.filter((block: any) => ids.has(block.id));
  } catch {
    return [];
  }
}

/**
 * Resolve table cell indices for the current selection.
 * Prefers TableHandlesExtension; falls back to ProseMirror tableRole walk.
 */
export function getCellSelectionSafe(
  editor: BlockNoteEditor<any, any, any>,
): CellSelectionInfo | undefined {
  try {
    const cellSelection = editor
      .getExtension(TableHandlesExtension)
      ?.getCellSelection();
    if (cellSelection?.cells?.length) return cellSelection;
  } catch {
    /* extension unavailable or unit env quirks */
  }

  return resolveCellSelectionFromPm(editor);
}

/**
 * PM fallback when TableHandlesExtension.getCellSelection is unavailable.
 * Uses tableRole ancestors + $pos.index for row/col indices.
 */
function resolveCellSelectionFromPm(
  editor: BlockNoteEditor<any, any, any>,
): CellSelectionInfo | undefined {
  try {
    const { selection } = editor.prosemirrorState;
    const $from = selection.$from;
    const $to = selection.$to;

    if (
      !findAncestorOfRole($from, "cell") ||
      !findAncestorOfRole($to, "cell")
    ) {
      return undefined;
    }

    const indicesAt = ($pos: any): RelativeCell | null => {
      let row = -1;
      let col = -1;
      for (let d = $pos.depth; d > 0; d -= 1) {
        const node = $pos.node(d);
        const role = node.type?.spec?.tableRole;
        if (role === "cell" || role === "header_cell") {
          col = $pos.index(d - 1);
        } else if (role === "row") {
          row = $pos.index(d - 1);
        }
      }
      if (row < 0 || col < 0) return null;
      return { row, col };
    };

    const from = indicesAt($from);
    const to = indicesAt($to);
    if (!from || !to) return undefined;

    const minRow = Math.min(from.row, to.row);
    const maxRow = Math.max(from.row, to.row);
    const minCol = Math.min(from.col, to.col);
    const maxCol = Math.max(from.col, to.col);
    const cells: RelativeCell[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        cells.push({ row, col });
      }
    }

    return { from, to, cells };
  } catch {
    return undefined;
  }
}

function blockSupportsTextAlignment(
  editor: BlockNoteEditor<any, any, any>,
  block: any,
): boolean {
  if (!block) return false;
  try {
    return blockHasType(block, editor, block.type, {
      textAlignment: defaultProps.textAlignment,
    });
  } catch {
    return false;
  }
}

function normalizeTextAlignment(value: unknown): FormattingTextAlignment {
  if (value === "center" || value === "right" || value === "left") {
    return value;
  }
  return "left";
}

function selectionHasExtractableText(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection, doc } = editor.prosemirrorState;
  if (selection.empty) return false;
  return doc.textBetween(selection.from, selection.to).length > 0;
}

/**
 * 是否应显示对齐控件：
 * - 无任何选中块支持 textAlignment，且无表格单元格选区 → false
 * - 表格无 getCellSelection() 且无块级 textAlignment → false
 */
export function canShowAlign(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const blocks = getSelectedBlocksSafe(editor);
  const cellSelection = getCellSelectionSafe(editor);

  let anySupports = false;
  let hasTable = false;
  for (const block of blocks) {
    if (blockSupportsTextAlignment(editor, block)) {
      anySupports = true;
      break;
    }
    if (block?.type === "table") {
      hasTable = true;
    }
  }

  if (anySupports) return true;
  if (hasTable && cellSelection) return true;
  if (
    cellSelection &&
    selectionTouchesTable(editor.prosemirrorState.selection)
  ) {
    return true;
  }
  return false;
}

export function getFormattingSelectionMode(
  editor: BlockNoteEditor<any, any, any>,
): FormattingSelectionMode {
  const { selection, doc } = editor.prosemirrorState;

  if (selection.empty) return "none";
  if (doc.textBetween(selection.from, selection.to).length === 0) {
    return "none";
  }

  if (selection instanceof CellSelection) {
    return "cellGrid";
  }

  if (selectionTouchesTable(selection)) {
    return "cellText";
  }

  let blockCount = 0;
  try {
    blockCount = editor.getSelection()?.blocks?.length ?? 0;
  } catch {
    blockCount = 0;
  }
  if (blockCount <= 1) {
    // getSelection 在 AllSelection / 部分 PM 选区可能为空；回退 safe + 容器计数
    const safeCount = getSelectedBlocksSafe(editor).length;
    blockCount = Math.max(blockCount, safeCount);
  }
  if (blockCount <= 1) {
    const { selection, doc } = editor.prosemirrorState;
    const ids = new Set<string>();
    doc.nodesBetween(selection.from, selection.to, (node: any) => {
      if (
        node.type?.name === "blockContainer" &&
        typeof node.attrs?.id === "string"
      ) {
        ids.add(node.attrs.id);
      }
      return true;
    });
    blockCount = Math.max(blockCount, ids.size);
  }

  if (blockCount > 1) return "multiBlock";
  return "singleBlock";
}

/**
 * 读取当前选区文字对齐（块级 props 或表格选中单元格）。
 * 对齐算法对齐 BlockNote TextAlignButton；表格优先首个选中单元格。
 */
export function getSelectionTextAlignment(
  editor: BlockNoteEditor<any, any, any>,
): FormattingTextAlignment {
  const blocks = getSelectedBlocksSafe(editor);
  const first = blocks[0];
  if (!first) return "left";

  if (blockSupportsTextAlignment(editor, first)) {
    return normalizeTextAlignment(
      (first.props as { textAlignment?: string } | undefined)?.textAlignment,
    );
  }

  if (first.type === "table") {
    const cellSel = getCellSelectionSafe(editor);
    const content = first.content as TableContent<any, any> | undefined;
    if (cellSel && content?.rows) {
      const anchor = cellSel.cells[0] ?? cellSel.from;
      const raw = content.rows[anchor.row]?.cells?.[anchor.col];
      if (raw != null) {
        const cell = mapTableCell(raw);
        return normalizeTextAlignment(cell.props.textAlignment);
      }
    }
    return "left";
  }

  return "left";
}

export function getFormattingToolbarCapabilities(
  editor: BlockNoteEditor<any, any, any>,
  options?: { isInHeading?: boolean },
): FormattingToolbarCapabilities {
  const mode = getFormattingSelectionMode(editor);
  const isInHeading = Boolean(options?.isInHeading);
  const hasText = mode !== "none" && selectionHasExtractableText(editor);
  const textAlignment = getSelectionTextAlignment(editor);

  if (mode === "none") {
    return {
      mode,
      showMarks: false,
      showColors: false,
      showLink: false,
      showAlign: false,
      showAi: false,
      showClear: false,
      textAlignment,
    };
  }

  if (mode === "cellText") {
    return {
      mode,
      showMarks: !isInHeading,
      showColors: true,
      showLink: true,
      showAlign: true,
      showAi: true,
      showClear: true,
      textAlignment,
    };
  }

  if (mode === "cellGrid") {
    return {
      mode,
      showMarks: hasText,
      showColors: hasText,
      showLink: false,
      showAlign: true,
      showAi: hasText,
      showClear: hasText,
      textAlignment,
    };
  }

  if (mode === "singleBlock") {
    return {
      mode,
      showMarks: !isInHeading,
      showColors: true,
      showLink: true,
      showAlign: canShowAlign(editor),
      showAi: true,
      showClear: true,
      textAlignment,
    };
  }

  // multiBlock
  return {
    mode,
    showMarks: !isInHeading,
    showColors: true,
    showLink: false,
    showAlign: canShowAlign(editor),
    showAi: true,
    showClear: true,
    textAlignment,
  };
}

/**
 * Apply text alignment to the current selection.
 * Follows BlockNote TextAlignButton: block props for paragraphs, cell props for tables.
 */
function applyAlignmentToSelection(
  editor: BlockNoteEditor<any, any, any>,
  alignment: FormattingTextAlignment,
): void {
  const blocks = getSelectedBlocksSafe(editor);

  for (const block of blocks) {
    if (
      blockHasType(block, editor, block.type, {
        textAlignment: defaultProps.textAlignment,
      }) &&
      editorHasBlockWithType(editor, block.type, {
        textAlignment: defaultProps.textAlignment,
      })
    ) {
      editor.updateBlock(block, {
        props: { textAlignment: alignment },
      });
      continue;
    }

    if (block.type !== "table") continue;

    const cellSelection = getCellSelectionSafe(editor);
    if (!cellSelection?.cells?.length) continue;

    const content = block.content as TableContent<any, any>;
    if (!content?.rows) continue;

    const newTable = content.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => mapTableCell(cell)),
    }));

    for (const { row, col } of cellSelection.cells) {
      const target = newTable[row]?.cells?.[col];
      if (!target) continue;
      target.props.textAlignment = alignment;
    }

    editor.updateBlock(block, {
      type: "table",
      content: {
        ...content,
        type: "tableContent",
        rows: newTable,
      } as any,
    });

    // updateBlock 会把选区移出表格，需复位光标（官方 TextAlignButton 同路径）
    try {
      editor.setTextCursorPosition(block);
    } catch {
      /* ignore */
    }
  }
}

export function applySelectionTextAlignment(
  editor: BlockNoteEditor<any, any, any>,
  alignment: FormattingTextAlignment,
): void {
  try {
    editor.focus();
  } catch {
    /* ignore */
  }
  editor.transact(() => {
    applyAlignmentToSelection(editor, alignment);
  });
}

/**
 * Clear inline marks / colors and reset text alignment on the selection.
 */
export function clearSelectionFormatting(
  editor: BlockNoteEditor<any, any, any>,
): void {
  try {
    editor.focus();
  } catch {
    /* ignore */
  }
  editor.transact(() => {
    try {
      editor.removeStyles({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        code: true,
        textColor: true,
        backgroundColor: true,
      } as any);
    } catch {
      /* ignore */
    }
    applyAlignmentToSelection(editor, "left");
  });
}
