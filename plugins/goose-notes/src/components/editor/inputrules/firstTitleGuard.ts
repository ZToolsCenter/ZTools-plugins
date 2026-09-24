import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * 「文档第一行恒为标题一(H1)」的确定性防线。
 *
 * 约定见 emptyContent.ts(titleHeadingBlock / TITLE_HEADING_LEVEL=1)与
 * normalize.ts(ensureFirstTitleHeading)。运行期原本只靠 EditorComposer.onChange 里的
 * restoreFirstTitleHeading() 兜底，但它有两类盲区：
 *   1. ensureFirstTitleHeading 对「结构化块」(image/table/codeBlock…)直接原样返回
 *      (normalize.ts 第 319 行)——首行粘贴/插入图片后首块变成 image，兜不回 H1。
 *   2. onChange 在 transaction 之后才跑，且 restoreFirstTitleHeading 用 replaceBlocks
 *      整篇重建，光标/选区会跳。
 *
 * 这里用一个不依赖插件顺序、不依赖 onChange 的 appendTransaction 守卫，在**每次文档
 * 变更的同一 transaction 链内**把首块拉回 H1：
 *   - 首块是 heading 但 level≠1     → setNodeMarkup 改 level=1
 *   - 首块是 inline 内容块(段落/列表/引用/标注…) → 原地转成 heading(level 1)，保留 inline 内容
 *   - 首块是结构化块(image/table/codeBlock/file/video/audio…) → 在最前面插入一个空 H1，
 *     把结构化块顺移到第二位（结构化块无 inline 内容，无法原地转 heading）
 *
 * 因为在 transaction 链内用 mapping 修正，光标基本不跳；也覆盖粘贴/转块/拖拽/删除合并
 * 等所有路径。
 */

// content 为 inline、可原地 setNodeMarkup 转成 heading 的块类型（保留其文本内容）。
const INLINE_CONTENT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "callout",
]);

const TITLE_LEVEL = 1;

/** 取文档第一个 blockContainer 及其内容节点（首块）。 */
function getFirstBlock(
  doc: PMNode,
): { containerPos: number; container: PMNode; content: PMNode } | null {
  let result: { containerPos: number; container: PMNode; content: PMNode } | null =
    null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === "blockContainer") {
      const content = node.firstChild;
      if (content) result = { containerPos: pos, container: node, content };
      return false; // 找到第一个就停（不下钻它的子块）
    }
    return true;
  });
  return result;
}

function firstTitleGuardPlugin(
  usesRawContentRef: { current: boolean } = { current: false },
) {
  return new Plugin({
    appendTransaction(
      transactions: readonly Transaction[],
      _oldState: EditorState,
      newState: EditorState,
    ) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      // raw 文档保留宿主提供的结构，不施加首块 H1 约束。
      if (usesRawContentRef.current) return null;

      const first = getFirstBlock(newState.doc);
      if (!first) return null;

      const { containerPos, content } = first;
      const contentTypeName = content.type.name;
      const level = (content.attrs?.level as number | undefined) ?? null;

      // 已经是 H1：无需处理。
      if (contentTypeName === "heading" && level === TITLE_LEVEL) return null;

      const headingType = newState.schema.nodes.heading;
      if (!headingType) return null;

      const tr = newState.tr;
      // 内容节点在文档中的位置 = 容器位置 + 1（容器的第一个子节点）
      const contentPos = containerPos + 1;

      if (INLINE_CONTENT_BLOCK_TYPES.has(contentTypeName)) {
        // 原地把内容块转成 heading level 1，保留 inline 内容。
        // 用内容块原有 attrs 作基底，叠加 level，避免丢失公共字段（如 textColor）。
        tr.setNodeMarkup(contentPos, headingType, {
          ...content.attrs,
          level: TITLE_LEVEL,
        });
        return tr.steps.length > 0 ? tr : null;
      }

      // 结构化块：无 inline 内容，无法原地转。前置一个空 H1 标题块。
      const blockContainerType = newState.schema.nodes.blockContainer;
      if (!blockContainerType) return null;
      const emptyHeading = blockContainerType.createAndFill(null, [
        headingType.create({ level: TITLE_LEVEL }),
      ]);
      if (!emptyHeading) return null;
      tr.insert(containerPos, emptyHeading);
      return tr.steps.length > 0 ? tr : null;
    },
  });
}

/**
 * 创建 firstTitleGuard 扩展实例。
 *
 * @param usesRawContentRef - 指向当前文档是否采用原始块结构的 ref。
 *   raw 文档不施加「首块恒为 H1」约束；normalized 文档仍走完整守卫。
 */
export function createGooseFirstTitleGuardExtension(
  usesRawContentRef: { current: boolean },
) {
  return createExtension({
    key: "goose-first-title-guard",
    prosemirrorPlugins: [firstTitleGuardPlugin(usesRawContentRef)],
  });
}

/** 向后兼容：不传 ref 则默认启用页面级标题规范。 */
export const gooseFirstTitleGuardExtension = createGooseFirstTitleGuardExtension({
  current: false,
});
