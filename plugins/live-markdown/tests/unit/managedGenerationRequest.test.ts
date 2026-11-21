import { describe, expect, it } from "vitest";
import { ROLE_PRESETS } from "../../src/core/ai/agentOrchestrator";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import type { ArtifactSpec } from "../../src/core/ai/artifactSpec";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { isTaskSourceReferenced } from "../../src/core/ai/artifactGenerationContext";
import { prepareManagedCodeRequest } from "../../src/core/ai/managedCodeRequest";
import { prepareManagedGenerationRequest } from "../../src/core/ai/managedGenerationRequest";
import { calculateLocalAiBudget } from "../../src/core/ai/requestBudget";
import { buildCodeGenerationScope } from "../../src/core/ai/codeGenerationScope";
import type { ArtifactFillInput, PreparedArtifactFill } from "../../src/core/ai/artifactFill";

const MODEL = "Qwen3-1.7B-Q4_K_M.gguf";
const LIGHT = "Qwen3-0.6B-Q4_K_M.gguf";
const GENERAL = ROLE_PRESETS.find(role => role.id === "general")!.systemPrompt;
const INPUT_MARKER = "输入数据：";

const cases = [
  { id: "B31-CODE-H2", instruction: "在文末新增 Markdown 二级标题“API <v2> & C++”，其后放 TypeScript 代码围栏并定义 greetUser 函数。", source: "# API notes\n\nThe input is validated before the request runs." },
  { id: "B31-CODE-H4", instruction: "在文末用四级标题“接口 (v2) [beta]”，随后用 Python 代码围栏定义 run_check。", source: "# API notes\n\nThe input is validated before the request runs." },
  { id: "R17-JS-SUM", instruction: "在文末新增 JavaScript 代码块，定义 addNumbers 函数；接收两个参数 left 和 right，返回两者之和。", source: "# Function notebook\n\nNo implementation yet." },
  { id: "R17-TS-ASYNC", instruction: "在文末新增 TypeScript 代码块，定义异步函数 loadMessage；接收 message: string，返回收到的 message，不使用网络请求。", source: "# Function notebook\n\nNo implementation yet." },
  { id: "R17-TS-BOOL", instruction: "在文末新增 TypeScript 代码块，定义 isPositive 函数；接收 value: number，返回 value 是否大于零的布尔值。", source: "# Function notebook\n\nNo implementation yet." }
] as const;

