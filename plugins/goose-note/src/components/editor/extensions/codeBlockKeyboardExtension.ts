import { createExtension } from "@blocknote/core";

export const gooseCodeBlockKeyboardExtension = createExtension({
  key: "goose-code-block-keyboard",
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      const pmState = editor.prosemirrorState;
      const $from = pmState.selection.$from;

      // Walk up the node tree to find if we're inside a codeBlock
      for (let d = $from.depth; d >= 1; d--) {
        const node = $from.node(d);
        if (node.type.name === "blockContainer") {
          const contentNode = d + 1 <= $from.depth ? $from.node(d + 1) : null;
          if (contentNode?.type.name === "codeBlock") {
            // Inside code block: insert newline instead of creating new block
            const tr = pmState.tr.insertText("\n");
            editor.prosemirrorView.dispatch(tr);
            return true;
          }
        }
      }
      return false;
    },
    "Shift-Enter": ({ editor }) => {
      const pmState = editor.prosemirrorState;
      const $from = pmState.selection.$from;

      for (let d = $from.depth; d >= 1; d--) {
        const node = $from.node(d);
        if (node.type.name === "blockContainer") {
          const contentNode = d + 1 <= $from.depth ? $from.node(d + 1) : null;
          if (contentNode?.type.name === "codeBlock") {
            // Shift+Enter in code block: exit and create new paragraph
            const block = editor.getTextCursorPosition().block;
            const [inserted] = editor.insertBlocks(
              [{ type: "paragraph", content: "" }],
              block,
              "after",
            );
            if (inserted) editor.setTextCursorPosition(inserted);
            return true;
          }
        }
      }
      return false;
    },
  },
});
