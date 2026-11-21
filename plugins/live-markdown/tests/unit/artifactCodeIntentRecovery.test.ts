import { describe, expect, it } from "vitest";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { validateCodeBodySyntax } from "../../src/core/ai/codeBodySyntax";
import { definesAsyncFunction } from "../../src/core/ai/codeFunctionRequirement";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const asyncInstruction = "在文末添加 TypeScript 代码块，定义异步函数 loadLabel，接收字符串参数并返回该字符串，不要添加标题。";
const titledFunctionInstruction = "在文末新增二级标题“Example”，后面放 TypeScript 代码块，定义 makeLabel 函数，返回包含 name 参数的模板字符串。";
const markdownInstruction = "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world。";

function resolve(instruction: string) {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return { requirements, spec };
}

function prepared(instruction: string) {
  const { requirements, spec } = resolve(instruction);
  return { requirements, spec, fill: prepareArtifactFill({ instruction, spec, requirements }) };
}

function response(payload: string): string {
  return JSON.stringify({ payload });
}

function request(instruction: string, source: string): AiTaskRequest {
  return {
    source,
    action: "custom",
    userPrompt: instruction,
    baseSystemPrompt: "",
    actionDefinition: { id: "custom", label: "custom", prompt: instruction, system: "" }
  };
}

function document(content: string): AiDocumentSnapshot {
  return { documentId: "artifact-code.md", revision: 4, content, selection: null, cursor: null, readOnly: false };
}

