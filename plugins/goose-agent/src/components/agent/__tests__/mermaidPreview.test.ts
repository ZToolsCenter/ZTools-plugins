import { describe, expect, it } from "vitest";
import { formatMermaidError } from "../artifacts/MermaidPreview";

describe("formatMermaidError", () => {
  it("maps empty and syntax errors to Chinese guidance", () => {
    expect(formatMermaidError("")).toMatch(/源码无法解析/);
    expect(formatMermaidError("Parse error on line 1: Expecting")).toMatch(
      /语法有误|showHtml/,
    );
    expect(formatMermaidError("Lexical error")).toMatch(/语法/);
  });

  it("maps unknown diagram type", () => {
    expect(formatMermaidError("No diagram type detected")).toMatch(
      /未识别|graph|flowchart/,
    );
  });

  it("truncates long noisy messages", () => {
    const long = `Error: ${"x".repeat(400)}`;
    const out = formatMermaidError(long);
    expect(out.length).toBeLessThanOrEqual(170);
  });
});