const oldRaw = {
  "light|B31-CODE-H2|current": "{\"payload\":\"```typescript\\nconst greetUser = (name: string): string => {\\n  return `Hello, ${name}!`;\\n};\\n```\"}",
  "light|B31-CODE-H2|scoped": "{\"payload\":\"```typescript\\nconst greetUser = (name: string): string => {\\n  return `Hello, ${name}! Welcome to the API <v2> & C++ world.`;\\n};\\n```\"}",
  "light|B31-CODE-H4|current": "{\"payload\":\"```python\\n# 接口 (v2)[beta]\\nrun_check = True\\n```\"}",
  "light|B31-CODE-H4|scoped": "{\"payload\":\"```python\\n# 接口 (v2)[beta]\\nrun_check = True\\n```\"}",
  "light|R17-JS-SUM|current": "{\"payload\":\"function addNumbers(left, right) { return left + right; }\"}",
  "light|R17-JS-SUM|scoped": "{\"payload\":\"function addNumbers(left, right) { return left + right; }\"}",
  "light|R17-TS-ASYNC|current": "{\"payload\":\"async function loadMessage(message: string): Promise<string> { return message; }\"}",
  "light|R17-TS-ASYNC|scoped": "{\"payload\":\"async function loadMessage(message: string): Promise<string> { return new Promise(resolve => { resolve(message); } ); }\"}",
  "light|R17-TS-BOOL|current": "{\"payload\":\"```typescript\\nfunction isPositive(value: number): boolean {\\n  return value > 0;\\n}\\n```typescript\"}",
  "light|R17-TS-BOOL|scoped": "{\"payload\":\"function isPositive(number) { return number > 0; }\"}",
  "balanced|B31-CODE-H2|current": "{\"payload\":\"import { greetUser } from './greetUser.js';\\n\\n// Example usage\\nconst user = 'Alice';\\nconsole.log(greetUser(user));\\n\\n### API <v2> & C++\"}",
  "balanced|B31-CODE-H2|scoped": "{\"payload\":\"function greetUser(name: string): string {\\n  return `Hello, ${name}!`;\\n}\\n\\n### API <v2> & C++\"}",
  "balanced|B31-CODE-H4|current": "{\"payload\":\"import os\\nimport time\\n\\ndef run_check():\\n    # 示例逻辑\\n    print('Check executed')\\n\\n# 接口 (v2) [beta]\\nrun_check()\"}",
  "balanced|B31-CODE-H4|scoped": "{\"payload\":\"import sys\\n\\ndef run_check():\\n    # 示例逻辑\\n    print(\\\"Check executed\\\")\\n\\nif __name__ == \\\"__main__\\\":\\n    run_check()\"}",
  "balanced|R17-JS-SUM|current": "{\"payload\":\"function addNumbers(left, right) { return left + right; }\"}",
  "balanced|R17-JS-SUM|scoped": "{\"payload\":\"function addNumbers(left, right) { return left + right; }\"}",
  "balanced|R17-TS-ASYNC|current": "{\"payload\":\"async function loadMessage(message: string): Promise<string> {\\n  return message;\\n}\"}",
  "balanced|R17-TS-ASYNC|scoped": "{\"payload\":\"async function loadMessage(message: string): Promise<string> { return message; }\"}",
  "balanced|R17-TS-BOOL|current": "{\"payload\":\"function isPositive(value: number): boolean {\\n  return value > 0;\\n}\"}",
  "balanced|R17-TS-BOOL|scoped": "{\"payload\":\"function isPositive(value: number): boolean {\\n  return value > 0;\\n}\"}"
} as const;

const oldDecodedText = {
  "light|B31-CODE-H2|current": "## API \\<v2\\> & C\\+\\+\n\n```typescript\nconst greetUser = (name: string): string => {\n  return `Hello, ${name}!`;\n};\n```",
  "light|B31-CODE-H2|scoped": "## API \\<v2\\> & C\\+\\+\n\n```typescript\nconst greetUser = (name: string): string => {\n  return `Hello, ${name}! Welcome to the API <v2> & C++ world.`;\n};\n```",
  "light|B31-CODE-H4|current": "#### 接口 \\(v2\\) \\[beta\\]\n\n```python\n# 接口 (v2)[beta]\nrun_check = True\n```",
  "light|B31-CODE-H4|scoped": "#### 接口 \\(v2\\) \\[beta\\]\n\n```python\n# 接口 (v2)[beta]\nrun_check = True\n```",
  "light|R17-JS-SUM|current": "```javascript\nfunction addNumbers(left, right) { return left + right; }\n```",
  "light|R17-JS-SUM|scoped": "```javascript\nfunction addNumbers(left, right) { return left + right; }\n```",
  "light|R17-TS-ASYNC|current": "```typescript\nasync function loadMessage(message: string): Promise<string> { return message; }\n```",
  "light|R17-TS-ASYNC|scoped": "```typescript\nasync function loadMessage(message: string): Promise<string> { return new Promise(resolve => { resolve(message); } ); }\n```",
  "light|R17-TS-BOOL|current": "```typescript\nfunction isPositive(value: number): boolean {\n  return value > 0;\n}\n```",
  "light|R17-TS-BOOL|scoped": "```typescript\nfunction isPositive(number) { return number > 0; }\n```",
  "balanced|B31-CODE-H2|current": null,
  "balanced|B31-CODE-H2|scoped": "## API \\<v2\\> & C\\+\\+\n\n```typescript\nfunction greetUser(name: string): string {\n  return `Hello, ${name}!`;\n}\n```",
  "balanced|B31-CODE-H4|current": "#### 接口 \\(v2\\) \\[beta\\]\n\n```python\nimport os\nimport time\n\ndef run_check():\n    # 示例逻辑\n    print('Check executed')\n\n# 接口 (v2) [beta]\nrun_check()\n```",
  "balanced|B31-CODE-H4|scoped": "#### 接口 \\(v2\\) \\[beta\\]\n\n```python\nimport sys\n\ndef run_check():\n    # 示例逻辑\n    print(\"Check executed\")\n\nif __name__ == \"__main__\":\n    run_check()\n```",
  "balanced|R17-JS-SUM|current": "```javascript\nfunction addNumbers(left, right) { return left + right; }\n```",
  "balanced|R17-JS-SUM|scoped": "```javascript\nfunction addNumbers(left, right) { return left + right; }\n```",
  "balanced|R17-TS-ASYNC|current": "```typescript\nasync function loadMessage(message: string): Promise<string> {\n  return message;\n}\n```",
  "balanced|R17-TS-ASYNC|scoped": "```typescript\nasync function loadMessage(message: string): Promise<string> { return message; }\n```",
  "balanced|R17-TS-BOOL|current": "```typescript\nfunction isPositive(value: number): boolean {\n  return value > 0;\n}\n```",
  "balanced|R17-TS-BOOL|scoped": "```typescript\nfunction isPositive(value: number): boolean {\n  return value > 0;\n}\n```"
} as const;

