import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

/**
 * 在「特殊块」内禁用全部 markdown 输入转换。
 *
 * 背景：BlockNote 0.51 把所有默认块的 markdown input rules（`1. ` → 有序列表、
 * `- `/`* `/`+ ` → 无序列表、`# ` → 标题、`[] ` → 待办、`> ` → 引用、``` → 代码块……）
 * 合并进同一个内部插件，且这些规则只在当前块是 `heading` 时跳过，**不排除**
 * codeBlock / callout / quote 这些同为 `content: "inline"` 的特殊块。于是在代码块/
 * 标注/引用里行首敲 `1.` 再按空格或回车，整块会被误转成列表项。
 *
 * BlockNote 还会把 Enter 当作输入 `"\n"` 再跑一遍 input rules（见其内部
 * blocknote-input-rules 插件的 handleKeyDown），所以「`1.` + 回车」同样触发。
 *
 * 修复：用一个独立 ProseMirror 插件，同时接管两条触发路径——
 * - `handleTextInput`：空格/字符触发。命中「特殊块 + 行首是 markdown 标记」时，
 *   自己把文本插进去并 `return true`，从而抢在 BlockNote input rule 之前消费输入，
 *   阻止其转换；不命中则 `return false` 放行。
 * - `handleKeyDown` 的 Enter：换行触发。命中同样条件时 `return true` 吞掉这次 Enter
 *   对 input rule 的喂入（换行本身在特殊块内已由 codeBlock/callout 的 keyboard
 *   extension 处理）。
 *
 * 之所以不复用 BlockNote 的 `inputRules` 扩展点：那条链统一受其内部「当前块
 * content 必须为 inline」等约束，且无法表达「消费但不转换」；而特殊块恰好都是
 * inline，默认规则照常误触发。独立插件 + 自插文本是这里最直接可靠的拦截方式。
 *
 * 另：input rule 还有一条 IME 旁路——`@handlewithcare/prosemirror-inputrules`
 * 在 `compositionend` 时会用当前光标前文本重新跑一遍规则。该路径绕过
 * handleTextInput / handleKeyDown，且执行顺序依赖插件位置不可靠。为此再加一层
 * 不依赖插件顺序的 `appendTransaction` 兜底：任何一次 transaction 若把特殊块
 * 直接转成了 markdown 目标块（列表/标题/待办），就把类型回滚。这是覆盖所有
 * 现有与未来旁路的确定性防线。
 */

// 需要屏蔽 markdown 转换的特殊块。三者都是 content: "inline"，正是默认列表/标题
// 规则不会跳过、会误触发的块类型。
const SUPPRESSED_BLOCK_TYPES = new Set(["codeBlock", "callout", "quote"]);

// markdown input rule 会把块转成的目标类型。appendTransaction 兜底只在
// 「特殊块 → 这些目标之一」时回滚，避免误伤正常的块类型切换。
const MARKDOWN_TARGET_TYPES = new Set([
  "numberedListItem",
  "bulletListItem",
  "checkListItem",
  "toggleListItem",
  "heading",
  "quote",
]);

// 行首 markdown 触发前缀：数字列表 / 符号列表 / 待办 / 标题 / 引用 / 代码块围栏。
// 与 markdownInputRules 对齐：有序支持 `1.`/`1。`，待办支持 `[]`/`【】`（及 x 勾选）。
// 不含末尾空白——空白由本次输入（空格或 Enter 的 \n）补足，见下方判断。
const MARKDOWN_PREFIX =
  /^\s?(?:\d+[.。]|[-+*]|(?:\[[ xX]?\]|【[ xX]?】)|#{1,6}|[|｜]|[>》]|```.*)$/;

/**
 * 从 ProseMirror selection 向上找最近的 blockContainer，返回其内容块类型名。
 * 与 calloutKeyboardExtension 中的遍历方式一致。
 */
function getCurrentBlockTypeName(state: EditorState): string | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === "blockContainer") {
      const contentNode = d + 1 <= $from.depth ? $from.node(d + 1) : null;
      return contentNode?.type.name ?? null;
    }
  }
  return null;
}

function isInSuppressedBlock(state: EditorState): boolean {
  const typeName = getCurrentBlockTypeName(state);
  return typeName != null && SUPPRESSED_BLOCK_TYPES.has(typeName);
}

