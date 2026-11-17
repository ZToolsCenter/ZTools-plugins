import { MarkdownBlock, OutlineItem } from "../types/typora";
import { markdownInlineDisplayText } from "./markdownInlineDisplayText";

export function slugifyHeading(text: string): string {
  const cleaned = String(text || "")
    .replace(/[*_~`[\]()!<>]/g, "")
    .trim()
    .toLowerCase();
  const slug = cleaned
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
  return slug || "section";
}

export function extractOutline(blocks: MarkdownBlock[]): OutlineItem[] {
  const slugCounts = new Map<string, number>();
  const outline: OutlineItem[] = [];

  for (const block of blocks) {
    if (block.type === "heading" && block.headingLevel && block.text !== undefined) {
      const baseSlug = block.slug || slugifyHeading(block.text);
      const count = slugCounts.get(baseSlug) || 0;
      slugCounts.set(baseSlug, count + 1);
      const uniqueSlug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
      const displayTitle = markdownInlineDisplayText(block.text);
      outline.push({
        id: `outline-${block.id}`,
        blockId: block.id,
        level: block.headingLevel,
        text: displayTitle,
        slug: uniqueSlug,
        line: block.startLine
      });
    }
  }
  return outline;
}
