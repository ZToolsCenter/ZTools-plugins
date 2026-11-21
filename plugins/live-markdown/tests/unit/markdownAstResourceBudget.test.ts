import { describe, expect, it } from "vitest";
import {
  isWithinMarkdownAstByteBudget,
  MARKDOWN_AST_RESOURCE_BUDGET
} from "../../src/core/ai/markdownAstResourceBudget";

describe("shared Markdown AST resource budget", () => {
  it("accepts exactly the validator's UTF-8 byte limit", () => {
    const maxBytes = MARKDOWN_AST_RESOURCE_BUDGET.maxDocumentBytes;
    expect(isWithinMarkdownAstByteBudget("x".repeat(maxBytes))).toBe(true);
    expect(isWithinMarkdownAstByteBudget("x".repeat(maxBytes - 3) + "中")).toBe(true);
  });

  it("rejects over-limit ASCII and multibyte text", () => {
    const maxBytes = MARKDOWN_AST_RESOURCE_BUDGET.maxDocumentBytes;
    expect(isWithinMarkdownAstByteBudget("x".repeat(maxBytes + 1))).toBe(false);
    expect(isWithinMarkdownAstByteBudget("x".repeat(maxBytes - 2) + "中")).toBe(false);
  });
});
