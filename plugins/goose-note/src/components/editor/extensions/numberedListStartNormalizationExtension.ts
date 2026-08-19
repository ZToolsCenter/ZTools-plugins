import { createExtension } from "@blocknote/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";

const PLUGIN_KEY = new PluginKey("goose-numbered-list-start-normalization");

/**
 * 找出同一 blockGroup 内非首项有序列表节点上冗余的 start 属性。
 * 嵌套 blockGroup 会独立扫描，显式起始序号不会跨层级或跨非列表块传播。
 */
function findRedundantStartPositions(doc: PMNode): number[] {
  const positions: number[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "blockGroup") return true;

    let previousWasNumbered = false;
    node.forEach((container, offset) => {
      const content =
        container.type.name === "blockContainer" ? container.firstChild : null;
      const isNumbered = content?.type.name === "numberedListItem";

      if (isNumbered && previousWasNumbered && content?.attrs.start != null) {
        // blockGroup 内容起点 + child offset + blockContainer 内容起点。
        positions.push(pos + 1 + offset + 1);
      }
      previousWasNumbered = isNumbered;
    });

    return true;
  });

  return positions;
}

function numberedListStartNormalizationPlugin(usesRawContentRef: {
  current: boolean;
}) {
  return new Plugin({
    key: PLUGIN_KEY,
    appendTransaction(
      transactions: readonly Transaction[],
      _oldState: EditorState,
      newState: EditorState,
    ) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (usesRawContentRef.current) return null;

      const positions = findRedundantStartPositions(newState.doc);
      if (positions.length === 0) return null;

      const tr = newState.tr;
      for (const pos of positions) {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "numberedListItem") continue;
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          start: undefined,
        });
      }
      return tr.steps.length > 0 ? tr : null;
    },
  });
}

export function createGooseNumberedListStartNormalizationExtension(usesRawContentRef: {
  current: boolean;
}) {
  return createExtension({
    key: "goose-numbered-list-start-normalization",
    prosemirrorPlugins: [
      numberedListStartNormalizationPlugin(usesRawContentRef),
    ],
  });
}
