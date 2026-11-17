import { describe, expect, it } from "vitest";
import type { BoundIntent } from "../../src/core/ai/intentBinder";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { createRoutineStyleCanonicalAuthority } from "../../src/core/ai/proseRoutineStyleContext";
import { BUILTIN_SKILLS } from "../../src/core/ai/skillsManager";
import { createSourceOwnedFactAuthority, sourceOwnedFactAuthorization } from "../../src/core/ai/sourceOwnedFactAuthority";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { IntentTask } from "../../src/core/ai/intentTypes";
import { ROLE_PRESETS } from "../../src/core/ai/agentOrchestrator";

const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";
const general = ROLE_PRESETS.find(role => role.id === "general")!.systemPrompt;
const explicitInstruction = "润色正文使其简洁，不改变日期和负责人。";

function request(action: AiTaskRequest["action"] = "polish", userPrompt: string | undefined = explicitInstruction,
  customSystemPrompt?: string, skill?: AiTaskRequest["skill"]): AiTaskRequest {
  return buildAiTaskRequest({ source, selected: false, action, ...(userPrompt !== undefined ? { userPrompt } : {}),
    ...(skill ? { skill } : {}), config: { provider: "local", activeRoleId: "general",
      ...(customSystemPrompt ? { customSystemPrompt } : {}) } });
}

function bound(task: IntentTask = "polish", document = source, range = { from: 0, to: source.length }): BoundIntent {
  const text = document.slice(range.from, range.to);
  return { intent: { version: 1, kind: "edit", operation: "rewrite", target: "document",
    content: { mode: "generate", task } }, range: { ...range, expectedText: text }, source: text,
  documentContent: document, summary: "rewrite document", dependency: "document" };
}

