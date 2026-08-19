import type { PartialBlock } from "@blocknote/core";

export type BlockNoteContent = PartialBlock[];

export const TITLE_HEADING_LEVEL = 1;

export const emptyBlock = (): PartialBlock => ({ type: "paragraph", content: "" });

export const titleHeadingBlock = (content = ""): PartialBlock =>
  ({
    type: "heading",
    props: { level: TITLE_HEADING_LEVEL },
    content,
  }) as PartialBlock;

export function createEmptyBlockNoteContent(title = ""): BlockNoteContent {
  return [titleHeadingBlock(title), emptyBlock()];
}

export function createEmptyLocalPageContent(): BlockNoteContent {
  return [emptyBlock()];
}

export function isBlockNoteContent(content: unknown): content is BlockNoteContent {
  return Array.isArray(content);
}
