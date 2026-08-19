export type { BlockNoteContent } from "./emptyContent";
export {
  TITLE_HEADING_LEVEL,
  emptyBlock,
  titleHeadingBlock,
  createEmptyBlockNoteContent,
  createEmptyLocalPageContent,
  isBlockNoteContent,
} from "./emptyContent";

export type { LegacyPageContent, PageContent } from "./legacyMigration";
export { normalizePageContent } from "./legacyMigration";

export {
  VALID_BLOCK_TYPES,
  LEGACY_BLOCK_TYPES,
  simpleExtractText,
  hasStructuredBlocks,
  normalizeBlocks,
  normalizeBlockContent,
  ensureFirstTitleHeading,
} from "./normalize";
export {
  ensureBodyParagraphAfterTitle,
  needsBodyParagraphAfterTitle,
} from "./ensureBodyParagraph";

export { createEditorSafeContent } from "./editorSafeContent";

import type { PartialBlock } from "@blocknote/core";
import type { PageContent } from "./legacyMigration";
import type { BlockNoteContent } from "./emptyContent";
import { isBlockNoteContent } from "./emptyContent";
import { simpleExtractText } from "./normalize";
import { normalizePageContent } from "./legacyMigration";
import type { LegacyPageContent } from "./legacyMigration";

export function clonePageContent<T extends PageContent>(content: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(content) as T;
    } catch {
      // structuredClone 不支持的少数类型（含函数等）会抛错，落到 JSON 兜底
    }
  }
  return JSON.parse(JSON.stringify(content)) as T;
}

export function getContentSignature(content: unknown): string {
  try {
    // 用于"内容是否变更"的判断：剥除 BlockNote 注入的瞬时字段
    // （每次 replaceBlocks 会重新生成 id，空 children:[] 也只是占位），
    // 否则切页同步会被误判为编辑，污染 updatedAt。
    return JSON.stringify(content ?? null, (key, value) => {
      if (key === "id") return undefined;
      if (key === "children" && Array.isArray(value) && value.length === 0) {
        return undefined;
      }
      return value;
    });
  } catch {
    return "__goose-note-unserializable-content__";
  }
}

function textFromLegacyNode(node: LegacyPageContent | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(textFromLegacyNode).join("");
}

export function extractPlainText(content: PageContent | undefined): string {
  if (!content) return "";
  if (!isBlockNoteContent(content)) {
    if (typeof content === "object" && (content as any).type !== "doc") {
      return simpleExtractText(content as any).trim();
    }
    return textFromLegacyNode(content as LegacyPageContent).trim();
  }

  const parts: string[] = [];
  const visit = (block: any) => {
    if (typeof block.content === "string") parts.push(block.content);
    else if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (typeof inline === "string") parts.push(inline);
        else if (inline?.type === "link" && Array.isArray(inline.content)) {
          parts.push(...inline.content.map((c: any) => c?.text ?? ""));
        } else if (inline?.text) parts.push(inline.text);
      }
    } else if (block.content?.rows) {
      for (const row of block.content.rows) {
        for (const cell of row.cells ?? []) {
          if (typeof cell === "string") parts.push(cell);
          else parts.push(extractPlainText(cell as PageContent));
        }
      }
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of content as PartialBlock[]) visit(block);
  return parts.join(" ").trim();
}

export function extractBlockNoteTitle(
  content: PageContent | undefined,
): string {
  const blocks = normalizePageContent(content);
  const first = blocks[0] as any;
  if (first?.type === "heading") {
    const text = extractPlainText([first] as BlockNoteContent);
    if (text) return text;
  }
  return "无标题";
}
