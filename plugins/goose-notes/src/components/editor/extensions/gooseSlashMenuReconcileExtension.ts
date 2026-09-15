import type { BlockNoteEditor } from "@blocknote/core";
import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";

import { reconcileSlashSuggestionMenu } from "@/components/editor/utils/slashMenuPolicy";

const PLUGIN_KEY = new PluginKey("goose-slash-menu-reconcile");

export function createGooseSlashMenuReconcileExtension(
  allowSlashMenuOnFirstBlockRef: { current: boolean },
  editorRef: { current: BlockNoteEditor<any, any, any> | null },
) {
  return createExtension({
    key: "goose-slash-menu-reconcile",
    prosemirrorPlugins: [
      new Plugin({
        key: PLUGIN_KEY,
        appendTransaction(transactions, _oldState, _newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          queueMicrotask(() => {
            const ed = editorRef.current;
            if (!ed) return;
            reconcileSlashSuggestionMenu(ed, {
              allowSlashMenuOnFirstBlock: allowSlashMenuOnFirstBlockRef.current,
            });
          });
          return null;
        },
      }),
    ],
  });
}