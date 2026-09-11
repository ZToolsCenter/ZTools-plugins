import type { PartialBlock } from "@blocknote/core";
import type { BlockNoteContent } from "./emptyContent";
import {
  TITLE_HEADING_LEVEL,
  titleHeadingBlock,
  createEmptyBlockNoteContent,
} from "./emptyContent";

export const VALID_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "table",
  "image",
  "video",
  "file",
  "audio",
  "codeBlock",
  "quote",
  "callout",
  "alert",
  "link",
  "embed",
  "toggleListItem",
]);

export const LEGACY_BLOCK_TYPES = new Set([
  "blockquote",
  "paragraph",
  "heading",
  "codeBlock",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "image",
  "imageResize",
  "horizontalRule",
]);

const INLINE_CONTENT_TYPES = new Set(["text", "link"]);

export function simpleExtractText(block: any): string {
  if (!block || typeof block !== "object") return "";
  if (typeof block.content === "string") return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .map((inline: any) => {
        if (typeof inline === "string") return inline;
        if (inline?.type === "link" && Array.isArray(inline.content)) {
          return inline.content.map((c: any) => c?.text ?? "").join("");
        }
        return inline?.text ?? "";
      })
      .join("");
  }
  if (block.content?.rows) {
    const rows = block.content.rows as any[];
    return rows
      .flatMap((row) =>
        (row.cells ?? []).map((cell: any) =>
          typeof cell === "string" ? cell : simpleExtractText(cell),
        ),
      )
      .join(" ");
  }
  return "";
}

function isStructuredBlockLike(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const candidateType = (node as { type?: unknown }).type;
  if (
    typeof candidateType === "string" &&
    INLINE_CONTENT_TYPES.has(candidateType)
  ) {
    return false;
  }
  return (
    typeof candidateType === "string" &&
    (VALID_BLOCK_TYPES.has(candidateType) || LEGACY_BLOCK_TYPES.has(candidateType))
  );
}

export function hasStructuredBlocks(value: unknown): value is any[] {
  return Array.isArray(value) && value.some((item) => isStructuredBlockLike(item));
}

function normalizeInlineContent(content: unknown): PartialBlock["content"] {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && !hasStructuredBlocks(content)) {
    return content;
  }
  const text = simpleExtractText({ content });
  return text || "";
}

function createParagraphFromInlineContent(
  content: PartialBlock["content"] | undefined,
): PartialBlock | null {
  if (typeof content === "string") {
    return content.trim() ? ({ type: "paragraph", content } as PartialBlock) : null;
  }
  if (Array.isArray(content)) {
    const text = simpleExtractText({ content }).trim();
    return text ? ({ type: "paragraph", content } as PartialBlock) : null;
  }
  return null;
}

function hasInlineText(content: unknown): boolean {
  return simpleExtractText({ content }).trim().length > 0;
}

function isEmptyWrapperBlock(type: string, block: any): boolean {
  if (
    ![
      "paragraph",
      "heading",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
    ].includes(type)
  ) {
    return false;
  }
  return !hasInlineText(block.content);
}

function getPlainBlockText(block: PartialBlock | undefined): string {
  if (!block) return "";
  return simpleExtractText(block).trim();
}

function getDetachedListMarkerType(
  block: PartialBlock | undefined,
): "bulletListItem" | "numberedListItem" | null {
  if (!block || block.type !== "paragraph") return null;
  if ((block as any).children?.length) return null;

  const text = getPlainBlockText(block);
  if (/^(?:[•·.]|-|\*)$/.test(text)) return "bulletListItem";
  if (/^\d+\.$/.test(text)) return "numberedListItem";
  return null;
}

function repairDetachedListMarkers(blocks: PartialBlock[]): PartialBlock[] {
  const repaired: PartialBlock[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const markerType = getDetachedListMarkerType(blocks[index]);
    const nextBlock = blocks[index + 1];

    if (
      markerType &&
      nextBlock?.type === "paragraph" &&
      getPlainBlockText(nextBlock)
    ) {
      repaired.push({
        type: markerType,
        content: nextBlock.content,
        ...((nextBlock as any).children?.length
          ? { children: (nextBlock as any).children }
          : {}),
      } as PartialBlock);
      index += 1;
      continue;
    }

    repaired.push(blocks[index]);
  }

  return repaired;
}

export function normalizeBlocks(blocks: any[] | undefined): PartialBlock[] {
  return normalizeRedundantNumberedListStarts(
    repairDetachedListMarkers(
      (blocks ?? []).flatMap((block) => normalizeBlock(block)),
    ),
  );
}

/**
 * BlockNote 只在一段连续有序列表的首项读取 `props.start`。后续项上的 start
 * 平时虽然不影响显示，但当前面的列表项被删除、它变成首项后就会突然生效，造成
 * 「删掉 1. 后仍显示 2.」的错觉。
 *
 * 因此只移除同一 sibling run 内后续项的冗余 start；被非列表块隔开的新 run、
 * 以及每个嵌套 blockGroup 的首项仍保留显式起始序号。
 */
function normalizeRedundantNumberedListStarts(
  blocks: PartialBlock[],
): PartialBlock[] {
  let previousWasNumbered = false;

  return blocks.map((block) => {
    const isNumbered = block.type === "numberedListItem";
    const hasRedundantStart =
      isNumbered &&
      previousWasNumbered &&
      (block.props as Record<string, unknown> | undefined)?.start != null;

    previousWasNumbered = isNumbered;
    if (!hasRedundantStart) return block;

    const { start: _start, ...props } = block.props as Record<string, unknown>;
    return {
      ...block,
      ...(Object.keys(props).length > 0 ? { props } : { props: undefined }),
    } as PartialBlock;
  });
}

