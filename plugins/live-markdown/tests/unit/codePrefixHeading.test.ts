import { describe, expect, it } from "vitest";
import type { ArtifactField, ArtifactHeading, ArtifactSpec } from "../../src/core/ai/artifactSpec";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import { validateArtifactCandidate } from "../../src/core/ai/artifactValidation";
import { createExecutionPlan } from "../../src/core/ai/executionPlan";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { TaskCandidateFailure, readTaskCandidateDraft, type TaskCandidateDraft } from "../../src/core/ai/taskCandidateFailure";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const instruction = "在文末生成 Python 函数 add(a, b)，标题必须是二级标题“计算函数”。";
const source = "# 原文\n\n保留此段。";
type CodeSpec = Extract<ArtifactSpec, { kind: "code" }> & { prefixHeading?: ArtifactHeading };

function resolve(text: string): ArtifactSpec {
  return resolveArtifactSpec(text, resolveGenerationRequirements(text), { effect: "edit", operation: "insert" });
}

function snapshot(content = source): AiDocumentSnapshot {
  return { documentId: "prefix-heading.md", revision: 4, content, selection: null, cursor: null, readOnly: false };
}

function request(text: string, content = source): AiTaskRequest {
  return { action: "custom", source: content, userPrompt: text, baseSystemPrompt: "", actionDefinition: {
    id: "custom", label: "custom", prompt: text, system: ""
  } };
}

async function runBody(text: string, body: string) {
  let calls = 0;
  const document = snapshot();
  const result = await runPlannedAiTaskCore(request(text), document, {
    invoke: async () => { calls += 1; return JSON.stringify({ payload: body }); }, isCurrent: () => true, abortCurrent() {}
  } satisfies AiTaskRunnerOptions);
  return { calls, result };
}

function field<T>(value: T, raw: string): ArtifactField<T> {
  return { value, evidence: [{ from: 0, to: raw.length, raw }] };
}

function plannedDraft(text: string): TaskCandidateDraft {
  const document = snapshot();
  const contract = deriveInstructionContract(text, { hasSelection: false, hasCursor: false });
  const candidates = buildAiIntentCandidates(text, document.content, contract);
  const intent: ValidatedIntent = {
    version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
    content: { mode: "generate", task: "custom" }
  };
  const bound = bindAiIntent(intent, document, text, candidates, contract);
  const plan = createExecutionPlan(request(text), document, bound, text, "program");
  if (intent.kind !== "edit" || plan.kind !== "edit") throw new Error("Expected an edit plan.");
  return { text: "```python\ndef add(a, b):\n    return a + b\n```", plan, intent, conservative: false };
}

describe("Python code artifacts with an external Markdown heading", () => {
  it("parses the requested heading into a grounded prefix field, separate from the Python body", () => {
    const spec = resolve(instruction);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    const code = spec as CodeSpec;
    expect(code.language?.value).toBe("python");
    expect(code.functionName?.value).toBe("add");
    expect(code.prefixHeading?.level?.value).toBe(2);
    expect(code.prefixHeading?.text?.value).toBe("计算函数");
    expect(code.heading).toBeUndefined();
    expect(code.literalBody).toBeUndefined();
    for (const item of [code.prefixHeading?.level, code.prefixHeading?.text]) {
      expect(item).toBeDefined();
      expect(instruction.slice(item!.evidence[0].from, item!.evidence[0].to)).toBe(item!.evidence[0].raw);
    }
  });

  it("renders a compilable external heading before the fenced Python code", () => {
    const spec = {
      kind: "code", language: field("python", "Python"),
      prefixHeading: { level: field(2, "二级标题"), text: field("计算函数", "计算函数") },
      literalBody: field("def add(a, b):\n    return a + b", "def add(a, b):\n    return a + b"),
      displaySource: false, sourceDependent: false, composition: "complete", issues: []
    } as unknown as ArtifactSpec;
    expect(renderArtifact(spec)).toBe("## 计算函数\n\n```python\ndef add(a, b):\n    return a + b\n```");
  });

  it("renders the required external heading around a raw generated code body", async () => {
    const { calls, result } = await runBody(instruction, "def add(a, b):\n    return a + b");
    expect(calls).toBe(1);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.patch?.insertText).toContain("## 计算函数");
    expect(result.proposal?.patch?.insertText).toContain("```python\ndef add(a, b):");
  });

  it("accepts the exact requested external heading and code block", () => {
    expect(() => validateArtifactCandidate(resolve(instruction), "## 计算函数\n\n```python\ndef add(a, b):\n    return a + b\n```" )).not.toThrow();
  });

  it("detects when the required external heading appears after the first matching Python fence", () => {
    const text = "```python\ndef add(a, b):\n    return a + b\n```\n\n## 计算函数";
    expect(() => validateArtifactCandidate(resolve(instruction), text)).toThrow(/prefix_heading_position_mismatch/u);
  });

  it("allows another language fence before the heading when the heading precedes the first Python fence", () => {
    const text = "```javascript\nconst value = 1;\n```\n\n## 计算函数\n\n```python\ndef add(a, b):\n    return a + b\n```";
    expect(() => validateArtifactCandidate(resolve(instruction), text)).not.toThrow();
  });

  it.each([
    ["# 计算函数\n\n```python\ndef add(a, b):\n    return a + b\n```", "heading_level_mismatch"],
    ["## 计算器\n\n```python\ndef add(a, b):\n    return a + b\n```", "heading_text_mismatch"]
  ])("detects an explicit external heading mismatch", (text, code) => {
    expect(() => validateArtifactCandidate(resolve(instruction), text)).toThrow(new RegExp(code, "u"));
  });

  it("does not invent a prefix heading for an ordinary Python function request", () => {
    const spec = resolve("在文末新增 Python 函数 add(a, b)，返回 a + b。");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect((spec as CodeSpec).prefixHeading).toBeUndefined();
  });

  it("keeps a Markdown heading inside a Markdown code block as an internal heading", () => {
    const spec = resolve("在文末新增 Markdown 代码块，包含二级标题“状态”。");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language?.value).toBe("markdown");
    expect(spec.heading?.level?.value).toBe(2);
    expect(spec.heading?.text?.value).toBe("状态");
    expect((spec as CodeSpec).prefixHeading).toBeUndefined();
    expect(() => validateArtifactCandidate(spec, "```markdown\n## 状态\n```\n")).not.toThrow();
  });

  it("preserves the prefix heading field through a bounded failed-candidate round trip", () => {
    const draft = plannedDraft(instruction);
    const failure = new TaskCandidateFailure("需要检查候选标题。", draft, "missing_heading");
    const roundTrip = readTaskCandidateDraft(failure);
    expect(roundTrip).toBeDefined();
    expect(roundTrip?.plan.artifact.kind).toBe("code");
    if (roundTrip?.plan.artifact.kind === "code") {
      expect((roundTrip.plan.artifact as CodeSpec).prefixHeading?.level?.value).toBe(2);
      expect((roundTrip.plan.artifact as CodeSpec).prefixHeading?.text?.value).toBe("计算函数");
    }
  });
});
