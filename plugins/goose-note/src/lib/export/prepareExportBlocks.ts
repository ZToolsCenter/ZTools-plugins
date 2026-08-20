import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { normalizePageContent } from "@/components/editor/utils/blocknote-content";
import { inlineExportMediaAsBase64 } from "./inlineImagesBase64";

function asInlineContent(content: unknown): unknown[] {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content, styles: {} }] : [];
  }
  return [];
}

function sanitizeExportBlock(block: unknown): Record<string, unknown> {
  if (!block || typeof block !== "object") {
    return { type: "paragraph", content: [] };
  }
  const next = { ...(block as Record<string, unknown>) };
  if (next.type !== "table") {
    next.content = asInlineContent(next.content);
  }
  if (Array.isArray(next.children)) {
    next.children = next.children.map(sanitizeExportBlock);
  } else {
    next.children = [];
  }
  return next;
}

/**
 * 把任意 page.content（BlockNote 数组、旧 doc 对象、本地文件夹占位）收成可导出的块数组。
 * 本地文件夹不强制首块 H1。
 */
export function cloneExportBlocks(
  content: Page["content"] | unknown,
  options?: { ensureFirstTitle?: boolean },
): BlockNoteContent {
  const normalized = Array.isArray(content)
    ? (structuredClone(content) as BlockNoteContent)
    : normalizePageContent(content as never, {
        ensureFirstTitle: options?.ensureFirstTitle,
      });
  return normalized.map(sanitizeExportBlock) as BlockNoteContent;
}

export async function prepareExportBlocks(page: Page): Promise<BlockNoteContent> {
  const blocks = cloneExportBlocks(page.content, {
    ensureFirstTitle: !page.localFilePath,
  });
  await inlineExportMediaAsBase64(blocks, page.localFilePath);
  return blocks;
}
