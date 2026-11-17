import { KeyBinding } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { StateCommand } from "@codemirror/state";

/**
 * Toggle inline formatting wrap around selection
 */
function toggleWrap(prefix: string, suffix = prefix): StateCommand {
  return ({ state, dispatch }) => {
    const sel = state.selection.main;
    const selectedText = state.sliceDoc(sel.from, sel.to);

    // Check if already wrapped
    const before = state.sliceDoc(Math.max(0, sel.from - prefix.length), sel.from);
    const after = state.sliceDoc(sel.to, Math.min(state.doc.length, sel.to + suffix.length));

    if (before === prefix && after === suffix) {
      // Unwrap
      dispatch(
        state.update({
          changes: [
            { from: sel.from - prefix.length, to: sel.from, insert: "" },
            { from: sel.to, to: sel.to + suffix.length, insert: "" }
          ],
          selection: { anchor: sel.from - prefix.length, head: sel.to - prefix.length }
        })
      );
      return true;
    }

    if (
      selectedText.startsWith(prefix) &&
      selectedText.endsWith(suffix) &&
      selectedText.length >= prefix.length + suffix.length
    ) {
      // Unwrap inner
      const unwrapped = selectedText.slice(prefix.length, -suffix.length);
      dispatch(
        state.update({
          changes: { from: sel.from, to: sel.to, insert: unwrapped },
          selection: { anchor: sel.from, head: sel.from + unwrapped.length }
        })
      );
      return true;
    }

    // Wrap
    const insertText = `${prefix}${selectedText}${suffix}`;
    dispatch(
      state.update({
        changes: { from: sel.from, to: sel.to, insert: insertText },
        selection: {
          anchor: sel.from + prefix.length,
          head: sel.from + prefix.length + selectedText.length
        }
      })
    );
    return true;
  };
}

/**
 * Smart List Enter:
 * - If current line is empty bullet (e.g. "- "), clear it and insert normal newline
 * - If current line is list item (e.g. "- [ ] item" or "1. item"), continue prefix
 */
const smartListEnter: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.head);
  const text = line.text;

  // Empty task item: "- [ ] "
  const emptyTaskMatch = text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s*)$/);
  if (emptyTaskMatch && sel.head === line.to) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from }
      })
    );
    return true;
  }

  // Active task item: "- [ ] Task"
  const taskMatch = text.match(/^(\s*)([-*+])\s+\[[ xX]\]\s+/);
  if (taskMatch && sel.head > line.from + taskMatch[0].length) {
    const indent = taskMatch[1];
    const bullet = taskMatch[2];
    const nextPrefix = `\n${indent}${bullet} [ ] `;
    dispatch(
      state.update({
        changes: { from: sel.head, insert: nextPrefix },
        selection: { anchor: sel.head + nextPrefix.length }
      })
    );
    return true;
  }

  // Empty bullet item: "- " or "* "
  const emptyBulletMatch = text.match(/^(\s*)([-*+])\s*$/);
  if (emptyBulletMatch && sel.head === line.to) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from }
      })
    );
    return true;
  }

  // Active bullet item: "- Item"
  const bulletMatch = text.match(/^(\s*)([-*+])\s+/);
  if (bulletMatch && sel.head >= line.from + bulletMatch[0].length) {
    const indent = bulletMatch[1];
    const bullet = bulletMatch[2];
    const nextPrefix = `\n${indent}${bullet} `;
    dispatch(
      state.update({
        changes: { from: sel.head, insert: nextPrefix },
        selection: { anchor: sel.head + nextPrefix.length }
      })
    );
    return true;
  }

  // Empty ordered item: "1. "
  const emptyOrderedMatch = text.match(/^(\s*)(\d+)[\.)]\s*$/);
  if (emptyOrderedMatch && sel.head === line.to) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from }
      })
    );
    return true;
  }

  // Active ordered item: "1. Item"
  const orderedMatch = text.match(/^(\s*)(\d+)([\.)])\s+/);
  if (orderedMatch && sel.head >= line.from + orderedMatch[0].length) {
    const indent = orderedMatch[1];
    const num = parseInt(orderedMatch[2], 10);
    const delim = orderedMatch[3];
    const nextPrefix = `\n${indent}${num + 1}${delim} `;
    dispatch(
      state.update({
        changes: { from: sel.head, insert: nextPrefix },
        selection: { anchor: sel.head + nextPrefix.length }
      })
    );
    return true;
  }

  return false;
};

/**
 * Smart List Tab: Indent current list item
 */
const smartListTab: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const text = line.text;

  if (/^\s*([-*+]|\d+[\.)])\s+/.test(text)) {
    dispatch(
      state.update({
        changes: { from: line.from, insert: "  " },
        selection: { anchor: sel.head + 2 }
      })
    );
    return true;
  }
  return false;
};

/**
 * Smart List Shift-Tab: Outdent current list item
 */
const smartListShiftTab: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const text = line.text;

  if (/^ {1,2}\S/.test(text) || /^ {1,2}([-*+]|\d+[\.)])/.test(text)) {
    const spacesToRemove = text.startsWith("  ") ? 2 : 1;
    dispatch(
      state.update({
        changes: { from: line.from, to: line.from + spacesToRemove, insert: "" },
        selection: { anchor: Math.max(line.from, sel.head - spacesToRemove) }
      })
    );
    return true;
  }
  return false;
};

export const typoraCM6Keymap: KeyBinding[] = [
  { key: "Mod-z", run: undo, preventDefault: true },
  { key: "Mod-Shift-z", run: redo, preventDefault: true },
  { key: "Mod-y", run: redo, preventDefault: true },
  { key: "Mod-b", run: toggleWrap("**"), preventDefault: true },
  { key: "Mod-i", run: toggleWrap("*"), preventDefault: true },
  { key: "Mod-e", run: toggleWrap("`"), preventDefault: true },
  { key: "Mod-k", run: toggleWrap("[", "](https://)"), preventDefault: true },
  { key: "Enter", run: smartListEnter },
  { key: "Tab", run: smartListTab, preventDefault: true },
  { key: "Shift-Tab", run: smartListShiftTab, preventDefault: true }
];