function createFill(testCase: { id: string; instruction: string; source: string }, systemPrompt = GENERAL): { input: ArtifactFillInput; fill: PreparedArtifactFill } {
  const requirements = resolveGenerationRequirements(testCase.instruction, "custom");
  const spec = resolveArtifactSpec(testCase.instruction, requirements, { effect: "edit", operation: "insert" });
  const referenced = isTaskSourceReferenced(testCase.instruction, "edit") || spec.sourceDependent;
  const source = referenced ? testCase.source : "";
  const input: ArtifactFillInput = { instruction: testCase.instruction, spec, requirements, source,
    includeSource: Boolean(source), systemPrompt };
  const fill = prepareArtifactFill(input);
  if (!fill) throw new Error(`${testCase.id}: expected artifact fill`);
  return { input, fill };
}

function expectedR24Scope(language: string, functionName?: string): string {
  const lines = [
    `代码正文范围：只生成原指令要求的 ${language} 代码正文，不输出 Markdown 标题或代码围栏；代码围栏和标题由程序渲染。`,
    "不要把未要求的示例、说明文字或事实加入代码正文。"
  ];
  if (functionName) lines.push(`原指令明确要求定义的函数名（原文证据值）：${JSON.stringify(functionName)}。代码正文必须真实定义该函数；仅导入、调用、引用该名称不算定义。不要据此推断未写明的签名或行为。`);
  return `${GENERAL}\n\n${lines.join("\n")}`;
}

function decodeOutcome(fill: PreparedArtifactFill, raw: string) {
  try { return { ok: true, value: fill.decode(raw) }; }
  catch (error) { return { ok: false, name: (error as Error).name, message: (error as Error).message }; }
}

function scopeForInstruction(instruction: string): string | null {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  if (spec.kind !== "code") return null;
  const sourceDependent = isTaskSourceReferenced(instruction, "edit") || spec.sourceDependent;
  const source = sourceDependent ? "read-only source" : "";
  return buildCodeGenerationScope({ instruction, spec, baseSystemPrompt: GENERAL, systemPrompt: GENERAL,
    source, includeSource: Boolean(source) });
}

