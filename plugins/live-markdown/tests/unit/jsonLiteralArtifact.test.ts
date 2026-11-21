import { describe, expect, it, vi } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";

function resolveJsonArtifact(instruction: string) {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return { requirements, spec };
}

function request(source: string, instruction: string): AiTaskRequest {
  return {
    action: "custom", source, userPrompt: instruction, provider: "local", baseSystemPrompt: "",
    actionDefinition: { id: "custom", label: "自定义", prompt: instruction, system: "" }
  };
}

describe("literal JSON object fields", () => {
  it("captures a complete standalone JSON array with evidence and renders its original order", () => {
    const instruction = '只在文末输出 JSON 数组 [false, null, "pending", 3]，保持顺序。';
    const { spec } = resolveJsonArtifact(instruction);

    expect(spec).toMatchObject({ kind: "code", language: { value: "json" }, composition: "complete" });
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toEqual([false, null, "pending", 3]);
    expect(spec.jsonBody?.evidence.every(({ from, to, raw }) => instruction.slice(from, to) === raw)).toBe(true);
    expect(renderArtifact(spec)).toBe('```json\n[\n  false,\n  null,\n  "pending",\n  3\n]\n```');
  });

  it("captures nested bounded JSON arrays and leaves later operations unresolved", () => {
    const instruction = '只在文末输出 JSON 数组 [[false, null], {"items": ["pending", 3]}]，保持顺序。';
    const { spec } = resolveJsonArtifact(instruction);
    expect(spec).toMatchObject({ kind: "code", language: { value: "json" }, composition: "complete" });
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toEqual([[false, null], { items: ["pending", 3] }]);
    expect(renderArtifact(spec)).toBe('```json\n[\n  [\n    false,\n    null\n  ],\n  {\n    "items": [\n      "pending",\n      3\n    ]\n  }\n]\n```');

    const withOperation = `${instruction}然后删除标题。`;
    const { spec: operationSpec } = resolveJsonArtifact(withOperation);
    expect(operationSpec.kind).toBe("code");
    if (operationSpec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(operationSpec.jsonBody?.value).toEqual([[false, null], { items: ["pending", 3] }]);
    expect(operationSpec.composition).toBe("partial");
  });

  it("does not compile incomplete JSON arrays or arrays with duplicate nested object keys", () => {
    for (const instruction of [
      '只在文末输出 JSON 数组 [false, null, "pending", 3，保持顺序。',
      '只在文末输出 JSON 数组 [{"x": 1, "x": 2}]。',
      '只在文末输出 JSON 数组 [{"__proto__": 1}]。',
      String.raw`只在文末输出 JSON 数组 [{"x": 1, "\u0078": 2}]。`
    ]) {
      const { spec } = resolveJsonArtifact(instruction);
      expect(spec.kind).toBe("code");
      if (spec.kind !== "code") throw new Error("expected JSON code artifact");
      expect(spec.jsonBody).toBeUndefined();
      expect(spec.composition).toBe("partial");
    }
  });

  it("does not infer missing array values and enforces raw-array bounds", () => {
    const dynamic = "在文末输出 JSON 数组，值根据当前文档生成。";
    const { spec: dynamicSpec } = resolveJsonArtifact(dynamic);
    expect(dynamicSpec.kind).toBe("code");
    if (dynamicSpec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(dynamicSpec.jsonBody).toBeUndefined();
    expect(dynamicSpec.sourceDependent).toBe(true);

    const oversized = `只在文末输出 JSON 数组 [${JSON.stringify("青".repeat(11_000))}]。`;
    const overDepth = `只在文末输出 JSON 数组 ${"[".repeat(34)}1${"]".repeat(34)}。`;
    const overNodes = `只在文末输出 JSON 数组 [${Array.from({ length: 4_100 }, (_value, index) => index).join(",")}]。`;
    for (const instruction of [oversized, overDepth, overNodes]) {
      const { spec: boundedSpec } = resolveJsonArtifact(instruction);
      expect(boundedSpec.kind).toBe("code");
      if (boundedSpec.kind !== "code") throw new Error("expected JSON code artifact");
      expect(boundedSpec.jsonBody).toBeUndefined();
      expect(boundedSpec.issues).toContain("invalid_json_literal");
    }
  });

  it("compiles a fully enumerated object, including a quoted Unicode array, without model filling", () => {
    const instruction = "在文末追加 JSON 对象，仅包含 enabled:false、owner:null 和 tags:[“青”,“蓝”]。";
    const { requirements, spec } = resolveJsonArtifact(instruction);

    expect(spec).toMatchObject({ kind: "code", language: { value: "json" }, composition: "complete" });
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toEqual({ enabled: false, owner: null, tags: ["青", "蓝"] });
    expect(renderArtifact(spec)).toBe(
      '```json\n{\n  "enabled": false,\n  "owner": null,\n  "tags": [\n    "青",\n    "蓝"\n  ]\n}\n```'
    );
    expect(prepareArtifactFill({ instruction, spec, requirements })).toBeNull();
  });

  it("creates one reviewable append proposal through the production entry without inference or mutating source", async () => {
    const instruction = "在文末追加 JSON 对象，仅包含 enabled:false、owner:null 和 tags:[“青”,“蓝”]。";
    const source = "# Notes\n\n原文保持不变。";
    const snapshot: AiDocumentSnapshot = {
      documentId: "literal-json.md", revision: 7, content: source, selection: null, cursor: source.length, readOnly: false
    };
    const invoke = vi.fn(async () => { throw new Error("fully literal JSON must not call the model"); });
    const result = await runPlannedAiTaskCore(request(source, instruction), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} });

    const expectedBlock = '```json\n{\n  "enabled": false,\n  "owner": null,\n  "tags": [\n    "青",\n    "蓝"\n  ]\n}\n```';
    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.mode).toBe("append");
    expect(result.proposal?.patch).toMatchObject({ from: source.length, to: source.length, insertText: `\n\n${expectedBlock}` });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${source}\n\n${expectedBlock}`);
    expect(snapshot.content).toBe(source);
  });

  it("keeps dynamic or source-derived values on the model path instead of inventing literals", async () => {
    const instruction = "在文末新增 JSON 对象，仅包含 enabled 和 owner 两个字段，值从当前文档提取。";
    const { requirements, spec } = resolveJsonArtifact(instruction);

    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody).toBeUndefined();
    expect(prepareArtifactFill({ instruction, spec, requirements, source: "enabled=true; owner=李明" })).not.toBeNull();

    const impliedValue = "在文末输出 JSON 对象，仅包含 owner 为 当前文档负责人 一个字段。";
    const { spec: impliedSpec } = resolveJsonArtifact(impliedValue);
    expect(impliedSpec.kind).toBe("code");
    if (impliedSpec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(impliedSpec.jsonBody).toBeUndefined();

    const sourceDependent = "根据当前文档数据，在文末输出 JSON 对象，仅包含 enabled:false、owner:null 和 tags:[“青”,“蓝”]。";
    const { spec: sourceSpec } = resolveJsonArtifact(sourceDependent);
    expect(sourceSpec.kind).toBe("code");
    if (sourceSpec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(sourceSpec.sourceDependent).toBe(true);
    expect(sourceSpec.composition).toBe("partial");

    for (const value of ["自动生成", "自行拟定", "根据原文推导", "currentDate", "auto-generated"]) {
      const dynamicInstruction = `在文末输出 JSON 对象，仅包含 taskName:${value} 一个字段。`;
      const { spec: dynamicSpec } = resolveJsonArtifact(dynamicInstruction);
      expect(dynamicSpec.kind).toBe("code");
      if (dynamicSpec.kind !== "code") throw new Error("expected JSON code artifact");
      expect(dynamicSpec.jsonBody).toBeUndefined();
    }

    const source = "负责人：李明";
    const sourceInstruction = "根据当前文档数据，在文末输出 JSON 对象，仅包含 owner:当前文档负责人 一个字段。";
    const snapshot: AiDocumentSnapshot = {
      documentId: "source-json.md", revision: 2, content: source, selection: null, cursor: source.length, readOnly: false
    };
    const sourceInvoke = vi.fn(async (_prompt: string) => "{}");
    await expect(runPlannedAiTaskCore(request(source, sourceInstruction), snapshot,
      { invoke: sourceInvoke, isCurrent: () => true, abortCurrent() {} })).rejects.toThrow();
    expect(sourceInvoke).toHaveBeenCalled();
    expect(sourceInvoke.mock.calls.some(([prompt]) => prompt.includes(source))).toBe(true);

    const dynamicSource = "原文保持不变。";
    const dynamicInstruction = "在文末追加 JSON 对象，仅包含 taskName:自行拟定 一个字段。";
    const dynamicSnapshot: AiDocumentSnapshot = {
      documentId: "dynamic-json.md", revision: 1, content: dynamicSource, selection: null,
      cursor: dynamicSource.length, readOnly: false
    };
    const dynamicInvoke = vi.fn(async () => "{}");
    await expect(runPlannedAiTaskCore(request(dynamicSource, dynamicInstruction), dynamicSnapshot,
      { invoke: dynamicInvoke, isCurrent: () => true, abortCurrent() {} })).rejects.toThrow();
    expect(dynamicInvoke).toHaveBeenCalled();
  });

  it("does not treat a later contradictory instruction as part of the fixed object", async () => {
    const instruction = "在文末输出 JSON 对象，仅包含 enabled:false。随后改为 enabled:true。";
    const { spec } = resolveJsonArtifact(instruction);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toMatchObject({ enabled: false });
    expect(spec.composition).toBe("partial");

    const source = "原文。";
    const snapshot: AiDocumentSnapshot = {
      documentId: "conflicting-json.md", revision: 1, content: source, selection: null, cursor: source.length, readOnly: false
    };
    const invoke = vi.fn(async () => "{}");
    await expect(runPlannedAiTaskCore(request(source, instruction), snapshot,
      { invoke, isCurrent: () => true, abortCurrent() {} })).rejects.toThrow();
    expect(invoke).toHaveBeenCalled();
  });

  it("accepts an explicitly closed field list terminated by a semicolon", () => {
    const instruction = "在文末输出 JSON 对象，仅包含 enabled:false 和 owner:null 两个字段；";
    const { requirements, spec } = resolveJsonArtifact(instruction);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody?.value).toMatchObject({ enabled: false, owner: null });
    expect(prepareArtifactFill({ instruction, spec, requirements })).toBeNull();
  });

  it("compiles bounded nested objects, arrays, negative numbers, and preserves exact evidence", () => {
    const instruction = "在文末输出 JSON 对象，仅包含 config:{enabled:false,tags:[“青”,“蓝”]} 和 threshold:-1.25e2 两个字段。";
    const { requirements, spec } = resolveJsonArtifact(instruction);

    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(JSON.parse(JSON.stringify(spec.jsonBody?.value))).toEqual({
      config: { enabled: false, tags: ["青", "蓝"] }, threshold: -125
    });
    expect(spec.jsonBody?.evidence.every(({ from, to, raw }) => instruction.slice(from, to) === raw)).toBe(true);
    expect(spec.composition).toBe("complete");
    expect(renderArtifact(spec)).toContain('"threshold": -125');
    expect(prepareArtifactFill({ instruction, spec, requirements })).toBeNull();
  });

  it("keeps operation-like words inside a quoted field as data and detects a later operation", () => {
    const literal = "在文末输出 JSON 对象，仅包含 note:“在文末追加 Hello，然后删除旧标题” 一个字段。";
    const { spec: literalSpec } = resolveJsonArtifact(literal);
    expect(literalSpec.kind).toBe("code");
    if (literalSpec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(literalSpec.jsonBody?.value).toMatchObject({ note: "在文末追加 Hello，然后删除旧标题" });
    expect(literalSpec.composition).toBe("complete");

    const extraOperation = `${literal}然后删除旧标题。`;
    const { spec: extraSpec } = resolveJsonArtifact(extraOperation);
    expect(extraSpec.kind).toBe("code");
    if (extraSpec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(extraSpec.jsonBody?.value).toMatchObject({ note: "在文末追加 Hello，然后删除旧标题" });
    expect(extraSpec.composition).toBe("partial");
  });

  it("rejects malformed lists, mismatched counts, duplicate nested keys, and unsafe nested keys", () => {
    for (const instruction of [
      "在文末输出 JSON 对象，仅包含 tags:[“青”,]。",
      "在文末输出 JSON 对象，仅包含 enabled:false 两个字段。",
      "在文末输出 JSON 对象，仅包含 config:{enabled:true,enabled:false} 一个字段。",
      "在文末输出 JSON 对象，仅包含 config:{constructor:“危险”} 一个字段。",
      "在文末输出 JSON 对象，仅包含 __proto__:1 一个字段。",
      String.raw`在文末输出 JSON 对象，仅包含 "enabled":false 和 "\u0065nabled":true 两个字段。`,
      String.raw`在文末输出 JSON 对象，仅包含 config:{"\u005f_proto__":1} 一个字段。`
    ]) {
      const { spec } = resolveJsonArtifact(instruction);
      expect(spec.kind).toBe("code");
      if (spec.kind !== "code") throw new Error("expected JSON code artifact");
      expect(spec.jsonBody).toBeUndefined();
    }
  });

  it("enforces source-byte, nesting-depth, and value-node bounds", () => {
    const overDepth = `在文末输出 JSON 对象，仅包含 nested:${"[".repeat(34)}1${"]".repeat(34)} 一个字段。`;
    const overNodes = `在文末输出 JSON 对象，仅包含 values:[${Array.from({ length: 4_100 }, (_value, index) => index).join(",")}] 一个字段。`;
    const overBytes = `在文末输出 JSON 对象，仅包含 message:“${"青".repeat(11_000)}” 一个字段。`;

    for (const instruction of [overDepth, overNodes, overBytes]) {
      const { spec } = resolveJsonArtifact(instruction);
      expect(spec.kind).toBe("code");
      if (spec.kind !== "code") throw new Error("expected JSON code artifact");
      expect(spec.jsonBody).toBeUndefined();
    }
  });

  it("applies the same JSON limits to an explicit raw JSON literal", () => {
    const oversized = `在文末新增 JSON 代码块，内容为 ${JSON.stringify({ message: "青".repeat(11_000) })}。`;
    const { spec } = resolveJsonArtifact(oversized);
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") throw new Error("expected JSON code artifact");
    expect(spec.jsonBody).toBeUndefined();
    expect(spec.issues).toContain("invalid_json_literal");
  });
});
