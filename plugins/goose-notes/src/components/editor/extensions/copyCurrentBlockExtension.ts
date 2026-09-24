import { createExtension } from "@blocknote/core";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type EditorState,
} from "prosemirror-state";

const PLUGIN_KEY = new PluginKey("goose-copy-current-block");

/** 折叠光标提升为当前 BlockNote blockContainer，已有文本选区则保持原样。 */
export function getCurrentBlockNodeSelection(
  state: EditorState,
): NodeSelection | null {
  if (!state.selection.empty) return null;

  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== "blockContainer") continue;
    const pos = $from.before(depth);
    const node = state.doc.nodeAt(pos);
    if (!node || !NodeSelection.isSelectable(node)) return null;
    return NodeSelection.create(state.doc, pos);
  }
  return null;
}

export const gooseCopyCurrentBlockExtension = createExtension({
  key: "goose-copy-current-block",
  prosemirrorPlugins: [
    new Plugin({
      key: PLUGIN_KEY,
      props: {
        handleDOMEvents: {
          copy(view, event) {
            if (event.defaultPrevented) return false;
            const clipboard = event.clipboardData;
            if (!clipboard) return false;

            const blockSelection = getCurrentBlockNodeSelection(view.state);
            if (!blockSelection) return false;

            const { dom, text } = view.serializeForClipboard(
              blockSelection.content(),
            );
            event.preventDefault();
            clipboard.clearData();
            clipboard.setData("text/html", dom.innerHTML);
            clipboard.setData("text/plain", text);
            return true;
          },
        },
      },
    }),
  ],
});
