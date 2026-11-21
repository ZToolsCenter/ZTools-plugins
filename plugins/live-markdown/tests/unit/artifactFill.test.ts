import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import { renderArtifactPayload } from "../../src/core/ai/artifactPayloadRenderer";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import type { IntentTask } from "../../src/core/ai/intentTypes";

const { validateOutputSchema } = createRequire(import.meta.url)("../../preload/local-ai/output-constraint.cjs") as {
  validateOutputSchema(schema: unknown): void;
};

function prepare(instruction: string, source = "原文保持不变。") {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return prepareArtifactFill({ instruction, spec, requirements, source });
}

describe("artifact fill preparation", () => {
  it("emits payload schemas accepted by the local model output constraint", () => {
    const cases: Array<[string, IntentTask, string?]> = [
      ["在文末生成 Python 函数 add(a, b)。", "custom"],
      ["在文末生成 JSON 代码块，描述一个任务配置。", "custom"],
      ["在文末写一份 rollout 草案，按顺序用小标题 Goal、Steps、Risks 组织；不指定标题级别。", "tech-spec"],
      ["加一个 Markdown 表格，列名为名称、状态。", "custom"],
      ["根据原文把水果和每斤价格转成两列表格，列名必须为水果、价格。", "custom", "Apples cost 3 yuan per jin; bananas cost 5 yuan per jin."],
      ["在文末输出一个显示数学公式，推导勾股关系。", "custom"],
      ["在文末放入 Mermaid 流程图，节点 A、B。", "custom"]
    ];
    for (const [instruction, task, source] of cases) {
      const requirements = resolveGenerationRequirements(instruction, task);
      const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
      const prepared = prepareArtifactFill({ instruction, spec, requirements, ...(source ? { source } : {}) });
      expect(prepared, instruction).not.toBeNull();
      expect(() => validateOutputSchema(prepared!.outputSchema), instruction).not.toThrow();
    }
  });

  it("fills only Python source and lets the renderer add a grounded H2 and safe fence", () => {
    const instruction = "在文末生成 Python 函数 add(a, b)，标题必须是二级标题“计算函数”。";
    const prepared = prepare(instruction);

    expect(prepared).not.toBeNull();
    expect(prepared!.outputSchema).toMatchObject({
      type: "object",
      properties: { payload: { type: "string" } },
      required: ["payload"],
      additionalProperties: false
    });
    const body = 'def add(a, b):\n    return a + b\nmessage = "```"';
    expect(prepared!.decode(JSON.stringify({ payload: body }))).toEqual({
      text: '## 计算函数\n\n````python\n' + body + '\n````',
      warnings: [expect.stringContaining("已检查指定函数标识和代码围栏")]
    });
  });

  it("uses the code payload contract and states language and function requirements separately", () => {
    const instruction = "在文末生成 TypeScript 函数 add(a, b)。";
    const prepared = prepare(instruction);
    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).not.toContain("<raw code body>");
    expect(prepared!.prompt).toContain("返回仅含 payload 键的 JSON 对象");
    expect(prepared!.prompt).toContain("payload 的值为按用户要求生成的实际代码字符串");
    expect(prepared!.prompt).toContain('目标语言标签为 "typescript"');
    expect(prepared!.prompt).toContain('按用户要求定义函数 "add"');
    expect(prepared!.prompt).not.toContain("def add");
  });

  it("prompts every grounded function name without requiring a parameter signature", () => {
    const instruction = "在文末新增 TypeScript 代码块，定义函数 transformRecord。";
    const prepared = prepare(instruction);

    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).toContain('按用户要求定义函数 "transformRecord"');

    const assignment = prepare("新增 Python 代码块，定义 run_check = True。");
    expect(assignment).not.toBeNull();
    expect(assignment!.prompt).not.toContain("按用户要求定义函数");

    const bareName = prepare("新增 TypeScript 代码块，定义foo。");
    expect(bareName).not.toBeNull();
    expect(bareName!.prompt).not.toContain("按用户要求定义函数");
  });

  it("rejects missing content, extra fields, and wrong-language fences", () => {
    const prepared = prepare("在文末生成 Python 函数 add(a, b)。");
    expect(prepared).not.toBeNull();
    expect(() => prepared!.decode(JSON.stringify({}))).toThrow();
    expect(() => prepared!.decode(JSON.stringify({ payload: "def add(a,b): return a+b", extra: true }))).toThrow();
    expect(() => prepared!.decode(JSON.stringify({ payload: "```javascript\nfunction add(a,b) { return a+b; }\n```" }))).toThrow();
    expect(() => prepared!.decode(JSON.stringify({ payload: "~~~javascript\nfunction add(a,b) { return a+b; }\n~~~" }))).toThrow();
  });

  it("unwraps exactly one matching language fence, rewraps it, and reports the normalization", () => {
    const instruction = "在文末生成 Python 函数 add(a, b)，标题必须是二级标题“计算函数”。";
    const prepared = prepare(instruction);
    expect(prepared).not.toBeNull();
    const code = "```python\n# 计算函数\ndef add(a, b):\n    return a + b\n```";
    const result = prepared!.decode(JSON.stringify({ payload: code }));
    expect(result.text).toBe("## 计算函数\n\n```python\n# 计算函数\ndef add(a, b):\n    return a + b\n```");
    expect(result.warnings.join(" ")).toContain("匹配外层 python 围栏已移除");
  });

  it("does not rename wrong-language or incomplete external code fences", () => {
    const prepared = prepare("在文末生成 Python 函数 add(a, b)。");
    expect(prepared).not.toBeNull();
    for (const payload of [
      "```javascript\nfunction add(a,b) { return a+b; }\n```",
      "```python\ndef add(a,b): return a+b\n```\nextra"
    ]) {
      expect(() => prepared!.decode(JSON.stringify({ payload }))).toThrow();
    }
  });

  it("renders an explicit JSON field map as data with the exact inferred JSON types", () => {
    const instruction = "在文末输出 JSON 对象，仅含 name 为 Orion 和 active 为 true 两个字段。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });

    expect(spec).toMatchObject({ kind: "code", language: { value: "json" }, composition: "complete" });
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toEqual({ name: "Orion", active: true });
    expect(spec.jsonBody && spec.jsonBody.evidence.every(evidence => instruction.slice(evidence.from, evidence.to) === evidence.raw)).toBe(true);
    expect(renderArtifact(spec)).toBe('```json\n{\n  "name": "Orion",\n  "active": true\n}\n```');
    expect(prepareArtifactFill({ instruction, spec, requirements })).toBeNull();
  });

  it("supports equivalent field-list wording and keeps ambiguous or incomplete JSON fields unresolved", () => {
    const valid = "文末新增 JSON 对象，只包含 name=“Orion” 和 active=true 两个字段。";
    const requirements = resolveGenerationRequirements(valid, "custom");
    const spec = resolveArtifactSpec(valid, requirements, { effect: "edit", operation: "insert" });
    expect(spec).toMatchObject({ kind: "code", composition: "complete" });
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toEqual({ name: "Orion", active: true });

    for (const instruction of [
      "在文末输出 JSON 对象，仅含 name 为 Orion 和 name 为 Nova 两个字段。",
      "在文末输出 JSON 对象，仅含 name 为 Orion 和 active 两个字段。"
    ]) {
      const req = resolveGenerationRequirements(instruction, "custom");
      const parsed = resolveArtifactSpec(instruction, req, { effect: "edit", operation: "insert" });
      expect(parsed.kind === "code" && parsed.jsonBody).toBeFalsy();
      expect(prepareArtifactFill({ instruction, spec: parsed, requirements: req })).not.toBeNull();
    }
  });

  it("captures typed JSON primitive values by role and leaves unclosed key sets unresolved", () => {
    const instruction = "在文末输出 JSON 对象，只包含 id 为 17、enabled 为 false 和 note 为‘有 空格’三个字段。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    expect(spec).toMatchObject({ kind: "code", composition: "complete" });
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toEqual({ id: 17, enabled: false, note: "有 空格" });
    expect(spec.jsonBody && spec.jsonBody.evidence.every(evidence => instruction.slice(evidence.from, evidence.to) === evidence.raw)).toBe(true);

    const open = "在文末输出 JSON 对象，name 为 Orion，active 为 true。";
    const openRequirements = resolveGenerationRequirements(open, "custom");
    const openSpec = resolveArtifactSpec(open, openRequirements, { effect: "edit", operation: "insert" });
    expect(openSpec.kind === "code" && openSpec.jsonBody).toBeFalsy();
    expect(prepareArtifactFill({ instruction: open, spec: openSpec, requirements: openRequirements })).not.toBeNull();
  });

  it("renders required OPEN01 section names in order while the model fills only section bodies", () => {
    const instruction = "在文末写一份 rollout 草案，按顺序用小标题 Goal、Steps、Risks 组织；不指定标题级别。";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });

    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Goal", "Steps", "Risks"]);
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: { sections: {
      Risks: "Review access controls.", Goal: "Ship the rollout.", Steps: "Deploy, observe, and verify."
    } } }))).toMatchObject({
      text: "## Goal\n\nShip the rollout.\n\n## Steps\n\nDeploy, observe, and verify.\n\n## Risks\n\nReview access controls."
    });
    expect(() => prepared!.decode(JSON.stringify({ payload: { sections: {
      Goal: "Goal", Steps: "Steps", Risks: "Risks", Extra: "not allowed"
    } } }))).toThrow();
  });

  it("rejects undeclared headings inside generated sections but keeps ordinary Markdown and fenced examples", () => {
    const instruction = "在文末写一份 rollout 草案，按顺序用小标题 Goal、Steps、Risks 组织；不指定标题级别。";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(prepared).not.toBeNull();
    const generated = (goal: string) => JSON.stringify({ payload: { sections: { Goal: goal, Steps: "Deploy.", Risks: "Review." } } });
    expect(() => prepared!.decode(generated("## Extra\nUnexpected section."))).toThrow();
    expect(prepared!.decode(generated("**Ready**\n\n- Check\n\n```md\n# Example inside fence\n```"))).toMatchObject({
      text: expect.stringContaining("```md\n# Example inside fence\n```")
    });
  });

  it("rejects undeclared headings after a fixed title without rejecting fenced code headings", () => {
    const instruction = "在文末新增 Markdown H2 标题“状态”，并在标题后写一句“准备发布”。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(prepared).not.toBeNull();
    expect(() => prepared!.decode(JSON.stringify({ payload: "## Extra\nUnexpected section." }))).toThrow();
    expect(prepared!.decode(JSON.stringify({ payload: "```md\n## Code example\n```" }))).toMatchObject({
      text: expect.stringContaining("```md\n## Code example\n```")
    });
  });

  it("accepts role-based heading-list variants and ignores quoted heading discussions", () => {
    const variant = "请在文末用章节标题：Plan、Build、Review 按顺序组织 rollout 草案。";
    const requirements = resolveGenerationRequirements(variant, "tech-spec");
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Plan", "Build", "Review"]);
    expect(requirements.requiredHeadings.every(({ evidence }) => evidence.every(({ from, to, raw }) => variant.slice(from, to) === raw))).toBe(true);

    const discussion = "解释“Goal、Steps、Risks”这些小标题的含义。";
    expect(resolveGenerationRequirements(discussion, "custom").requiredHeadings).toEqual([]);
  });

  it("keeps a requested heading outside the generated one-sentence body", () => {
    const instruction = "在文末新增 Markdown H2 标题“状态”，并在标题后写一句“准备发布”。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });

    expect(spec).toMatchObject({ kind: "heading", heading: { level: { value: 2 }, text: { value: "状态" } }, composition: "partial" });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: "准备发布" }))).toMatchObject({ text: "## 状态\n\n准备发布" });
  });

  it("allows complete inner code fences in Markdown bodies and chooses a safe outer fence", () => {
    const instruction = "在文末新增代码块 Markdown 格式，展示一个完整 fenced example。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(spec).toMatchObject({ kind: "code", language: { value: "markdown" } });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: "```js\nconst total = 1;\n```" })).text)
      .toBe("````markdown\n```js\nconst total = 1;\n```\n````");
  });

  it("fills non-fixed JSON as bounded data and serializes it with the grounded JSON language", () => {
    const instruction = "在文末生成 JSON 代码块，描述一个任务配置。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    const json = JSON.stringify({ name: "Orion", flags: [true, null, 17], nested: { ok: true } });

    expect(spec).toMatchObject({ kind: "code", language: { value: "json" }, jsonBody: undefined });
    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).not.toContain('ok');
    const output = prepared!.decode(JSON.stringify({ payload: json }));
    expect(output.text).toBe(`\`\`\`json\n${JSON.stringify(JSON.parse(json), null, 2)}\n\`\`\``);
    expect(output.warnings.join(" ")).toContain("JSON 结构由程序序列化");
    expect(spec.kind === "code" && spec.jsonBody).toBeUndefined();
  });

  it("rejects invalid and oversized JSON data by bytes, nesting depth, and node count", () => {
    const instruction = "在文末生成 JSON 代码块，描述一个任务配置。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(prepared).not.toBeNull();

    for (const json of [
      "not json",
      JSON.stringify("界".repeat(11_000)),
      JSON.stringify(Array.from({ length: 4_100 }, (_value, index) => index)),
      JSON.stringify(Array.from({ length: 40 }, (_value, index) => index).reduceRight<unknown>((inner, _value) => [inner], 0))
    ]) {
      expect(() => prepared!.decode(JSON.stringify({ payload: json }))).toThrow();
    }
  });

  it("escapes special characters in fixed section headings instead of rejecting them", () => {
    const instruction = "在文末写一份 rollout 草案，按顺序用小标题 A 组织。";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const title = "Build #1 <stable> `core`";
    const richRequirements = { ...requirements, requiredHeadings: [{ text: title, evidence: [] }] };
    expect(renderArtifactPayload(spec, richRequirements, { kind: "sections", bodies: { [title]: "Ready." } }))
      .toBe("## Build \\#1 \\<stable\\> \\`core\\`\n\nReady.");
  });

  it("renders explicit user rows and escapes special table cell characters", () => {
    const instruction = "在文末加一个 Markdown 表格，列名为名称、备注。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(spec).toMatchObject({ kind: "table", sourceDependent: false });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: { rows: [["A & B", "x|y\r\nz"]] } }))).toMatchObject({
      text: "| 名称 | 备注 |\n| --- | --- |\n| A &amp; B | x\\|y<br>z |"
    });
  });

  it("uses fixed table columns while filling only the row matrix", () => {
    const instruction = "加一个可以有标题的 Markdown 表格，列名为水果、价格；数据必须符合苹果 3 元/斤、香蕉 5 元/斤。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });

    expect(spec).toMatchObject({ kind: "table", columns: [{ value: "水果" }, { value: "价格" }] });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: { rows: [["苹果", "3 元/斤"], ["香蕉", "5 元/斤"]] } }))).toMatchObject({
      text: "| 水果 | 价格 |\n| --- | --- |\n| 苹果 | 3 元/斤 |\n| 香蕉 | 5 元/斤 |"
    });
  });

  it("builds a source-backed table from row selections and escapes cell punctuation", () => {
    const instruction = "根据原文把水果和每斤价格转成两列表格，列名必须为水果、价格；不要增加第三种水果。";
    const source = "Apples cost 3 yuan per jin; bananas cost 5 yuan per jin.";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, source, spec, requirements });

    expect(spec).toMatchObject({ kind: "table", sourceDependent: true });
    expect(prepared).not.toBeNull();
    const sourceIdSchema = (prepared!.outputSchema as any).properties.payload.properties.rows.items.properties.sourceId;
    expect(sourceIdSchema.enum).toEqual(["row-0", "row-1"]);
    expect(prepared!.prompt).toContain('"sourceId":"row-0","quote":"Apples cost 3 yuan per jin"');
    expect(prepared!.decode(JSON.stringify({ payload: { rows: [
      { sourceId: "row-0", cells: ["Apples", "3 yuan per jin"] },
      { sourceId: "row-1", cells: ["bananas", "5 yuan per jin"] }
    ] } }))).toMatchObject({ text: "| 水果 | 价格 |\n| --- | --- |\n| Apples | 3 yuan per jin |\n| bananas | 5 yuan per jin |" });
    expect(() => prepared!.decode(JSON.stringify({ payload: { rows: [
      { sourceId: "row-0", cells: ["Bananas", "3 yuan per jin"] }
    ] } }))).toThrow();
  });

  it("keeps source table filling but leaves a requested post-table summary to free generation", () => {
    const source = "Apples cost 3 yuan per jin; bananas cost 5 yuan per jin.";
    const tableOnly = "根据原文把水果和每斤价格转成两列表格，列名必须为水果、价格。";
    const tableRequirements = resolveGenerationRequirements(tableOnly, "custom");
    const tableSpec = resolveArtifactSpec(tableOnly, tableRequirements, { effect: "edit", operation: "insert" });
    expect(tableSpec).toMatchObject({ kind: "table", composition: "partial", sourceDependent: true });
    expect(prepareArtifactFill({ instruction: tableOnly, source, spec: tableSpec, requirements: tableRequirements })).not.toBeNull();

    const withSummary = "根据原文把水果和每斤价格转成两列表格，列名必须为水果、价格，并在表格后写一句总价总结。";
    const requirements = resolveGenerationRequirements(withSummary, "custom");
    const spec = resolveArtifactSpec(withSummary, requirements, { effect: "edit", operation: "insert" });
    expect(spec).toMatchObject({ kind: "table", composition: "partial", sourceDependent: true });
    expect(prepareArtifactFill({ instruction: withSummary, source, spec, requirements })).toBeNull();
  });

  it("keeps explicit formulas on the zero-call renderer path", () => {
    const instruction = "在文末用显示公式明确写出 a^2 + b^2 = c^2。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    expect(spec).toMatchObject({ kind: "math", composition: "complete", display: true, equation: { value: "a^2 + b^2 = c^2" } });
    expect(renderArtifact(spec)).toBe("$$\na^2 + b^2 = c^2\n$$");
    expect(prepareArtifactFill({ instruction, spec, requirements })).toBeNull();
  });

  it("extracts a directly given formula but does not invent display mode", () => {
    const instruction = "在文末给出公式 x^2 + y^2 = z^2。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    expect(spec).toMatchObject({ kind: "math", composition: "complete", display: false, equation: { value: "x^2 + y^2 = z^2" } });
    expect(renderArtifact(spec)).toBe("$x^2 + y^2 = z^2$");
  });

  it("lets the program add display delimiters around a generated formula payload", () => {
    const instruction = "在文末输出一个显示数学公式，推导勾股关系。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(spec).toMatchObject({ kind: "math", display: true, composition: "partial" });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: "a^2 + b^2 = c^2" }))).toMatchObject({
      text: "$$\na^2 + b^2 = c^2\n$$"
    });
  });

  it("fills Mermaid graph data while the program holds direction, identifiers, and fences", () => {
    const instruction = "在文末放入 Mermaid graph TD，节点开始、审核、结束，边是开始到审核再到结束。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });

    expect(spec).toMatchObject({ kind: "mermaid", direction: { value: "TD" }, composition: "partial" });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: {
      nodes: ["开始", "审核", "结束"], edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }]
    } }))).toMatchObject({ text: "```mermaid\ngraph TD\n  Node1[\"开始\"]\n  Node2[\"审核\"]\n  Node3[\"结束\"]\n  Node1 --> Node2\n  Node2 --> Node3\n```" });
    expect(() => prepared!.decode(JSON.stringify({ payload: {
      nodes: ["开始", "审核"], edges: [{ from: 0, to: 2 }]
    } }))).toThrow();
  });

  it("uses TD only as a display default when no Mermaid direction was specified", () => {
    const instruction = "在文末放入 Mermaid 流程图，节点 A、B。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const prepared = prepareArtifactFill({ instruction, spec, requirements });
    expect(spec).toMatchObject({ kind: "mermaid", direction: undefined });
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: { nodes: ["A", "B"], edges: [{ from: 0, to: 1 }] } }))).toMatchObject({
      text: "```mermaid\ngraph TD\n  Node1[\"A\"]\n  Node2[\"B\"]\n  Node1 --> Node2\n```",
      warnings: ["未指定方向；TD 只作为默认显示布局，节点关系语义仍需复核。"]
    });
  });

  it("does not intercept explicit Markdown source display or specs with unresolved fields", () => {
    const instruction = "以 Markdown 源码格式输出一个 Python 代码块。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    expect(prepareArtifactFill({ instruction, spec, requirements })).toBeNull();

    const unknownInstruction = "在文末生成代码。";
    const unknownRequirements = resolveGenerationRequirements(unknownInstruction, "custom");
    const unknownSpec = resolveArtifactSpec(unknownInstruction, unknownRequirements, { effect: "edit", operation: "insert" });
    expect(prepareArtifactFill({ instruction: unknownInstruction, spec: unknownSpec, requirements: unknownRequirements })).toBeNull();
  });
});
