import type { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import type { Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

const SLASH_TRIGGERS = ["/", "、"] as const;

export type SlashMenuPagePolicy = {
  /** local-folder 或速记草稿：首块可弹 slash（标题不在首块内） */
  allowSlashMenuOnFirstBlock: boolean;
};

/** 与 EditorComposer SuggestionMenuController.shouldOpen 共用 */
export function shouldOpenSlashSuggestionMenu(
  tr: Transaction,
  editor: BlockNoteEditor<any, any, any>,
  policy: SlashMenuPagePolicy,
): boolean {
  const $from = tr.selection.$from;
  if (!policy.allowSlashMenuOnFirstBlock) {
    const cursorBlock = editor.getTextCursorPosition().block;
    if (cursorBlock && cursorBlock.id === editor.document[0]?.id) return false;
  }
  if ($from.parentOffset !== 0) return false;
  return !$from.parent.type.isInGroup("tableContent");
}

/**
 * BlockNote 仅在 handleTextInput 插入触发符时开菜单；删光 query 后块首仍留 `/` 时不会再开。
 * 文档稳定后检测并程序化 reopen + 恢复 query。
 */
export function reconcileSlashSuggestionMenu(
  editor: BlockNoteEditor<any, any, any>,
  policy: SlashMenuPagePolicy,
): void {
  if (!editor.isEditable) return;

  const sug = editor.getExtension(SuggestionMenu);
  if (!sug || sug.shown()) return;

  const view = editor.prosemirrorView;
  if (!view) return;
  if (view.composing) return;

  const { selection } = view.state;
  if (!selection.empty) return;

  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return;
  if (parent.type.isInGroup("tableContent")) return;

  if (!policy.allowSlashMenuOnFirstBlock) {
    const cursorBlock = editor.getTextCursorPosition().block;
    if (cursorBlock && cursorBlock.id === editor.document[0]?.id) return;
  }

  const trigger = SLASH_TRIGGERS.find((t) => parent.textContent.startsWith(t));
  if (!trigger) return;
  const query = parent.textContent.slice(trigger.length);
  // Local paths such as `/Users/name/project` also start with `/`, but they
  // are content, not slash-command queries. Touching selection while IME is
  // settling can make those long path lines visually flicker.
  if (query.includes("/") || query.includes("\\")) return;

  const blockStart = $from.start();
  const caret = selection.from;
  if (caret <= blockStart) return;

  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, blockStart + trigger.length),
    ),
  );
  sug.openSuggestionMenu(trigger);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
  );
}
