import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * 在 heading 块（任意 level 1-6）内禁用全部字符级样式快捷键：
 * bold (Mod+B) / italic (Mod+I) / underline (Mod+U) / code (Mod+E) / strike (Mod+Shift+S)。
 *
 * 为什么用 ProseMirror handleKeyDown 而非 tiptap keymap：
 * BlockNote 的 bold/italic/underline/strike/code 快捷键来自 tiptap 内置
 * Bold / Italic 等 extension 的 addKeyboardShortcuts()，这些 shortcuts 在
 * tiptap 层通过 prosemirror-keymap 插件注册。ProseMirror 的 handleKeyDown
 * 是视图级 prop，比所有 prosemirror-keymap 插件都早执行——只要在此返回
 * true（吞掉事件），tiptap 内置快捷键永远收不到该按键，拦截确定性最强。
 */

/**
 * 从 ProseMirror selection 向上找最近的 blockContainer，返回其内容块类型名。
 * 与 suppressMarkdownInSpecialBlocks.ts 中同名函数保持一致写法。
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

function isInHeadingBlock(state: EditorState): boolean {
  return getCurrentBlockTypeName(state) === "heading";
}

function headingMarkSuppressPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (!isInHeadingBlock(view.state)) return false;

        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return false;

        const key = event.key.toLowerCase();
        const shift = event.shiftKey;
        const alt = event.altKey;

        if (alt) return false;

        // bold:      Mod+B
        if (!shift && key === "b") return true;
        // italic:    Mod+I
        if (!shift && key === "i") return true;
        // underline: Mod+U
        if (!shift && key === "u") return true;
        // code:      Mod+E
        if (!shift && key === "e") return true;
        // strike:    Mod+Shift+S
        if (shift && key === "s") return true;

        return false;
      },
    },
  });
}

export const gooseHeadingMarkSuppressExtension = createExtension({
  key: "goose-heading-mark-suppress",
  prosemirrorPlugins: [headingMarkSuppressPlugin()],
});