describe("grounded code instruction recovery", () => {
  it("extracts names only when the instruction clearly asks for a function", () => {
    const { spec } = resolve(asyncInstruction);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.functionName?.value).toBe("loadLabel");

    const nameFirst = resolve("新增 TypeScript 代码块，定义 makeLabel 函数，返回 `hi`。").spec;
    expect(nameFirst.kind).toBe("code");
    if (nameFirst.kind === "code") expect(nameFirst.functionName?.value).toBe("makeLabel");

    const english = resolve("Create a TypeScript code block and define async loadLabel to return its input.").spec;
    expect(english.kind).toBe("code");
    if (english.kind === "code") expect(english.functionName?.value).toBe("loadLabel");

    const englishNameFirst = resolve("Create a TypeScript code block and define makeLabel function.").spec;
    expect(englishNameFirst.kind).toBe("code");
    if (englishNameFirst.kind === "code") expect(englishNameFirst.functionName?.value).toBe("makeLabel");

    const languageBeforeFunction = resolve("在文末生成 TypeScript 函数 add(a, b)。").spec;
    expect(languageBeforeFunction.kind).toBe("code");
    if (languageBeforeFunction.kind === "code") expect(languageBeforeFunction.functionName?.value).toBe("add");

    const variable = resolve("新增 Python 代码块，定义 run_check = True。").spec;
    expect(variable.kind).toBe("code");
    if (variable.kind === "code") expect(variable.functionName).toBeUndefined();

    const assignment = resolve("在文末用四级标题“接口”，随后用 Python 代码围栏定义 run_check。").spec;
    expect(assignment.kind).toBe("code");
    if (assignment.kind === "code") expect(assignment.functionName).toBeUndefined();

    const mentionsAndNegations = [
      "在文末新增 Python 代码块，说明现有函数 run_check 的作用。",
      "在文末新增 TypeScript 代码块，不要定义foo。",
      "在文末新增 TypeScript 代码块，不要定义函数 foo()。",
      "在文末新增 TypeScript 代码块，保留foo不变。",
      "在文末新增 TypeScript 代码块，保留现有函数 foo。"
    ];
    for (const instruction of mentionsAndNegations) {
      const spec = resolve(instruction).spec;
      expect(spec.kind).toBe("code");
      if (spec.kind === "code") expect(spec.functionName).toBeUndefined();
    }
  });

  it("passes an explicitly requested async constraint into the constrained code prompt", () => {
    const { fill } = prepared(asyncInstruction);
    expect(fill).not.toBeNull();
    expect(fill!.prompt).toContain("loadLabel");
    expect(fill!.prompt).toMatch(/(?:异步|async)/iu);
    expect(fill!.prompt).toContain("Promise<T>");
    expect(fill!.prompt).toContain("省略返回类型注解");
    expect(fill!.prompt).toContain("不能直接标注 string、number、void");
  });

  it("keeps the TypeScript type-check boundary explicit for an invalid async return annotation", () => {
    const invalidTypeAnnotation = "async function loadLabel(str: string): string { return str; }";
    expect(validateCodeBodySyntax(invalidTypeAnnotation, "typescript")).toBe("valid");

    const { fill } = prepared(asyncInstruction);
    expect(fill).not.toBeNull();
    const result = fill!.decode(response(invalidTypeAnnotation));
    expect(result.text).toContain(": Promise<string>");
    expect(result.warnings.join(" ")).toContain("将显式基础类型注解包装为 Promise<T>");
    expect(result.warnings.join(" ")).toContain("未执行完整类型检查");
  });

  it("repairs a valid async TypeScript body with an unambiguous repeated language label on the closing fence", () => {
    const { fill } = prepared(asyncInstruction);
    expect(fill).not.toBeNull();
    const capturedShape = "```typescript\nexport async function loadLabel(label: string): Promise<string> {\n  return label;\n}\n```typescript";
    const result = fill!.decode(response(capturedShape));
    expect(result.text).toBe("```typescript\nexport async function loadLabel(label: string): Promise<string> {\n  return label;\n}\n```");
    expect(result.warnings.join(" ")).toContain("关闭围栏");
  });

  it("does not repair the captured sync response into an async function", () => {
    const { fill } = prepared(asyncInstruction);
    expect(fill).not.toBeNull();
    const capturedB33 = "```typescript\nfunction loadLabel(label: string): string {\n  return label;\n}\n```typescript";
    expect(() => fill!.decode(response(capturedB33))).toThrow();
  });

  it("checks async arrows and function expressions against the requested binding", () => {
    const { fill } = prepared(asyncInstruction);
    expect(fill).not.toBeNull();
    const arrow = "const loadLabel = async (label: string): Promise<string> => label;";
    const expression = "const loadLabel = async function (label: string): Promise<string> { return label; };";
    for (const body of [arrow, expression]) {
      expect(definesAsyncFunction(body, "typescript", "loadLabel")).toBe(true);
      expect(fill!.decode(response(body)).text).toContain(body);
    }

    const nestedAsync = "function loadLabel(label: string): Promise<string> { return (async () => label)(); }";
    const mismatchedAsyncName = "const other = async (label: string): Promise<string> => label;";
    const destructuringAlias = "const { loadLabel } = { loadLabel: async (label: string) => label };";
    for (const body of [nestedAsync, mismatchedAsyncName, destructuringAlias]) {
      expect(definesAsyncFunction(body, "typescript", "loadLabel")).toBe(false);
      expect(() => fill!.decode(response(body))).toThrow();
    }
  });

  it("does not repair a malformed body merely because its closing fence repeats the language", () => {
    const { fill } = prepared("在文末添加 TypeScript 代码块，定义 greetUser 函数。");
    expect(fill).not.toBeNull();
    const malformed = "```typescript\nfunction greetUser(name: string): string {\n```typescript";
    expect(() => fill!.decode(response(malformed))).toThrow();
  });

  it("keeps async generation for unsupported languages while reporting the static-check boundary", () => {
    const instruction = "在文末添加 Python 代码块，定义异步函数 loadLabel，返回传入值。";
    const { fill } = prepared(instruction);
    expect(fill).not.toBeNull();
    const result = fill!.decode(response("async def loadLabel(label):\n    return label"));
    expect(result.text).toContain("async def loadLabel");
    expect(result.warnings.join(" ")).toContain("异步声明未做静态验证");
  });

  it("removes only the exact title plus empty repeated fence after a valid raw body", () => {
    const { fill } = prepared(titledFunctionInstruction);
    expect(fill).not.toBeNull();
    const capturedB33 = "function makeLabel(name: string): string {\n  return `Example: ${name}`;\n}\n\n### Example\n\n```typescript\n\n```";
    const result = fill!.decode(response(capturedB33));
    expect(result.text).toBe("## Example\n\n```typescript\nfunction makeLabel(name: string): string {\n  return `Example: ${name}`;\n}\n```");
    expect(result.warnings.join(" ")).toContain("空代码围栏");
  });

  it("does not select one body from an invalid, mismatched, or mixed redundant shell", () => {
    const { fill } = prepared(titledFunctionInstruction);
    expect(fill).not.toBeNull();
    const valid = "function makeLabel(name: string): string { return `Example: ${name}`; }";
    const invalid = "function makeLabel(name: string): string {";
    for (const payload of [
      `${invalid}\n\n### Example\n\n\`\`\`typescript\n\n\`\`\``,
      `${valid}\n\n### Other\n\n\`\`\`typescript\n\n\`\`\``,
      `${valid}\n\n### Example\n\n\`\`\`typescript\nconst different = true;\n\`\`\``,
      `${valid}\n\n### Example\n\n\`\`\`typescript\n\n\`\`\`\n\n## Follow-up`
    ]) expect(() => fill!.decode(response(payload))).toThrow();
  });

  it("does not use a single-body adapter when several code blocks were explicitly requested", () => {
    for (const instruction of [
      "在文末新增二级标题“Example”，后面放两个 TypeScript 代码块，定义 makeLabel 函数。",
      "Add an H2 heading Example and two TypeScript code blocks defining makeLabel function."
    ]) expect(prepared(instruction).fill).toBeNull();
  });

  it("deterministically composes a fully specified Markdown heading and one literal list item", () => {
    const { spec } = resolve(markdownInstruction);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.composition).toBe("complete");
    expect(spec.literalBody?.value).toBe("# hello\n\n- world");
    expect(renderArtifact(spec)).toBe("```markdown\n# hello\n\n- world\n```");
  });

  it.each([
    ["在文末新增 Markdown 代码块，标题二“Release”，并加入有序列表“验证”。", "## Release\n\n1. 验证"],
    ["在文末新增 Markdown 代码块，标题一 hello，并加入一段正文“welcome”。", "# hello\n\nwelcome"]
  ])("composes only a single explicit ordered-list or paragraph body: %s", (instruction, body) => {
    const { spec } = resolve(instruction);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.literalBody?.value).toBe(body);
    expect(spec.composition).toBe("complete");
  });

  it("uses zero model calls for fully literal Markdown and preserves the original source", async () => {
    const source = "# Existing\n\nKeep this source byte for byte.";
    const snapshot = document(source);
    let calls = 0;
    const options: AiTaskRunnerOptions = {
      invoke: async () => { calls += 1; return "unexpected model response"; },
      isCurrent: () => true,
      abortCurrent() {}
    };
    const result = await runPlannedAiTaskCore(request(markdownInstruction, source), snapshot, options);
    expect(calls).toBe(0);
    expect(result.proposal?.patch?.insertText).toContain("```markdown\n# hello\n\n- world\n```");
    expect(result.proposal?.patch?.insertText).not.toContain("title one");
    expect(snapshot.content).toBe(source);
  });

  it("uses one model call for a semantic function body and keeps the source unchanged before review", async () => {
    const source = "# Existing\n\nKeep this source byte for byte.";
    const snapshot = document(source);
    const capturedB33 = "function makeLabel(name: string): string {\n  return `Example: ${name}`;\n}\n\n### Example\n\n```typescript\n\n```";
    let calls = 0;
    const options: AiTaskRunnerOptions = {
      invoke: async () => { calls += 1; return response(capturedB33); },
      isCurrent: () => true,
      abortCurrent() {}
    };
    const result = await runPlannedAiTaskCore(request(titledFunctionInstruction, source), snapshot, options);
    expect(calls).toBe(1);
    expect(result.proposal?.patch?.insertText).toContain("## Example\n\n```typescript\nfunction makeLabel");
    expect(snapshot.content).toBe(source);
  });

  it.each([
    ["typed async arrow", "const loadLabel = async (label: string): Promise<string> => label;"],
    ["typed async function expression", "const loadLabel = async function (label: string): Promise<string> { return label; };"]
  ])("accepts a %s through the one-call task runner", async (_label, body) => {
    const source = "# Existing\n\nKeep this source byte for byte.";
    const snapshot = document(source);
    let calls = 0;
    const options: AiTaskRunnerOptions = {
      invoke: async () => { calls += 1; return response(body); },
      isCurrent: () => true,
      abortCurrent() {}
    };
    const result = await runPlannedAiTaskCore(request(asyncInstruction, source), snapshot, options);
    expect(calls).toBe(1);
    expect(result.proposal?.patch?.insertText).toContain(body);
    expect(snapshot.content).toBe(source);
  });

  it("does not ask Markdown code generation to invent a function body", () => {
    const { fill } = prepared("在文末新增 Markdown 代码块，内容为一段简短说明文字。");
    expect(fill).not.toBeNull();
    expect(fill!.prompt).toContain("生成目标语言语法完整的代码正文");
    expect(fill!.prompt).not.toContain("指定函数必须有有效函数体");
  });

  it("keeps ambiguous or additional Markdown instructions on the model path", () => {
    for (const instruction of [
      "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world，并解释如何阅读。",
      "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world，另加一张表格。",
      "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world 以及二级标题 later。"
    ]) {
      const { spec } = resolve(instruction);
      expect(renderArtifact(spec)).toBeUndefined();
      if (spec.kind === "code") {
        expect(spec.composition).toBe("partial");
        expect(spec.literalBody).toBeUndefined();
      }
    }
  });
});
