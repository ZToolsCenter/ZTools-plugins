import { describe, expect, it } from "vitest";
import { blockRangeToDocumentOffsets } from "../../src/core/ai/selectionRange";
import { MarkdownBlock } from "../../src/types/typora";

const block = (id: string, raw: string): MarkdownBlock => ({
  id,
  raw,
  type: "paragraph",
  startLine: 1,
  endLine: 1
});

describe("Markdown block selection offsets", () => {
  it("uses block identity and serialized Markdown lengths rather than matching repeated text", () => {
    const blocks = [block("first", "repeat"), block("second", "repeat")];
    expect(blockRangeToDocumentOffsets(blocks, "second", 0, 6)).toEqual({
      from: 8,
      to: 14
    });
  });

  it("rejects out-of-range, reversed, and empty selections", () => {
    const blocks = [block("first", "abc")];
    expect(blockRangeToDocumentOffsets(blocks, "first", -1, 2)).toBeNull();
    expect(blockRangeToDocumentOffsets(blocks, "first", 2, 1)).toBeNull();
    expect(blockRangeToDocumentOffsets(blocks, "first", 1, 1)).toBeNull();
  });
});