describe("source-owned closed-fact authority", () => {
  it("mints only for a complete General-role document rewrite with a positively authorized routine task", () => {
    const original = request();
    const authority = createSourceOwnedFactAuthority({ request: original, bound: bound(), source,
      instruction: explicitInstruction, task: "polish", effectiveSystemPrompt: general });
    expect(authority).toBeDefined();
    expect(sourceOwnedFactAuthorization(authority, { source, instruction: explicitInstruction, task: "polish",
      effectiveSystemPrompt: general })).toBe("explicit-routine-style-source-copy");
  });

  it("mints from the existing canonical proofread authority without broadening the explicit-instruction grammar", () => {
    const original = buildAiTaskRequest({ source, selected: false, action: "proofread",
      config: { provider: "local", activeRoleId: "general" } });
    const token = createRoutineStyleCanonicalAuthority({ request: original,
      instruction: original.actionDefinition.prompt, task: "proofread" });
    const authority = createSourceOwnedFactAuthority({ request: original, bound: bound("proofread"), source,
      instruction: original.actionDefinition.prompt, task: "proofread", effectiveSystemPrompt: general,
      routineStyleAuthority: token });
    expect(authority).toBeDefined();
    expect(sourceOwnedFactAuthorization(authority, { source, instruction: original.actionDefinition.prompt,
      task: "proofread", effectiveSystemPrompt: general })).toBe("canonical-routine-style");
  });

  it("revalidates the live canonical request instead of trusting a token issued for another request", () => {
    const original = buildAiTaskRequest({ source, selected: false, action: "proofread",
      config: { provider: "local", activeRoleId: "general" } });
    const instruction = original.actionDefinition.prompt;
    const token = createRoutineStyleCanonicalAuthority({ request: original, instruction, task: "proofread" });
    expect(token).toBeDefined();
    const mutated: AiTaskRequest[] = [
      { ...original, actionDefinition: { ...original.actionDefinition, prompt: `${instruction} 自定义追加` } },
      { ...original, userPrompt: instruction },
      { ...original, action: "polish" },
      { ...original, skill: { id: "polish", category: "writing", systemPrompt: "custom", userPromptTemplate: instruction } }
    ];
    for (const changed of mutated) {
      expect(createSourceOwnedFactAuthority({ request: changed, bound: bound("proofread"), source,
        instruction, task: "proofread", effectiveSystemPrompt: general, routineStyleAuthority: token })).toBeUndefined();
    }
  });

  it.each([
    "如果需要，润色正文使其简洁，不改变日期和负责人。",
    "润色正文使其简洁吗？不改变日期和负责人。",
    "润色正文使其简洁；同时把日期改成2026-11-04。",
    "润色正文使其简洁，但保留‘请请’不变。",
    "仅修改日期，不改变负责人。"
  ])("does not mint for unsafe or non-routine instructions: %s", instruction => {
    const original = request("polish", instruction);
    expect(createSourceOwnedFactAuthority({ request: original, bound: bound(), source, instruction,
      task: "polish", effectiveSystemPrompt: general })).toBeUndefined();
  });

  it("rejects user overrides, custom roles or Skills, wrong operation/task, selection and stale context", () => {
    const cases: Array<{ request: AiTaskRequest; instruction: string; task: IntentTask; bound: BoundIntent; system: string }> = [];
    const override = request("polish", `${explicitInstruction} 不改变其他内容。`);
    cases.push({ request: override, instruction: override.userPrompt!, task: "polish", bound: bound(), system: general });
    const customRole = request("polish", explicitInstruction, "自定义角色规则。");
    cases.push({ request: customRole, instruction: explicitInstruction, task: "polish", bound: bound(), system: customRole.baseSystemPrompt });
    const customSkill = { ...BUILTIN_SKILLS.find(skill => skill.id === "polish")!, id: "custom-polish" };
    const skilled = request("polish", explicitInstruction, undefined, customSkill);
    cases.push({ request: skilled, instruction: explicitInstruction, task: "polish", bound: bound(), system: customSkill.systemPrompt });
    cases.push({ request: request("polish"), instruction: explicitInstruction, task: "proofread", bound: bound("polish"), system: general });
    const nonRewrite = bound(); nonRewrite.intent = { version: 1, kind: "edit", operation: "replace_exact", target: "document",
      find: "林安", occurrence: "single", content: { mode: "generate", task: "polish" } };
    cases.push({ request: request(), instruction: explicitInstruction, task: "polish", bound: nonRewrite, system: general });
    const partial = bound("polish", source, { from: 0, to: source.length - 1 });
    cases.push({ request: request(), instruction: explicitInstruction, task: "polish", bound: partial, system: general });

    for (const item of cases) expect(createSourceOwnedFactAuthority({ request: item.request, bound: item.bound,
      source: item.bound.source, instruction: item.instruction, task: item.task,
      effectiveSystemPrompt: item.system })).toBeUndefined();
  });

  it("binds the issued token to exact source, instruction, task, system and whole-document scope", () => {
    const original = request();
    const token = createSourceOwnedFactAuthority({ request: original, bound: bound(), source,
      instruction: explicitInstruction, task: "polish", effectiveSystemPrompt: general });
    expect(token).toBeDefined();
    const base = { source, instruction: explicitInstruction, task: "polish" as const, effectiveSystemPrompt: general };
    expect(sourceOwnedFactAuthorization(token, base)).toBe("explicit-routine-style-source-copy");
    expect(sourceOwnedFactAuthorization(token, { ...base, source: `${source}!` })).toBeUndefined();
    expect(sourceOwnedFactAuthorization(token, { ...base, instruction: "只总结内容。" })).toBeUndefined();
    expect(sourceOwnedFactAuthorization(token, { ...base, task: "proofread" })).toBeUndefined();
    expect(sourceOwnedFactAuthorization(token, { ...base, effectiveSystemPrompt: "changed" })).toBeUndefined();
    expect(sourceOwnedFactAuthorization(token, { ...base, scopeContext: { document: source,
      range: { from: 1, to: source.length } } })).toBeUndefined();
  });
});
