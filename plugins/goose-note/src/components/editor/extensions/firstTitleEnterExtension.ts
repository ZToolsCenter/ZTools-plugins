import { createExtension } from "@blocknote/core";

/**
 * 文档首块是「文档标题」（恒为 H1，见 ensureFirstTitleHeading / titleHeadingBlock）。
 *
 * 项目原则：**标题一是特殊的存在，任何编辑器改造都不应影响它**——它恒为物理首块、
 * 恒为 H1，上方不可被前置任何块，自身也不可被推到下面。
 *
 * 本扩展处理「光标在 heading 上按 Enter」：
 *
 * 1. **标题一（物理首块）**：无论光标在开头 / 中间 / 末尾，都保证在标题**下方**
 *    产生可写的正文空行，绝不在标题上方拆块。
 *    - 开头：在标题后插入空 paragraph，光标进入正文
 *    - 末尾：在标题后插入空 paragraph，光标进入正文
 *    - 中间：标题保留光标前文本，光标后文本落到下方新 paragraph
 *
 * 2. **非首块 heading**（正文里另起的 H1/H2…）：光标在开头时，默认 splitBlock 会在
 *    前面拆出同类型空 heading。改为在它**前面插入空 paragraph**，光标仍留在原 heading。
 */
export const gooseFirstTitleEnterExtension = createExtension({
  key: "goose-first-title-enter",
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      const state = editor.prosemirrorState;
      const { selection } = state;
      if (!selection.empty) return false;

      const $from = selection.$from;
      if ($from.parent.type.name !== "heading") return false;

      // 文档结构是 doc > blockGroup > blockContainer*，
      // 比较当前 blockContainer 与文档第一个 blockContainer 的位置。
      let firstContainerPos: number | null = null;
      state.doc.descendants((node, pos) => {
        if (firstContainerPos !== null) return false;
        if (node.type.name === "blockContainer") {
          firstContainerPos = pos;
          return false;
        }
        return true;
      });
      let curContainerPos: number | null = null;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "blockContainer") {
          curContainerPos = $from.before(d);
          break;
        }
      }

      const headingBlock = editor.getTextCursorPosition().block;
      const offset = $from.parentOffset;
      const contentSize = $from.parent.content.size;
      const atStart = offset === 0;
      const atEnd = offset >= contentSize;

      // ── 非首块 heading：仅拦截「光标在开头」避免拆出空标题 ──
      if (firstContainerPos === null || curContainerPos !== firstContainerPos) {
        if (!atStart) return false;
        editor.insertBlocks(
          [{ type: "paragraph", content: "" }],
          headingBlock,
          "before",
        );
        editor.setTextCursorPosition(headingBlock, "start");
        return true;
      }

      // ── 标题一：始终在下方产生正文空行，绝不前置 ──
      if (atStart || atEnd) {
        const [inserted] = editor.insertBlocks(
          [{ type: "paragraph", content: "" }],
          headingBlock,
          "after",
        );
        if (inserted) editor.setTextCursorPosition(inserted, "start");
        return true;
      }

      // 中间：把光标后文本移到下方 paragraph，标题保留前半段。
      const textAfter = $from.parent.textBetween(
        offset,
        contentSize,
        undefined,
        "",
      );
      const [inserted] = editor.insertBlocks(
        [
          {
            type: "paragraph",
            content: textAfter ? [{ type: "text", text: textAfter }] : "",
          },
        ],
        headingBlock,
        "after",
      );

      // 截断标题到光标前（保留 marks 较复杂，用 updateBlock 纯文本近似；
      // 标题通常无复杂 marks，足够覆盖主路径）。
      const textBefore = $from.parent.textBetween(
        0,
        offset,
        undefined,
        "",
      );
      editor.updateBlock(headingBlock, {
        content: textBefore ? [{ type: "text", text: textBefore }] : "",
      } as any);

      if (inserted) editor.setTextCursorPosition(inserted, "start");
      return true;
    },
  },
});
