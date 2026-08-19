import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";

export interface ImportResult {
  title: string;
  content: BlockNoteContent;
  success: boolean;
  error?: string;
  filename?: string;
}

export { parseInlineMarkdown } from "./parse/inline";
export { markdownToJsonContent } from "./parse/block";
export { importFromMarkdown, importMarkdownFragment } from "./parse/entry";
