import { createExtension } from "@blocknote/core";
// @ts-ignore
import { InputRule, inputRules } from "@handlewithcare/prosemirror-inputrules";

/**
 * Tiptap plugin key for the arrow input rule.
 */
function arrowInputRulePlugin() {
  return inputRules({
    rules: [
      new InputRule(
        /->$/,
        (state: any, _match: any, start: number, end: number) => {
          return state.tr.insertText("\u2192", start, end);
        },
        { inCode: false, undoable: false },
      ),
      new InputRule(
        /-》$/,
        (state: any, _match: any, start: number, end: number) => {
          return state.tr.insertText("\u2192", start, end);
        },
        { inCode: false, undoable: false },
      ),
      new InputRule(
        /=>$/,
        (state: any, _match: any, start: number, end: number) => {
          return state.tr.insertText("\u21D2", start, end);
        },
        { inCode: false, undoable: false },
      ),
      new InputRule(
        /<-$/,
        (state: any, _match: any, start: number, end: number) => {
          return state.tr.insertText("\u2190", start, end);
        },
        { inCode: false, undoable: false },
      ),
    ],
  });
}

export const ArrowInputRuleExtension = createExtension({
  key: "arrowInputRule",

  prosemirrorPlugins: [arrowInputRulePlugin()],
});
