import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const LIST_CONTENT_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

const activeListMarkerPlugin = new Plugin({
  key: new PluginKey("goose-active-list-marker"),
  props: {
    decorations(state) {
      const { $head } = state.selection;

      for (let depth = $head.depth; depth > 0; depth -= 1) {
        const node = $head.node(depth);
        if (node.type.name !== "blockContainer") continue;
        if (!LIST_CONTENT_TYPES.has(node.firstChild?.type.name ?? "")) {
          return null;
        }

        const from = $head.before(depth);
        return DecorationSet.create(state.doc, [
          Decoration.node(from, from + node.nodeSize, {
            class: "goose-active-list-marker",
          }),
        ]);
      }

      return null;
    },
  },
});

/** 给 ProseMirror 光标所在列表块添加纯呈现类，不写入 BlockNote 文档。 */
export const gooseActiveListMarkerExtension = createExtension({
  key: "goose-active-list-marker",
  prosemirrorPlugins: [activeListMarkerPlugin],
});
