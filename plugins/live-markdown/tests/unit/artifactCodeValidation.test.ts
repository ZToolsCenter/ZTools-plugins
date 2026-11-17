import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

const typescriptInstruction = "在文末新增 Markdown 二级标题“API <v2> & C++”，其后放 TypeScript 代码围栏并定义 greetUser 函数。";
const javascriptInstruction = "在文末生成 JavaScript 代码块，定义 greetUser 函数。";

function prepare(instruction: string) {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return prepareArtifactFill({ instruction, spec, requirements, source: "现有内容保持不变。" });
}

function response(payload: string): string { return JSON.stringify({ payload }); }

describe("generated JavaScript and TypeScript bodies", () => {
  it("rejects malformed TypeScript inside an otherwise valid fenced artifact", () => {
    const prepared = prepare(typescriptInstruction);
    expect(prepared).not.toBeNull();
    expect(() => prepared!.decode(response("function greetUser(name: string): string {"))).toThrow();
  });

  it("accepts valid TypeScript with template strings and comments", () => {
    const prepared = prepare(typescriptInstruction);
    expect(prepared).not.toBeNull();
    const code = "// greeting\nfunction greetUser(name: string): string {\n  return `Hello, ${name}!`;\n}";
    expect(prepared!.decode(response(code)).text).toContain(code);
  });

  it("accepts valid JavaScript while rejecting an incomplete statement", () => {
    const prepared = prepare(javascriptInstruction);
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(response("function greetUser(name) { return `Hello, ${name}!`; }")).text)
      .toContain("function greetUser");
    expect(() => prepared!.decode(response("const message = ;"))).toThrow();
  });

  it("recovers the exact requested heading and one duplicated, identical fenced code body", () => {
    const prepared = prepare(typescriptInstruction);
    expect(prepared).not.toBeNull();
    const code = "function greetUser(name: string): string {\n  return `Hello, ${name}!`;\n}";
    const noisy = `${code}\n\n### API <v2> & C++\n\n\`\`\`typescript\n${code}\n\`\`\``;
    const result = prepared!.decode(response(noisy));
    expect(result.text).toBe(`## API \\<v2\\> & C\\+\\+\n\n\`\`\`typescript\n${code}\n\`\`\``);
    expect(result.warnings.join(" ")).toContain("已移除与明确标题关联的重复代码副本");
  });

  it("does not pick a winner when the duplicated code or surrounding structure differs", () => {
    const prepared = prepare(typescriptInstruction);
    expect(prepared).not.toBeNull();
    const code = "function greetUser(name: string): string { return name; }";
    const different = "function greetUser(name: string): string { return `Hello ${name}`; }";
    for (const payload of [
      `${code}\n\n### API <v2> & C++\n\n\`\`\`typescript\n${different}\n\`\`\``,
      `${code}\n\n### Other title\n\n\`\`\`typescript\n${code}\n\`\`\``,
      `${code}\n\nIntro\n\n### API <v2> & C++\n\n\`\`\`typescript\n${code}\n\`\`\``
    ]) expect(() => prepared!.decode(response(payload))).toThrow();
  });

  it("keeps valid nested fences and syntax highlighting examples inside Markdown artifacts", () => {
    const instruction = "在文末新增一个 Markdown 代码块示例。";
    const prepared = prepare(instruction);
    expect(prepared).not.toBeNull();
    const markdown = "```ts\nconst message: string = `ok`;\n```";
    expect(prepared!.decode(response(markdown)).text).toContain(markdown);
  });

  it("leaves unsupported languages on the existing bounded artifact validation path", () => {
    const instruction = "在文末生成 Python 函数 greetUser(name)。";
    const prepared = prepare(instruction);
    expect(prepared).not.toBeNull();
    const result = prepared!.decode(response("def greetUser(name):\n    return f'Hello, {name}!'"));
    expect(result.text).toContain("def greetUser");
    expect(result.warnings.join(" ")).toContain("未对 python 内容做语法解析");
  });
});
