import { createExtension } from "@blocknote/core";
import { AllSelection, NodeSelection, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";

const findAncestorDepthByTableRole = ($pos: any, roles: string[]) => {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const tableRole = $pos.node(depth).type.spec?.tableRole;
    if (tableRole && roles.includes(tableRole)) {
      return depth;
    }
  }
  return -1;
};

export const gooseSelectAllExtension = createExtension({
  key: "goose-select-all",
  keyboardShortcuts: {
    "Mod-a": ({ editor }) => {
      const state = editor.prosemirrorState;
      const selection = state.selection;

      const $from = selection.$from;
      let blockContainerDepth = -1;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "blockContainer") {
          blockContainerDepth = d;
          break;
        }
      }

      if (blockContainerDepth < 0) {
        return false;
      }

      const cellDepth = findAncestorDepthByTableRole($from, ["cell", "header_cell"]);
      if (cellDepth >= 0) {
        const cellPos = $from.before(cellDepth);
        const blockPos = $from.before(blockContainerDepth);
        const cellStart = $from.start(cellDepth);
        const cellEnd = $from.end(cellDepth);
        const isCellTextFullySelected =
          selection instanceof TextSelection &&
          selection.from <= cellStart &&
          selection.to >= cellEnd;
        const isSingleCellSelection =
          selection instanceof CellSelection &&
          selection.$anchorCell.pos === cellPos &&
          selection.$headCell.pos === cellPos;
        const isTableBlockSelected =
          selection instanceof NodeSelection && selection.from === blockPos;

        if (isTableBlockSelected || selection instanceof AllSelection) {
          const allSel = new AllSelection(state.doc);
          editor.prosemirrorView.dispatch(state.tr.setSelection(allSel));
          return true;
        }

        if (isCellTextFullySelected || selection instanceof CellSelection) {
          const nodeSel = NodeSelection.create(state.doc, blockPos);
          editor.prosemirrorView.dispatch(state.tr.setSelection(nodeSel));
          return true;
        }

        if (!isSingleCellSelection) {
          const cellSel = CellSelection.create(state.doc, cellPos);
          editor.prosemirrorView.dispatch(state.tr.setSelection(cellSel));
          return true;
        }
      }

      const blockContentDepth = blockContainerDepth + 1;
      const blockContentNode =
        blockContentDepth <= $from.depth ? $from.node(blockContentDepth) : null;
      const isCodeBlock =
        blockContentNode?.type?.name === "codeBlock" ||
        (blockContentNode?.attrs as { type?: string } | undefined)?.type ===
          "codeBlock";

      if (isCodeBlock) {
        const codeStart = $from.start(blockContentDepth);
        const codeEnd = $from.end(blockContentDepth);
        const isCodeFullySelected =
          selection instanceof TextSelection &&
          selection.from <= codeStart &&
          selection.to >= codeEnd;

        if (isCodeFullySelected || selection instanceof AllSelection) {
          const allSel = new AllSelection(state.doc);
          editor.prosemirrorView.dispatch(state.tr.setSelection(allSel));
          return true;
        }

        const tr = state.tr.setSelection(
          TextSelection.create(state.doc, codeStart, codeEnd),
        );
        editor.prosemirrorView.dispatch(tr);
        return true;
      }

      // 选区范围必须限定在「块的内容节点」(heading/paragraph 的 inline 内容)，
      // 不能用 blockContainerDepth——后者的 start/end 是 blockContainer 的边界位置，
      // 会把块结构边界(含与下一块的边界)圈进选区。一旦删除，相邻块会被合并，
      // 下一块内容继承本块类型(标题块场景下：下一行正文被升成 H1，严重 bug)。
      // 用 blockContentDepth 的 start/end 精确取 inline 文字范围，删除只清文字、保留块本身。
      const hasInlineContent =
        blockContentNode != null && blockContentDepth <= $from.depth;
      const blockStart = hasInlineContent
        ? $from.start(blockContentDepth)
        : $from.start(blockContainerDepth);
      const blockEnd = hasInlineContent
        ? $from.end(blockContentDepth)
        : $from.end(blockContainerDepth);

      let isBlockFullySelected = false;

      if (selection instanceof AllSelection) {
        isBlockFullySelected = true;
      } else if (selection instanceof NodeSelection) {
        const blockPos = $from.before(blockContainerDepth);
        isBlockFullySelected = selection.from === blockPos;
      } else if (selection instanceof TextSelection) {
        isBlockFullySelected =
          selection.from <= blockStart && selection.to >= blockEnd;
      }

      const blockGroup = state.doc.firstChild;
      const titleBlock = blockGroup?.firstChild;
      const titleContent = titleBlock?.firstChild;
      const hasTitleHeading =
        blockGroup?.type.name === "blockGroup" &&
        !!titleBlock &&
        titleContent?.type.name === "heading" &&
        Number((titleContent as any).attrs?.level) === 1;

      const startedInTitle =
        hasTitleHeading && $from.before(blockContainerDepth) === 1;

      let bodyRange: { from: number; to: number } | null = null;
      if (hasTitleHeading && titleBlock && blockGroup) {
        const afterTitle = 1 + titleBlock.nodeSize;
        const blockGroupEnd = state.doc.content.size - 1;
        if (afterTitle < blockGroupEnd) {
          bodyRange = { from: afterTitle, to: blockGroupEnd };
        }
      }

      const isBodyRangeSelected =
        !!bodyRange &&
        selection instanceof TextSelection &&
        selection.from <= bodyRange.from + 1 &&
        selection.to >= bodyRange.to - 1;

      if (isBlockFullySelected) {
        if (bodyRange && !startedInTitle && !isBodyRangeSelected) {
          const bodySel = TextSelection.create(
            state.doc,
            bodyRange.from,
            bodyRange.to,
          );
          editor.prosemirrorView.dispatch(state.tr.setSelection(bodySel));
          return true;
        }
        const allSel = new AllSelection(state.doc);
        editor.prosemirrorView.dispatch(state.tr.setSelection(allSel));
        return true;
      }

      if (isBodyRangeSelected) {
        const allSel = new AllSelection(state.doc);
        editor.prosemirrorView.dispatch(state.tr.setSelection(allSel));
        return true;
      }

      const tr = state.tr;
      if (blockStart === blockEnd) {
        const blockPos = $from.before(blockContainerDepth);
        const nodeSel = NodeSelection.create(state.doc, blockPos);
        tr.setSelection(nodeSel);
      } else {
        const textSel = TextSelection.create(state.doc, blockStart, blockEnd);
        tr.setSelection(textSel);
      }
      editor.prosemirrorView.dispatch(tr);
      return true;
    },
  },
});
