import type { BlockNoteContent } from "./emptyContent";
import { emptyBlock, TITLE_HEADING_LEVEL } from "./emptyContent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBlockType(block: unknown): string | null {
  if (!isRecord(block)) return null;
  return typeof block.type === "string" ? block.type : null;
}

function readHeadingLevel(block: unknown): number | null {
  if (!isRecord(block)) return null;
  if (!isRecord(block.props)) return null;
  return typeof block.props.level === "number" ? block.props.level : null;
}

/**
 * 内部笔记本空态红线：标题一之下必须有一行普通正文块可点可写。
 * 仅当文档顶层只剩标题一（H1）时补一个空段落；有任何其它正文块则原样返回。
 */
export function ensureBodyParagraphAfterTitle(
  content: BlockNoteContent,
): BlockNoteContent {
  if (!Array.isArray(content) || content.length === 0) {
    return content;
  }
  if (content.length !== 1) return content;

  const first = content[0];
  if (readBlockType(first) !== "heading") return content;
  if (readHeadingLevel(first) !== TITLE_HEADING_LEVEL) return content;

  const next: BlockNoteContent = [first, emptyBlock()];
  return next;
}

/**
 * 运行时判断：当前编辑器文档是否「只剩标题一」、需要补空正文。
 */
export function needsBodyParagraphAfterTitle(
  blocks: ReadonlyArray<unknown>,
): boolean {
  if (blocks.length !== 1) return false;
  const first = blocks[0];
  if (readBlockType(first) !== "heading") return false;
  return readHeadingLevel(first) === TITLE_HEADING_LEVEL;
}
