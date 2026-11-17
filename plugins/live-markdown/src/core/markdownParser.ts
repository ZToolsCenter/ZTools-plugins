import { MarkdownBlock, OutlineItem } from "../types/typora";
import { parseMarkdownToBlocks } from "./markdownBlockParser";
import { extractOutline } from "./markdownHeadings";

export { parseMarkdownToBlocks } from "./markdownBlockParser";
export type { ParsedMarkdownDocument } from "./markdownBlockParser";
export { slugifyHeading } from "./markdownHeadings";
export { prettifyMarkdownTable, createEmptyTableBlock } from "./markdownTable";
export { serializeBlockToRaw, serializeBlocksToMarkdown } from "./markdownSerialization";
export { extractOutline } from "./markdownHeadings";
export { computeWordCountStats } from "./markdownStatistics";
export { convertBlockType, applyInlineFormatToText, htmlToMarkdownSmartPaste } from "./markdownTransforms";

export function parseMarkdownDocument(markdown: string): {
  blocks: MarkdownBlock[];
  outline: OutlineItem[];
  yamlMeta: Record<string, string>;
  refLinks: Record<string, { url: string; title?: string }>;
  footnotes: Record<string, string>;
} {
  const parsed = parseMarkdownToBlocks(markdown);
  const outline = extractOutline(parsed.blocks);
  return {
    ...parsed,
    outline
  };
}