describe("managed code system scope", () => {
  it("matches the R24-R2 scope and leaves all 20 captured outputs on the same strict decoder", () => {
    for (const testCase of cases) {
      const { input, fill } = createFill(testCase);
      const sourceBase = buildCodeGenerationScope({ instruction: input.instruction, spec: input.spec,
        baseSystemPrompt: GENERAL, systemPrompt: GENERAL, source: input.source, includeSource: input.includeSource });
      expect(sourceBase, testCase.id).toBeTruthy();
      const expectedFunction = input.spec.kind === "code" ? input.spec.functionName?.value : undefined;
      const expectedScopedFill = prepareArtifactFill({ ...input, systemPrompt: expectedR24Scope(
        testCase.id === "B31-CODE-H2" || testCase.id === "R17-TS-ASYNC" || testCase.id === "R17-TS-BOOL" ? "TypeScript"
          : testCase.id === "B31-CODE-H4" ? "Python" : "JavaScript", expectedFunction) });
      expect(expectedScopedFill, testCase.id).toBeTruthy();

      const request = { source: "managed" as const, modelId: MODEL, prompt: fill.prompt,
        systemPrompt: fill.systemPrompt, maxTokens: fill.maxTokens, outputSchema: fill.outputSchema };
      const result = prepareManagedGenerationRequest(request);
      expect(result.codeScopeApplied, testCase.id).toBe(true);
      expect(result.sectionProjectionApplied, testCase.id).toBe(false);
      expect(result.prompt).toBe(fill.prompt);
      expect(result.systemPrompt).toBe(expectedScopedFill!.systemPrompt);
      expect(result.systemPrompt).toContain("代码正文范围");
      expect(result.budget).toEqual(calculateLocalAiBudget(fill.prompt, expectedScopedFill!.systemPrompt, fill.maxTokens));
      expect(request.prompt).toBe(fill.prompt);
      expect(request.systemPrompt).toBe(fill.systemPrompt);
      if (testCase.id === "B31-CODE-H4") expect(result.systemPrompt).not.toContain("run_check");

      for (const profile of ["light", "balanced"] as const) {
        for (const arm of ["current", "scoped"] as const) {
          const raw = oldRaw[`${profile}|${testCase.id}|${arm}`];
          expect(typeof raw).toBe("string");
          const outcome = decodeOutcome(fill, raw);
          expect(outcome).toEqual(decodeOutcome(expectedScopedFill!, raw));
          const expectedText = oldDecodedText[`${profile}|${testCase.id}|${arm}`];
          if (expectedText === null) expect(outcome).toMatchObject({ ok: false, message: "payload 与已确定的 Markdown 模板不匹配。" });
          else expect(outcome).toMatchObject({ ok: true, value: { text: expectedText } });
        }
      }
    }
    expect(Object.keys(oldRaw)).toHaveLength(20);
  });

  it("uses the exact 1.7B managed model and only a byte-identical General artifact request", () => {
    const { fill } = createFill(cases[0]!);
    const base = { prompt: fill.prompt, systemPrompt: fill.systemPrompt, maxTokens: fill.maxTokens, outputSchema: fill.outputSchema };
    for (const request of [
      { ...base, source: "ollama" as const, modelId: MODEL },
      { ...base, source: "managed" as const, modelId: LIGHT },
      { ...base, source: "managed" as const, modelId: "unknown.gguf" }
    ]) expect(prepareManagedCodeRequest(request)).toBeUndefined();

    const custom = createFill(cases[0]!, "custom role").fill;
    expect(prepareManagedCodeRequest({ ...base, source: "managed", modelId: MODEL,
      prompt: custom.prompt, systemPrompt: custom.systemPrompt, maxTokens: custom.maxTokens,
      outputSchema: custom.outputSchema })).toBeUndefined();

    const forgedSchema = structuredClone(base.outputSchema!);
    (forgedSchema.properties as Record<string, unknown>).payload = { type: "string" };
    expect(prepareManagedCodeRequest({ ...base, source: "managed", modelId: MODEL,
      outputSchema: forgedSchema })).toBeUndefined();
  });

  it("rejects ambiguous markers, stale source-field evidence, and payloads outside the code-fill contract", () => {
    const { fill } = createFill(cases[0]!);
    const request = { source: "managed" as const, modelId: MODEL, prompt: fill.prompt,
      systemPrompt: fill.systemPrompt, maxTokens: fill.maxTokens, outputSchema: fill.outputSchema };
    expect(prepareManagedCodeRequest({ ...request, prompt: `输入数据：{}\n${fill.prompt}` })).toBeUndefined();
    expect(prepareManagedCodeRequest({ ...request, prompt: `${fill.prompt.slice(0, fill.prompt.indexOf(INPUT_MARKER))}${INPUT_MARKER}{` })).toBeUndefined();

    const { input } = createFill(cases[0]!);
    const stale = structuredClone(input.spec) as Extract<ArtifactSpec, { kind: "code" }>;
    (stale.language!.evidence[0] as { from: number; to: number; raw: string }).raw += "!";
    expect(buildCodeGenerationScope({ instruction: input.instruction, spec: stale, baseSystemPrompt: GENERAL,
      systemPrompt: GENERAL })).toBeNull();

    const unsupported = createFill({ id: "unsupported", instruction: "在文末新增 Bash 代码块。", source: "" });
    expect(prepareManagedCodeRequest({ source: "managed", modelId: MODEL, prompt: unsupported.fill.prompt,
      systemPrompt: unsupported.fill.systemPrompt, maxTokens: unsupported.fill.maxTokens,
      outputSchema: unsupported.fill.outputSchema })).toBeUndefined();
  });

  it("keeps R24 quote, Markdown AST, language, function-name, and deterministic-body boundaries", () => {
    for (const instruction of [
      "在文末新增代码块。\n> ~~~text\n> TypeScript 定义 hiddenFn 函数\n> ~~~",
      "在文末新增代码块。\n- 示例\n    ~~~text\n    TypeScript 定义 hiddenFn 函数\n    ~~~",
      "在文末新增代码块。\n> ```text\n> TypeScript 定义 hiddenFn 函数\n> ```",
      "在文末新增代码块。\n- 示例\n    ```text\n    TypeScript 定义 hiddenFn 函数\n    ```",
      "在文末新增代码块。\n\n    TypeScript 定义 hiddenFn 函数",
      "在文末新增 Python 代码块。\n```text\nexample",
      "在文末新增 JavaScript 代码块，定义函数 return。",
      "在文末新增 Bash 代码块。",
      "在文末新增 JSON 代码块，内容为 {\"ok\": true}。",
      "如何使用 Python 代码块？",
      "在文末新增 Markdown 代码块，二级标题“示例”，并添加一段正文内容为“hello”。"
    ]) expect(scopeForInstruction(instruction), instruction).toBeNull();

    for (const instruction of [
      "在文末新增 TypeScript 代码块，不要定义 resetState 函数。",
      "在文末新增 JavaScript 代码块，调用 resetState 函数。"
    ]) {
      const scope = scopeForInstruction(instruction);
      expect(scope, instruction).toBeTruthy();
      expect(scope).not.toContain("resetState");
    }
    const functionInsideFence = "在文末新增 TypeScript 代码块。\n```text\n定义 hiddenFn 函数\n```";
    const languageOnlyScope = scopeForInstruction(functionInsideFence);
    if (languageOnlyScope) expect(languageOnlyScope).not.toContain("hiddenFn");
  });

  it("preserves an explicitly present empty source field and rejects its omission for source-dependent code", () => {
    const ordinary = createFill(cases[0]!);
    const emptySourceFill = prepareArtifactFill({ ...ordinary.input, source: "", includeSource: true })!;
    expect(JSON.parse(emptySourceFill.prompt.split(INPUT_MARKER)[1]!)).toHaveProperty("source", "");
    expect(prepareManagedCodeRequest({ source: "managed", modelId: MODEL,
      prompt: emptySourceFill.prompt, systemPrompt: emptySourceFill.systemPrompt,
      maxTokens: emptySourceFill.maxTokens, outputSchema: emptySourceFill.outputSchema })?.applied).toBe(true);

    const sourceInstruction = "基于当前文档内容，在文末新增 TypeScript 代码块，定义 greetUser 函数。";
    const filled = createFill({ id: "source", instruction: sourceInstruction, source: "" });
    const input = { source: "managed" as const, modelId: MODEL, prompt: filled.fill.prompt,
      systemPrompt: filled.fill.systemPrompt, maxTokens: filled.fill.maxTokens, outputSchema: filled.fill.outputSchema };
    const dataStart = input.prompt.indexOf(INPUT_MARKER) + INPUT_MARKER.length;
    expect(JSON.parse(input.prompt.slice(dataStart))).toEqual({ instruction: sourceInstruction, source: "" });
    expect(prepareManagedCodeRequest(input)?.applied).toBe(true);

    const promptWithoutSource = `${input.prompt.slice(0, dataStart)}${JSON.stringify({ instruction: sourceInstruction })}`;
    expect(prepareManagedCodeRequest({ ...input, prompt: promptWithoutSource })).toBeUndefined();
  });

  it("falls back unchanged when scope would exceed the shared 4096-token budget", () => {
    const testCase = { id: "budget", instruction: "基于当前文档描述，在文末新增 TypeScript 代码块，定义 greetUser 函数。", source: "" };
    let selected: ReturnType<typeof createFill> | undefined;
    for (let size = 0; size < 40_000; size += 128) {
      const candidate = createFill({ ...testCase, source: `内容${"说明".repeat(size)}` });
      try { calculateLocalAiBudget(candidate.fill.prompt, candidate.fill.systemPrompt, candidate.fill.maxTokens); }
      catch { break; }
      const result = prepareManagedCodeRequest({ source: "managed", modelId: MODEL, prompt: candidate.fill.prompt,
        systemPrompt: candidate.fill.systemPrompt, maxTokens: candidate.fill.maxTokens, outputSchema: candidate.fill.outputSchema });
      if (result && !result.applied) { selected = candidate; break; }
    }
    expect(selected).toBeDefined();
    const { fill } = selected!;
    const result = prepareManagedCodeRequest({ source: "managed", modelId: MODEL, prompt: fill.prompt,
      systemPrompt: fill.systemPrompt, maxTokens: fill.maxTokens, outputSchema: fill.outputSchema });
    expect(result?.applied).toBe(false);
    expect(result?.systemPrompt).toBe(fill.systemPrompt);
    expect(result?.budget).toEqual(calculateLocalAiBudget(fill.prompt, fill.systemPrompt, fill.maxTokens));
  });

  it("preserves the existing section projection path without composing a code scope", () => {
    const instruction = "使用 Goal、Steps、Risks、Acceptance Criteria 标题组织技术方案。Steps: Include executable steps.";
    const schema = { type: "object", properties: { payload: { type: "object", properties: { sections: {
      type: "object", properties: Object.fromEntries(["Goal", "Steps", "Risks", "Acceptance Criteria"].map(name => [name, { type: "string", minLength: 1 }])),
      required: ["Goal", "Steps", "Risks", "Acceptance Criteria"], additionalProperties: false
    } }, required: ["sections"], additionalProperties: false } }, required: ["payload"], additionalProperties: false };
    const prompt = `请完成章节内容。\n\n${INPUT_MARKER}${JSON.stringify({ instruction, source: "只读原文" })}`;
    const result = prepareManagedGenerationRequest({ source: "managed", modelId: MODEL, prompt,
      systemPrompt: GENERAL, maxTokens: 1536, outputSchema: schema });
    expect(result.codeScopeApplied).toBe(false);
    expect(result.sectionProjectionApplied).toBe(true);
    expect(result.prompt).not.toBe(prompt);
    expect(result.systemPrompt).toBe(GENERAL);
  });
});
