import type { PartialBlock } from "@blocknote/core";
import type { BlockNoteContent } from "./emptyContent";
import { isBlockNoteContent, createEmptyBlockNoteContent } from "./emptyContent";
import { normalizeBlockContent, ensureFirstTitleHeading } from "./normalize";
import { ensureBodyParagraphAfterTitle } from "./ensureBodyParagraph";

export interface LegacyPageContent {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: Array<{ type?: string; attrs?: Record<string, any> }>;
  content?: LegacyPageContent[];
}

export type PageContent = BlockNoteContent | LegacyPageContent;

function textFromLegacy(
  node: LegacyPageContent | string | undefined,
): string {
  if (node == null) return "";
  // parseInlineMarkdown 对未匹配 mark 的纯文本直接 push 字符串，所以 content
  // 数组里可能混入裸字符串。如果不在这里处理，纯文本标题（# 中文）会被当成空内容。
  if (typeof node === "string") return node;
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(textFromLegacy).join("");
}

function inlineFromLegacy(node: LegacyPageContent | undefined): any[] | string {
  if (!node) return "";
  if (Array.isArray(node.content) && node.content.length > 0) {
    const hasRichInline = node.content.some(
      (child: any) =>
        (typeof child === "object" && child !== null && (child.styles || child.type === "link")),
    );
    if (hasRichInline) return node.content;
  }
  const text = textFromLegacy(node);
  return text || "";
}

function childrenFromLegacy(nodes: LegacyPageContent[] | undefined): PartialBlock[] {
  return (nodes ?? []).flatMap((node) => legacyNodeToBlocks(node));
}

function listItemsToBlocks(
  nodes: LegacyPageContent[] | undefined,
  type: "bulletListItem" | "numberedListItem" | "checkListItem",
): PartialBlock[] {
  return (nodes ?? []).map((item) => {
    const first = item.content?.[0];
    const nested = item.content?.slice(1) ?? [];
    return {
      type,
      props:
        type === "checkListItem"
          ? { checked: item.attrs?.checked === true }
          : undefined,
      content: inlineFromLegacy(first),
      children: childrenFromLegacy(nested),
    } as PartialBlock;
  });
}

function tableFromLegacy(node: LegacyPageContent): PartialBlock {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => textFromLegacy(cell)),
  );
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({ cells })),
    },
  } as PartialBlock;
}

function legacyNodeToBlocks(node: LegacyPageContent): PartialBlock[] {
  switch (node.type) {
    case "heading":
      return [
        {
          type: "heading",
          props: {
            level: Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3),
          },
          content: inlineFromLegacy(node),
        } as PartialBlock,
      ];
    case "paragraph":
      return [{ type: "paragraph", content: inlineFromLegacy(node) } as PartialBlock];
    case "blockquote":
      return [{ type: "quote", content: inlineFromLegacy(node) } as PartialBlock];
    case "codeBlock":
      return [
        {
          type: "codeBlock",
          props: {
            language: node.attrs?.language || "",
            ...(node.attrs?.summary ? { summary: node.attrs.summary } : {}),
            ...(node.attrs?.collapsed ? { collapsed: node.attrs.collapsed } : {}),
            ...(node.attrs?.wrap != null ? { wrap: node.attrs.wrap } : {}),
          },
          content: textFromLegacy(node),
        } as PartialBlock,
      ];
    case "bulletList":
      return listItemsToBlocks(node.content, "bulletListItem");
    case "orderedList":
      return listItemsToBlocks(node.content, "numberedListItem");
    case "taskList":
      return listItemsToBlocks(node.content, "checkListItem");
    case "table":
      return [tableFromLegacy(node)];
    case "image":
    case "imageResize":
      return [
        {
          type: "image",
          props: {
            url: node.attrs?.src || node.attrs?.url || "",
            caption: node.attrs?.alt || node.attrs?.title || "",
          },
        } as PartialBlock,
      ];
    case "horizontalRule":
      return [{ type: "paragraph", content: "---" } as PartialBlock];
    default: {
      const text = textFromLegacy(node).trim();
      if (text) return [{ type: "paragraph", content: text } as PartialBlock];
      return childrenFromLegacy(node.content);
    }
  }
}

function inlineTextLength(value: unknown): number {
  if (typeof value === "string") return value.trim().length;
  if (!Array.isArray(value)) return 0;
  return value.reduce<number>((sum, item) => {
    if (typeof item === "string") return sum + item.trim().length;
    if (!item || typeof item !== "object") return sum;
    const node = item as { text?: unknown; content?: unknown };
    if (typeof node.text === "string") return sum + node.text.trim().length;
    if (Array.isArray(node.content)) return sum + inlineTextLength(node.content);
    return sum;
  }, 0);
}

/**
 * BlockNote 的 zh locale 把空 heading 块渲染为 「标题」 灰字占位。首块作为页面
 * 标题槽必须保留（用户可以在这里点击输入标题），但**后续**的空 heading
 * 没有任何意义，只会让编辑器看起来像有一个个空标题，所以这里统一剥掉。
 *
 * 只在顶层应用——避免误伤 quote / details 等嵌套内容中的子 heading。
 */
function stripRedundantEmptyHeadings(blocks: BlockNoteContent): BlockNoteContent {
  return blocks.filter((block, index) => {
    if (index === 0) return true;
    if (!block || block.type !== "heading") return true;
    if (inlineTextLength(block.content) > 0) return true;
    if (Array.isArray((block as { children?: unknown[] }).children) &&
        ((block as { children: unknown[] }).children.length > 0)) {
      return true;
    }
    return false;
  });
}

export function normalizePageContent(
  content: PageContent | null | undefined,
  options?: {
    /**
     * 是否强制首块为 H1 标题（ensureFirstTitleHeading + 剥冗余空标题）。
     * 默认 true（内部笔记本行为）。local-folder 导入传 false：
     * 磁盘 markdown 没有 H1 时首块保持段落原样，不做标题提升。
     */
    ensureFirstTitle?: boolean;
  },
): BlockNoteContent {
  const ensureTitle = options?.ensureFirstTitle !== false;
  if (!content) return ensureTitle ? createEmptyBlockNoteContent() : [];
  const sanitized = isBlockNoteContent(content)
    ? normalizeBlockContent(content)
    : normalizeBlockContent(childrenFromLegacy(content.content));
  if (!ensureTitle) return sanitized;
  if (!sanitized.length) return createEmptyBlockNoteContent();
  return ensureBodyParagraphAfterTitle(
    stripRedundantEmptyHeadings(ensureFirstTitleHeading(sanitized)),
  );
}
