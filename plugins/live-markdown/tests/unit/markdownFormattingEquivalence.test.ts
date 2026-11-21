import { describe, expect, it } from "vitest";
import { validateMarkdownAstIntegrity } from "../../src/core/ai/markdownAstIntegrity";

describe("Markdown formatting equivalence", () => {
  it("can permit emphasis-only formatting changes while keeping code and block semantics", () => {
    const source = "这是 **强调和 `stable`**。";
    const output = "这是强调和 `stable`。";
    const options = { allowInlineStyleChanges: true };
    expect(validateMarkdownAstIntegrity(source, output, true, undefined, options).inlineStyleChanged).toBe(true);
    expect(() => validateMarkdownAstIntegrity(source, output.replace("stable", "changed"), true, undefined, options)).toThrow(/代码/);
    expect(() => validateMarkdownAstIntegrity("- [ ] 待办", "- [x] 待办", true, undefined, options)).toThrow(/完成状态/);
    expect(() => validateMarkdownAstIntegrity("这里~~删除~~内容。", "这里删除内容。", true, undefined, options)).toThrow(/语义/);
  });
  it("allows equivalent unordered and ordered list delimiters, including nested lists", () => {
    const source = "- 第一项\n  - 子项\n- 第二项\n\n3. [ ] 待办\n4. [x] 完成";
    const output = "* 第一项\n  + 子项\n* 第二项\n\n3) [ ] 待办\n4) [x] 完成";
    expect(() => validateMarkdownAstIntegrity(source, output, true)).not.toThrow();
  });

  it("allows heading notation and emphasis delimiter changes with the same semantics", () => {
    const source = "# 标题\n\n## 小标题 `API`\n\n正文 **加粗**，以及 *强调*。";
    const output = "标题\n===\n\n小标题 `API`\n---\n\n正文 __加粗__，以及 _强调_。";
    expect(() => validateMarkdownAstIntegrity(source, output, true)).not.toThrow();
  });

  it("still rejects numbering, nesting, heading level and task state changes", () => {
    expect(() => validateMarkdownAstIntegrity("3. 甲\n4. 乙", "1) 甲\n2) 乙", true)).toThrow(/列表结构/);
    expect(() => validateMarkdownAstIntegrity("- 甲\n  - 乙", "* 甲\n* 乙", true)).toThrow(/列表结构/);
    expect(() => validateMarkdownAstIntegrity("# 甲", "甲\n---", true)).toThrow(/标题层级/);
    expect(() => validateMarkdownAstIntegrity("- [ ] 甲", "+ [x] 甲", true)).toThrow(/完成状态/);
  });

  it("keeps protected payloads and link targets fixed through equivalent formatting", () => {
    const source = "## 链接 [API](https://example.test/a)\n\n- `const x = 1`";
    expect(() => validateMarkdownAstIntegrity(source, source.replace("/a)", "/b)"), true)).toThrow(/链接目标/);
    expect(() => validateMarkdownAstIntegrity(source, source.replace("x = 1", "x = 2"), true)).toThrow(/代码/);
    expect(() => validateMarkdownAstIntegrity("正文", "正文\n\n```ts\ntext", true)).toThrow(/代码块中途结束/);
    expect(() => validateMarkdownAstIntegrity("公式 \\(x+y\\) 保持。", "公式 \\(x-y\\) 保持。", true)).toThrow(/数学公式/);
  });
});
