import { describe, expect, it } from "vitest";
import { validateAiOutput } from "../../src/core/ai/validateAiOutput";

describe("validateAiOutput", () => {
  it("accepts complete Markdown and rejects blank results", () => {
    expect(validateAiOutput("# Title\n\nText")).toBe("# Title\n\nText");
    expect(() => validateAiOutput("  \n")).toThrow("空结果");
  });

  it("rejects incomplete fenced code and display math", () => {
    expect(() => validateAiOutput("```ts\nconst x = 1;")).toThrow("代码块中途结束");
    expect(() => validateAiOutput("$$\nx^2")).toThrow("数学公式块中途结束");
    expect(validateAiOutput("```ts\nconst x = 1;\n```" )).toContain("const x");
  });

  it("does not mistake fence or math markers inside inline and fenced code for open blocks", () => {
    const text = "Inline `literal ``` and $$ markers` stay literal.\n\n```text\n$$\n```";
    expect(validateAiOutput(text)).toBe(text);
  });
});
