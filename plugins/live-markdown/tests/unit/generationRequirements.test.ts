import { describe, expect, it } from "vitest";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

describe("generation requirements for explicit code artifacts", () => {
  it("keeps an addition inside a requested table as content rather than a second editor action", () => {
    const requirements = resolveGenerationRequirements("新增一个 Markdown 表格，表格中添加一个风险列", "custom");
    expect(requirements.artifact).toMatchObject({ state: "explicit", value: "table" });
    expect(requirements.contentInstruction).toContain("表格中添加一个风险列");
  });
  it.each([
    "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。保留原有内容，只输出新增代码块。",
    "请在文章结尾添加 Python 代码围栏，定义 multiply(a, b) 并返回它们的乘积；保留原文，仅输出新代码。",
    "在文末追加 Python 代码块，定义 multiply(a, b) 并返回 a*b，只输出该代码块。"
  ])("fixes the requested artifact as code for generation: %s", instruction => {
    expect(resolveGenerationRequirements(instruction, "custom").artifact)
      .toMatchObject({ state: "explicit", value: "code" });
  });

  it("does not mistake requested explanatory prose about code for a code artifact", () => {
    const instruction = "在文末新增一段解释 Python 代码用途的文字，保留原文。";

    expect(resolveGenerationRequirements(instruction, "custom").artifact.state).toBe("unknown");
  });

  it.each([
    ["在“紧急事项”文末新增一段说明。", "紧急事项"],
    ["在“文末”新增一段说明。", "“文末”"]
  ])("preserves quoted text while stripping only unquoted placement controls: %s", (instruction, quotedText) => {
    expect(resolveGenerationRequirements(instruction, "custom").contentInstruction).toContain(quotedText);
  });

  it("strips a placement cue across genuine whitespace and merges overlapping control spans", () => {
    const brief = resolveGenerationRequirements("请在   文末新增一段说明。", "custom").contentInstruction;

    expect(brief).toContain("请");
    expect(brief).toContain("说明");
    expect(brief).not.toContain("文末");
  });

  it("keeps nested artifact content instructions while stripping the outer insert action", () => {
    const requirements = resolveGenerationRequirements("新增个markdown的代码块，里面加个h1的hello", "custom");

    expect(requirements.contentInstruction).toBe("markdown的代码块，里面加个h1的hello");
    expect(requirements.contentInstruction).toContain("h1的hello");
    expect(requirements.requiredHeadings).toEqual([]);
  });

  it.each([
    ["新增一个 Markdown 代码块，内部新增一个 h1 标题 hello", "Markdown 代码块，内部新增一个 h1 标题 hello"],
    ["新增一个 Python 代码块，在代码里加个 h1 的 hello", "Python 代码块，在代码里加个 h1 的 hello"],
    ["新增一个代码块，函数中增加返回 hello", "代码块，函数中增加返回 hello"]
  ])("keeps nested content actions after a generated artifact: %s", (instruction, expected) => {
    expect(resolveGenerationRequirements(instruction, "custom").contentInstruction).toBe(expected);
  });

  it("keeps the nested operation in an English artifact instruction", () => {
    const brief = resolveGenerationRequirements("Add a Markdown code block, inside add an H1 heading with hello", "custom").contentInstruction;

    expect(brief).toBe("a Markdown code block, inside add an H1 heading with hello");
  });

  it.each([
    "新增一个 Python 代码块，在里面实现 multiply(a, b) 并返回 a * b。",
    "Add a Python code block containing a multiply(a, b) implementation that returns a * b."
  ])("retains the implementation clause and return behavior in %s", instruction => {
    const brief = resolveGenerationRequirements(instruction, "custom").contentInstruction;

    expect(brief).toMatch(/(?:实现 multiply|implementation that returns)/iu);
    expect(brief).toMatch(/返回 a \* b|returns a \* b/iu);
  });

  it("preserves quoted and negated nested content clauses", () => {
    const quoted = resolveGenerationRequirements("新增个 Markdown 代码块，里面保留“新增 h1 hello”，不要改动已有正文。", "custom").contentInstruction;
    const negated = resolveGenerationRequirements("新增个 Markdown 代码块，里面不要新增 h1 的 hello。", "custom").contentInstruction;

    expect(quoted).toContain("“新增 h1 hello”");
    expect(quoted).toContain("不要改动已有正文");
    expect(negated).toContain("里面不要新增 h1 的 hello");
  });

  it("keeps compound editing instructions intact instead of cleaning them into one operation", () => {
    const brief = resolveGenerationRequirements("新增一个 Markdown 代码块，然后润色全文。", "custom").contentInstruction;

    expect(brief).toContain("新增");
    expect(brief).toContain("润色全文");
  });
});
