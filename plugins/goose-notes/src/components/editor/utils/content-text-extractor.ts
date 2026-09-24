import type { JSONContent } from "@/types";
import { extractBlockNoteTitle, extractPlainText } from "./blocknote-content";

/** 提取页面纯文本，用于搜索 */
export function extractTextFromContent(content: JSONContent): string {
  return extractPlainText(content);
}

/** 提取页面标题 */
export function extractTitleFromContent(content: JSONContent): string {
  return extractBlockNoteTitle(content);
}

function getTopLevelBlocks(content: JSONContent): any[] {
  if (Array.isArray(content)) return content;
  return Array.isArray(content?.content) ? content.content : [];
}

function getBlockLevel(block: any): number | undefined {
  return block?.props?.level ?? block?.attrs?.level;
}

/**
 * 提取页面结构摘要，用于 AI 上下文（替代全文注入以节省 token）
 *
 * 输出格式：
 * - 标题（h1）
 * - 段落标题列表（h2/h3）
 * - 前几段的开头摘要（各截取 summaryMaxChars 字）
 * - 总字数
 *
 * 当 includeBlockIds 为 true 时，每一行前会带上块 id 前缀，例如
 * `[blk_xxx] ## 二级标题`，供 AI 在结构化定位时引用。
 */
export function extractStructureSummary(
  content: JSONContent,
  options?: {
    summaryMaxChars?: number;
    maxSummaryParagraphs?: number;
    includeBlockIds?: boolean;
  },
): string {
  const summaryMaxChars = options?.summaryMaxChars ?? 120;
  const maxSummaryParagraphs = options?.maxSummaryParagraphs ?? 3;
  const includeBlockIds = options?.includeBlockIds ?? false;

  const blocks = getTopLevelBlocks(content);
  if (!blocks.length) return "（空白页面）";

  const headings: string[] = [];
  const summaries: string[] = [];
  let summaryCount = 0;
  let wordCount = 0;

  const formatLine = (block: any, body: string) => {
    if (!includeBlockIds) return body;
    const id = typeof block?.id === "string" ? block.id : "";
    return id ? `[${id}] ${body}` : body;
  };

  for (const block of blocks) {
    const level = getBlockLevel(block);

    if (block.type === "heading" && level) {
      const headingText = extractTextFromContent(block).trim();
      if (headingText) {
        headings.push(formatLine(block, `${"#".repeat(level)} ${headingText}`));
      }
      continue;
    }

    if (
      block.type === "paragraph" &&
      summaryCount < maxSummaryParagraphs
    ) {
      const text = extractTextFromContent(block).trim();
      if (text) {
        const totalWords = countWords(block);
        wordCount += totalWords;
        const snippet =
          text.length > summaryMaxChars
            ? `${text.slice(0, summaryMaxChars)}...`
            : text;
        summaries.push(formatLine(block, snippet));
        summaryCount += 1;
        continue;
      }
    }

    if (block.content) {
      wordCount += countWords(block);
    }
  }

  const parts: string[] = [];
  if (headings.length > 0) {
    parts.push(`段落结构：\n${headings.join("\n")}`);
  }
  if (summaries.length > 0) {
    parts.push(`内容摘要：\n${summaries.join("\n")}`);
  }
  parts.push(`总字数：约 ${wordCount} 字`);

  return parts.join("\n\n");
}

/**
 * 统计字数
 * - 中文字符：每个算 1 字
 * - 英文单词：每个算 1 字
 * - 连续数字：算 1 字
 */
export function countWords(content: JSONContent): number {
  const text = extractTextFromContent(content);
  if (!text) return 0;

  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const englishWords = text.match(/[a-zA-Z]+/g) || [];
  const numberGroups = text.match(/\d+/g) || [];

  return chineseChars.length + englishWords.length + numberGroups.length;
}