/**
 * 判断「在光标当前位置之前的本块文本」是否恰好是某个 markdown 触发前缀。
 * 只有此时，紧接着的空格/Enter 才会触发默认 input rule，需要拦截。
 */
function isAtMarkdownTrigger(state: EditorState): boolean {
  const $from = state.selection.$from;
  // 取当前 inline 父节点内、光标前的文本
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  return MARKDOWN_PREFIX.test(textBefore);
}

/**
 * 收集 doc 内所有 blockContainer 的 { id → 内容块类型名 } 映射。
 * blockContainer 的 id 由 BlockNote 维护，跨 transaction 稳定，可用于定位「同一个块」。
 */
function collectBlockContentTypes(doc: PMNode): Map<string, string> {
  const map = new Map<string, string>();
  doc.descendants((node) => {
    if (node.type.name === "blockContainer") {
      const id = node.attrs?.id as string | undefined;
      const contentNode = node.firstChild;
      if (id && contentNode) map.set(id, contentNode.type.name);
    }
    return true;
  });
  return map;
}

function suppressMarkdownPlugin() {
  return new Plugin({
    /**
     * 不依赖插件顺序的兜底防线：若一次 transaction 把某个特殊块直接转成了
     * markdown 目标块（典型为 IME compositionend 旁路触发的 input rule），回滚其类型。
     */
    appendTransaction(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const before = collectBlockContentTypes(oldState.doc);
      const after = collectBlockContentTypes(newState.doc);

      const toRevert: Array<{ id: string; from: string }> = [];
      after.forEach((newType, id) => {
        const oldType = before.get(id);
        if (
          oldType &&
          SUPPRESSED_BLOCK_TYPES.has(oldType) &&
          newType !== oldType &&
          MARKDOWN_TARGET_TYPES.has(newType)
        ) {
          toRevert.push({ id, from: oldType });
        }
      });
      if (toRevert.length === 0) return null;

      const tr = newState.tr;
      const revertSet = new Map(toRevert.map((r) => [r.id, r.from]));
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "blockContainer") return true;
        const id = node.attrs?.id as string | undefined;
        const contentNode = node.firstChild;
        if (!id || !contentNode) return true;
        const targetType = revertSet.get(id);
        if (!targetType) return true;
        const nodeType = newState.schema.nodes[targetType];
        if (!nodeType) return true;
        // 把内容块的类型改回原特殊块类型，保留其 inline 内容与原 attrs 中的公共字段。
        const contentPos = pos + 1;
        tr.setNodeMarkup(contentPos, nodeType, contentNode.attrs);
        return true;
      });
      return tr.steps.length > 0 ? tr : null;
    },
    props: {
      handleTextInput(view: EditorView, _from: number, _to: number, text: string) {
        // 仅拦截「会触发 input rule 的空格」：特殊块内 + 行首是 markdown 前缀 + 本次输入是空格。
        if (text !== " ") return false;
        const { state } = view;
        if (!isInSuppressedBlock(state) || !isAtMarkdownTrigger(state)) return false;
        // 自己插入空格并消费本次输入，阻止 BlockNote input rule 接手。
        view.dispatch(state.tr.insertText(" "));
        return true;
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }
        const { state } = view;
        // 特殊块内 + 行首是 markdown 前缀时，BlockNote 会把 Enter 当作 "\n" 喂给 input rule
        // 导致转换。这里吞掉该 Enter 的「触发 input rule」效应。
        // 注意：特殊块内的换行行为本身已由 codeBlock/callout 的 keyboard extension 处理，
        // 那些 extension 的 keyboardShortcut 返回 true 时 BlockNote 不会再跑 input rule；
        // 但为防止顺序差异导致漏网，这里对「行首恰为 markdown 前缀」的情况兜底拦截。
        if (!isInSuppressedBlock(state) || !isAtMarkdownTrigger(state)) return false;
        return true;
      },
    },
  });
}

export const gooseSuppressMarkdownInSpecialBlocksExtension = createExtension({
  key: "goose-suppress-markdown-in-special-blocks",
  prosemirrorPlugins: [suppressMarkdownPlugin()],
});
