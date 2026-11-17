import { describe, expect, it } from "vitest";
import { tokenizeCode } from "../../src/core/codeTokenizer";
import { normalizeCodeTheme } from "../../src/core/codeThemes";

describe("code tokenizer", () => {
  it.each(["js", "ts", "jsx", "tsx", "python", "json", "sh", "sql", "html", "css", "yml", "java", "go", "rust"])("preserves source for %s", (language) => {
    const source = `const x = "<&\"'";\n/* multi\nline */\n<script>alert(1)</script>\n`;
    expect(tokenizeCode(source, language).map((token) => token.value).join("")).toBe(source);
  });
  it("keeps multiline comments and strings in the same syntax context", () => {
    const tokens = tokenizeCode('/* first\nsecond */\nconst s = `one\ntwo`;', "js");
    expect(tokens.some((t) => t.type.includes("hljs-comment") && t.value.includes("first\nsecond"))).toBe(true);
    expect(tokens.some((t) => t.type.includes("hljs-string") && t.value.includes("one\ntwo"))).toBe(true);
  });
  it("falls back to plain source for unsupported or oversized code", () => {
    expect(tokenizeCode("<img onerror=alert(1)>", "unknown")).toEqual([{ type: "plain", value: "<img onerror=alert(1)>" }]);
    expect(tokenizeCode("x".repeat(2001), "js")[0].type).toBe("plain");
    expect(normalizeCodeTheme("invalid")).toBe("auto");
  });
});
