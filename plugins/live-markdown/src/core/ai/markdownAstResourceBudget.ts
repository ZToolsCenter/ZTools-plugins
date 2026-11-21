export const MARKDOWN_AST_RESOURCE_BUDGET = Object.freeze({
  maxDocumentBytes: 1024 * 1024,
  maxNodes: 50_000,
  maxDepth: 128
});

const encoder = new TextEncoder();

/** Cheaply rejects obviously oversized text before computing its exact UTF-8 size. */
export function isWithinMarkdownAstByteBudget(source: string): boolean {
  if (source.length > MARKDOWN_AST_RESOURCE_BUDGET.maxDocumentBytes) return false;
  return encoder.encode(source).byteLength <= MARKDOWN_AST_RESOURCE_BUDGET.maxDocumentBytes;
}

export function markdownAstByteLength(source: string): number {
  return encoder.encode(source).byteLength;
}
