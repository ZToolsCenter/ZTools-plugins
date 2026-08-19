import { createExtension } from "@blocknote/core";
import { toggleMark } from "@tiptap/pm/commands";
import type { MarkType, Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * 选中非空文本后按 `` ` ``：切换行内 code mark（Notion 风格），不插入反引号字符。
 *
 * 与 headingMarkSuppress 一样走 ProseMirror handleKeyDown（视图级，优先于 keymap），
 * 确保在旧 uTools WebView 上也能吞掉按键。
 *
 * 不处理空选区：空选区仍走默认输入 / markdown input rule（`` `text` ``）。
 */

/** 不允许切换行内 code 的内容块（与 heading 禁 mark、codeBlock 无 inline mark 一致） */
const BLOCKED_CONTENT_TYPES = new Set(["heading", "codeBlock"]);

type BacktickKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
> &
  Partial<Pick<KeyboardEvent, "isComposing" | "keyCode" | "which" | "repeat">>;

/** 是否为裸反引号键（无修饰键、非 IME 组合态） */
export function isInlineCodeBacktickKeyEvent(event: BacktickKeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.repeat) return false;
  if (event.isComposing === true || event.keyCode === 229 || event.which === 229) {
    return false;
  }
  // 字符键优先，避免 Shift+Backquote 产出 `~` 时误匹配 code
  if (event.key === "`") return true;
  // 旧内核偶发 key 为空 / Unidentified：回退 code / keyCode(192)；此时仍拒 shift
  if (event.shiftKey) return false;
  if (event.key && event.key !== "Unidentified") return false;
  return (
    event.code === "Backquote" ||
    event.keyCode === 192 ||
    event.which === 192
  );
}

/**
 * 从 $pos 向上找最近的 blockContainer，返回其内容块类型名。
 * 与 headingMarkSuppressExtension / suppressMarkdownInSpecialBlocks 写法一致。
 */
function getContentBlockTypeName($pos: EditorState["selection"]["$from"]): string | null {
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name === "blockContainer") {
      const contentNode = d + 1 <= $pos.depth ? $pos.node(d + 1) : null;
      return contentNode?.type.name ?? null;
    }
  }
  return null;
}

/**
 * 选区是否落在禁止行内 code 的块内（heading / codeBlock）。
 * 多块选区时任一端点或覆盖文本落在 blocked 块即拒绝。
 */
export function selectionTouchesBlockedInlineCodeBlock(
  state: EditorState,
): boolean {
  const { selection, doc } = state;
  const fromType = getContentBlockTypeName(selection.$from);
  if (fromType && BLOCKED_CONTENT_TYPES.has(fromType)) return true;
  const toType = getContentBlockTypeName(selection.$to);
  if (toType && BLOCKED_CONTENT_TYPES.has(toType)) return true;

  if (selection.empty) return false;

  let blocked = false;
  doc.nodesBetween(selection.from, selection.to, (node: PMNode, pos: number) => {
    if (blocked) return false;
    if (!node.isText) return true;
    const start = Math.max(selection.from, pos);
    const end = Math.min(selection.to, pos + node.nodeSize);
    if (start >= end) return true;
    const typeName = getContentBlockTypeName(doc.resolve(start));
    if (typeName && BLOCKED_CONTENT_TYPES.has(typeName)) {
      blocked = true;
      return false;
    }
    return true;
  });
  return blocked;
}

/**
 * 当前选区是否适合用反引号切换行内 code。
 * 纯条件判断，便于单测；真正 toggle 仍走 ProseMirror toggleMark。
 */
export function shouldToggleInlineCodeOnBacktick(
  state: EditorState,
  event: BacktickKeyEvent,
  options?: { viewComposing?: boolean },
): boolean {
  if (!isInlineCodeBacktickKeyEvent(event)) return false;
  if (options?.viewComposing) return false;
  if (state.selection.empty) return false;
  if (!state.schema.marks.code) return false;
  if (selectionTouchesBlockedInlineCodeBlock(state)) return false;
  return true;
}

/**
 * 在 [from, to) 上切换 code mark。
 * 整段已是 code → 去掉；否则加上（与 Mod+E / toolbar toggle 语义一致）。
 */
export function toggleInlineCodeMarkOnRange(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  codeMark: MarkType = state.schema.marks.code,
): boolean {
  if (!codeMark) return false;
  if (state.selection.empty) return false;
  return toggleMark(codeMark)(state, dispatch);
}

function inlineCodeBacktickWrapPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (
          !shouldToggleInlineCodeOnBacktick(view.state, event, {
            viewComposing: view.composing,
          })
        ) {
          return false;
        }

        const codeMark = view.state.schema.marks.code;
        if (!codeMark) return false;

        // preventDefault：避免浏览器插入字面量 `；返回 true 阻止后续 keymap
        event.preventDefault();
        return toggleInlineCodeMarkOnRange(view.state, view.dispatch.bind(view), codeMark);
      },
    },
  });
}

export const gooseInlineCodeBacktickWrapExtension = createExtension({
  key: "goose-inline-code-backtick-wrap",
  prosemirrorPlugins: [inlineCodeBacktickWrapPlugin()],
});