function normalizeQuoteBlock(block: any): PartialBlock[] {
  const contentChildren = hasStructuredBlocks(block.content) ? block.content : [];
  const childBlocks = Array.isArray(block.children) ? block.children : [];
  const nestedBlocks = normalizeBlocks([...contentChildren, ...childBlocks]);

  if (
    nestedBlocks.length === 1 &&
    nestedBlocks[0]?.type === "paragraph" &&
    !(nestedBlocks[0] as any).children?.length
  ) {
    return [
      {
        type: "quote",
        content: normalizeInlineContent(nestedBlocks[0].content),
      } as PartialBlock,
    ];
  }

  if (nestedBlocks.length > 0) {
    const leadingParagraph = hasStructuredBlocks(block.content)
      ? null
      : createParagraphFromInlineContent(normalizeInlineContent(block.content));
    return leadingParagraph ? [leadingParagraph, ...nestedBlocks] : nestedBlocks;
  }

  return [
    {
      type: "quote",
      content: normalizeInlineContent(block.content),
    } as PartialBlock,
  ];
}

function normalizeBlock(block: any): PartialBlock[] {
  if (!block || typeof block !== "object") return [];

  const type = block.type;
  if (type === "quote" || type === "blockquote") {
    const flattened = normalizeQuoteBlock(block);
    // 引用块不允许有 children，剥离并展平
    return flattened.flatMap((b) => {
      const children = (b as any).children;
      if (!children?.length) return [b];
      const { children: _, ...withoutChildren } = b as any;
      return [withoutChildren as PartialBlock, ...normalizeBlocks(children)];
    });
  }

  if (!type || !VALID_BLOCK_TYPES.has(type)) {
    const nestedBlocks = [
      ...(hasStructuredBlocks(block.content) ? block.content : []),
      ...(Array.isArray(block.children) ? block.children : []),
    ];
    if (nestedBlocks.length > 0) {
      return normalizeBlocks(nestedBlocks);
    }
    const text = simpleExtractText(block).trim();
    if (text) return [{ type: "paragraph", content: text }];
    return [];
  }

  const children = normalizeBlocks(block.children);

  // 可折叠标题（isToggleable）的 children 是折叠内容本体，必须保留；
  // 下面的「heading 带 children 拍平」只针对旧数据里的普通标题。
  const isToggleableHeading =
    type === "heading" &&
    Boolean(block.props?.isToggleable ?? block.attrs?.isToggleable);

  if (children.length > 0 && type === "heading" && !isToggleableHeading) {
    if (!hasInlineText(block.content)) {
      return children;
    }
    const headingBlock: PartialBlock = { type };
    if (block.props || block.attrs) headingBlock.props = block.props ?? block.attrs;
    if (block.content !== undefined) headingBlock.content = block.content;
    return [headingBlock, ...children];
  }

  if (children.length > 0 && !isToggleableHeading && isEmptyWrapperBlock(type, block)) {
    return children;
  }

  const sanitized: PartialBlock = { type };
  if (block.props || block.attrs) sanitized.props = block.props ?? block.attrs;
  if (block.content !== undefined) {
    sanitized.content = type === "codeBlock" ? simpleExtractText(block) : block.content;
  }
  if (children?.length) sanitized.children = children;

  return [sanitized];
}

function canUseAsHeadingContent(block: PartialBlock): boolean {
  // 只把 paragraph 提升为标题。codeBlock / table / image / list 等结构化块保持原样，
  // 否则会被撕掉外壳变成 heading 丢数据（例如：本地文件首块若是 codeBlock 包住的
  // frontmatter，原实现会把它强转成 H1 露出 raw-block marker 文本）。
  if (block.type !== "paragraph") return false;
  return typeof block.content === "string" || Array.isArray(block.content);
}

export function ensureFirstTitleHeading(content: BlockNoteContent): BlockNoteContent {
  const [firstBlock, ...restBlocks] = content;

  if (!firstBlock) {
    return createEmptyBlockNoteContent();
  }

  if (firstBlock.type === "heading") {
    const nestedChildren = Array.isArray(firstBlock.children) ? firstBlock.children : [];
    const { children: headingChildren, ...titleBase } = firstBlock as PartialBlock;
    void headingChildren;
    const normalizedTitle = {
      ...titleBase,
      props: {
        ...firstBlock.props,
        level: TITLE_HEADING_LEVEL,
      },
    } as PartialBlock;

    return [
      normalizedTitle,
      ...nestedChildren,
      ...restBlocks,
    ];
  }

  if (canUseAsHeadingContent(firstBlock)) {
    const nestedChildren = Array.isArray(firstBlock.children) ? firstBlock.children : [];
    const content =
      typeof firstBlock.content === "string" || Array.isArray(firstBlock.content)
        ? firstBlock.content
        : "";

    return [
      {
        type: "heading",
        props: {
          ...firstBlock.props,
          level: TITLE_HEADING_LEVEL,
        },
        content,
      } as PartialBlock,
      ...nestedChildren,
      ...restBlocks,
    ];
  }

  // 首块是结构化块：保持原样，不前置空标题，避免在编辑器顶部塞无关 H1。
  return content;
}

export function normalizeBlockContent(content: unknown): BlockNoteContent {
  if (!Array.isArray(content)) return [];
  return normalizeBlocks(content);
}
