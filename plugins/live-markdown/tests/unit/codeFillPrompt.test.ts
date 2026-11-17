import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";

function prepare(instruction: string, source = "PRIVATE_SOURCE_SENTINEL") {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return prepareArtifactFill({ instruction, spec, requirements, source });
}

describe("code fill prompt contract", () => {
  it("uses the schema contract without injecting a fake code-body example", () => {
    const instruction = "在文末生成 TypeScript 函数 transformRecord。";
    const prepared = prepare(instruction);

    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).not.toContain("<raw code body>");
    expect(prepared!.prompt).not.toContain("示例只演示 JSON 形状");
    expect(prepared!.prompt).toContain("返回仅含 payload 键的 JSON 对象");
    expect(prepared!.prompt).toContain("payload 的值为按用户要求生成的实际代码字符串");
    expect(prepared!.prompt).toContain(instruction);
    expect(prepared!.prompt).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(prepared!.outputSchema).toMatchObject({
      type: "object",
      properties: { payload: { type: "string", minLength: 1, maxLength: 32_768 } },
      required: ["payload"],
      additionalProperties: false
    });
    expect(prepared!.maxTokens).toBe(1536);
  });

  it("keeps language and function requirements, and decodes valid Python source", () => {
    const prepared = prepare("在文末生成 Python 函数 add(a, b)。");
    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).toContain('目标语言标签为 "python"');
    expect(prepared!.prompt).toContain('按用户要求定义函数 "add"');

    const body = "def add(a, b):\n    return a + b";
    expect(prepared!.decode(JSON.stringify({ payload: body })).text).toBe(`\`\`\`python\n${body}\n\`\`\``);
  });

  it("includes source only when the code task depends on it", () => {
    const source = "SOURCE_CONTRACT_SENTINEL: identifiers use the `item-` prefix.";
    const prepared = prepare("根据原文，在文末生成 Python 函数 extract_id(text)，提取文本中的标识符。", source);

    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).toContain(source);
    expect(prepared!.prompt).toContain('按用户要求定义函数 "extract_id"');
  });

  it("preserves JavaScript async requirements and Markdown code bodies", () => {
    const asyncInstruction = "在文末生成 JavaScript 异步函数 fetchProfile(url)。";
    const asyncPrepared = prepare(asyncInstruction);
    expect(asyncPrepared).not.toBeNull();
    expect(asyncPrepared!.prompt).toContain('目标语言标签为 "javascript"');
    expect(asyncPrepared!.prompt).toContain("必须保留 async 声明");
    const asyncBody = "async function fetchProfile(url) { return url; }";
    expect(asyncPrepared!.decode(JSON.stringify({ payload: asyncBody })).text).toContain(asyncBody);

    const markdownPrepared = prepare("在文末新增 Markdown 代码块，写一段缓存使用说明。");
    expect(markdownPrepared).not.toBeNull();
    expect(markdownPrepared!.prompt).toContain('目标语言标签为 "markdown"');
    const markdownBody = "## Cache\n\n- Keep entries short.";
    expect(markdownPrepared!.decode(JSON.stringify({ payload: markdownBody })).text).toContain(markdownBody);
  });

  it("keeps grounded prefix headings and literal code content expressible", () => {
    const headingInstruction = "在文末新增 Python 代码块，前置 H1 标题“运行示例”。";
    const headingPrepared = prepare(headingInstruction);
    expect(headingPrepared).not.toBeNull();
    expect(headingPrepared!.prompt).toContain('目标语言标签为 "python"');
    expect(headingPrepared!.prompt).toContain("代码块前的标题由程序生成");
    expect(headingPrepared!.decode(JSON.stringify({ payload: "print('ready')" })).text)
      .toBe("# 运行示例\n\n```python\nprint('ready')\n```");

    const literalInstruction = "在文末生成 Python 函数 marker()，返回字符串“<raw code body>”。";
    const literalPrepared = prepare(literalInstruction);
    expect(literalPrepared).not.toBeNull();
    const literalBody = 'def marker():\n    return "<raw code body>"';
    expect(literalPrepared!.decode(JSON.stringify({ payload: literalBody })).text).toContain(literalBody);
  });
});
