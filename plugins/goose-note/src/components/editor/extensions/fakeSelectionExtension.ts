import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { BlockNoteEditor } from "@blocknote/core";

type FakeSelectionRange = { from: number; to: number } | null;

const fakeSelectionKey = new PluginKey<FakeSelectionRange>("goose-fake-selection");

const fakeSelectionPlugin = new Plugin<FakeSelectionRange>({
  key: fakeSelectionKey,
  state: {
    init: () => null,
    apply(tr, value) {
      const meta = tr.getMeta(fakeSelectionKey);
      if (meta !== undefined) {
        return meta as FakeSelectionRange;
      }
      if (!value) return value;
      const from = tr.mapping.map(value.from);
      const to = tr.mapping.map(value.to);
      if (from === to) return null;
      return { from, to };
    },
  },
  props: {
    decorations(state) {
      const value = fakeSelectionKey.getState(state);
      if (!value || value.from === value.to) return null;
      return DecorationSet.create(state.doc, [
        Decoration.inline(value.from, value.to, { class: "goose-fake-selection" }),
      ]);
    },
  },
});

export function setFakeSelection(
  editor: BlockNoteEditor<any, any, any>,
  range: FakeSelectionRange,
) {
  const view = editor.prosemirrorView;
  if (!view) return;
  view.dispatch(view.state.tr.setMeta(fakeSelectionKey, range));
}

export const gooseFakeSelectionExtension = createExtension({
  key: "goose-fake-selection",
  prosemirrorPlugins: [fakeSelectionPlugin],
});
