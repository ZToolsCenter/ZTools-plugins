import { describe, expect, it } from "vitest";
import { ROLE_PRESETS } from "../../src/core/ai/agentOrchestrator";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { createRoutineStyleCanonicalAuthority } from "../../src/core/ai/proseRoutineStyleContext";
import { createSourceOwnedFactAuthority } from "../../src/core/ai/sourceOwnedFactAuthority";
import { planReadableProse } from "../../src/core/ai/readableProsePlan";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { prepareSourceOwnedFactPlan } from "../../src/core/ai/sourceOwnedFactPlan";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { IntentTask } from "../../src/core/ai/intentTypes";

const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";
const instruction = "润色正文使其简洁，不改变日期和负责人。";
const general = ROLE_PRESETS.find(role => role.id === "general")!.systemPrompt;
const scopeContext = (text: string) => ({ document: text, range: { from: 0, to: text.length } });

function taskRequest(text: string, task: "polish" | "proofread", prompt?: string): AiTaskRequest {
  return buildAiTaskRequest({ source: text, selected: false, action: task,
    ...(prompt !== undefined ? { userPrompt: prompt } : {}), config: { provider: "local", activeRoleId: "general" } });
}

function bound(text: string, task: IntentTask = "polish") {
  return { intent: { version: 1 as const, kind: "edit" as const, operation: "rewrite" as const,
    target: "document" as const, content: { mode: "generate" as const, task } },
    range: { from: 0, to: text.length, expectedText: text }, source: text, documentContent: text,
    summary: "rewrite document", dependency: "document" as const };
}

function prepare(text = source, task: "polish" | "proofread" = "polish", prompt = instruction) {
  const request = taskRequest(text, task, prompt);
  const authority = createSourceOwnedFactAuthority({ request, bound: bound(text, task), source: text,
    instruction: prompt, task, effectiveSystemPrompt: general,
    routineStyleAuthority: createRoutineStyleCanonicalAuthority({ request, instruction: prompt, task }) });
  const scope = scopeContext(text);
  const systemContext = `${general}\n`;
  const slots = buildThinProseSlots(text, prompt, systemContext, scope);
  const plan = planReadableProse(text, slots, { instruction: prompt, scopeContext: scope });
  return { request, authority, slots, plan, scope, systemContext };
}

describe("source-owned closed-fact planner", () => {
  it("plans only the closed owner/event/ISO date window and keeps a separate model job", () => {
    const input = prepare();
    const originalShape = JSON.stringify(input.plan);
    const prepared = prepareSourceOwnedFactPlan({ authority: input.authority, source, instruction,
      systemPrompt: general, task: "polish", scopeContext: input.scope,
      originalSlots: input.slots, readablePlan: input.plan });

    expect(prepared).toBeDefined();
    expect(prepared?.decisions).toHaveLength(1);
    expect(prepared?.decisions[0]).toMatchObject({ authorization: "explicit-routine-style-source-copy",
      sourceText: "由林安负责的排期日期是2026-11-03", outputText: "由林安负责的排期日期是2026-11-03",
      formatter: "explicit-routine-style-source-copy", fact: { owner: { value: "林安" }, event: { value: "排期" }, date: { iso: "2026-11-03" } } });
    expect(prepared?.plan).toBe(input.plan);
    expect(JSON.stringify(input.plan)).toBe(originalShape);
  });

  it("matches canonical R22 proofread spacing while custom source-copy keeps the original bytes", () => {
    const proofSource = "由周岚负责的验收日期是2027-01-09，请请相关同事再次进行核对。";
    const proofRequest = taskRequest(proofSource, "proofread");
    const proofInstruction = proofRequest.actionDefinition.prompt;
    const authority = createSourceOwnedFactAuthority({ request: proofRequest, bound: bound(proofSource, "proofread"),
      source: proofSource, instruction: proofInstruction, task: "proofread", effectiveSystemPrompt: general,
      routineStyleAuthority: createRoutineStyleCanonicalAuthority({ request: proofRequest, instruction: proofInstruction, task: "proofread" }) });
    const scope = scopeContext(proofSource);
    const slots = buildThinProseSlots(proofSource, proofInstruction, `${general}\n`, scope);
    const plan = planReadableProse(proofSource, slots, { instruction: proofInstruction, scopeContext: scope });
    const prepared = prepareSourceOwnedFactPlan({ authority, source: proofSource, instruction: proofInstruction,
      systemPrompt: general, task: "proofread", scopeContext: scope, originalSlots: slots, readablePlan: plan });
    expect(prepared?.decisions[0]).toMatchObject({ authorization: "canonical-routine-style",
      outputText: "由周岚负责的验收日期是 2027-01-09", formatter: "proofread-ascii-space-after-copula" });

    const customSource = "由周岚负责的验收日期是2027-01-09，请请相关同事再次进行核对。";
    const custom = prepare(customSource, "proofread", "校对正文使其简洁，不改变日期和负责人。");
    const customPlan = prepareSourceOwnedFactPlan({ authority: custom.authority, source: customSource,
      instruction: "校对正文使其简洁，不改变日期和负责人。", systemPrompt: general, task: "proofread",
      scopeContext: custom.scope, originalSlots: custom.slots, readablePlan: custom.plan });
    expect(customPlan?.decisions[0]).toMatchObject({ authorization: "explicit-routine-style-source-copy",
      outputText: "由周岚负责的验收日期是2027-01-09", formatter: "explicit-routine-style-source-copy" });
  });

  it("falls back when no ordinary model job remains or source facts are not a closed supported window", () => {
    const onlyFact = "由林安负责的排期日期是2026-11-03。";
    const only = prepare(onlyFact);
    expect(prepareSourceOwnedFactPlan({ authority: only.authority, source: onlyFact, instruction,
      systemPrompt: general, task: "polish", scopeContext: only.scope,
      originalSlots: only.slots, readablePlan: only.plan })).toBeUndefined();

    const unsupported = [
      "由林安负责的排期日期2026-11-03，请请大家进行确认。",
      "由林安负责的排期日期是2026-11-03已完成，请请大家进行确认。",
      "由林安负责的排期日期是2026-11-03和2026-11-04，请请大家进行确认。",
      "由林安负责的排期日期是2026-02-30，请请大家进行确认。",
      "由林安负责的排期日期是2026-11-03准确无误，请请大家进行确认。"
    ];
    for (const text of unsupported) {
      const item = prepare(text);
      expect(prepareSourceOwnedFactPlan({ authority: item.authority, source: text, instruction,
        systemPrompt: general, task: "polish", scopeContext: item.scope,
        originalSlots: item.slots, readablePlan: item.plan })).toBeUndefined();
    }
  });

  it("preserves ownership across multiple independent fact windows without absorbing the request slot", () => {
    const text = "由周岚负责的验收日期是2027-01-09。\n\n由林安负责的发布日期为2027-02-10。\n\n请请相关同事再次核对。";
    const input = prepare(text);
    const prepared = prepareSourceOwnedFactPlan({ authority: input.authority, source: text, instruction,
      systemPrompt: general, task: "polish", scopeContext: input.scope,
      originalSlots: input.slots, readablePlan: input.plan });
    expect(prepared?.decisions.map(decision => [decision.fact.owner.value, decision.fact.event.value, decision.fact.date.iso]))
      .toEqual([["周岚", "验收", "2027-01-09"], ["林安", "发布", "2027-02-10"]]);
    expect(prepared?.plan.jobs.filter(job => job.kind !== "literal" &&
      !prepared.decisions.some(decision => job.slotIds.includes(decision.slotId)))).toHaveLength(1);
  });

  it("does not promote protected Markdown/front matter or unauthenticated plan inputs", () => {
    const protectedSources = [
      "```text\n由林安负责的排期日期是2026-11-03。\n```\n\n请请大家进行确认。",
      "---\ndate: 由林安负责的排期日期是2026-11-03\n---\n\n请请大家进行确认。",
      "> 由林安负责的排期日期是2026-11-03。\n\n请请大家进行确认。"
    ];
    for (const text of protectedSources) {
      const input = prepare(text);
      expect(prepareSourceOwnedFactPlan({ authority: input.authority, source: text, instruction,
        systemPrompt: general, task: "polish", scopeContext: input.scope,
        originalSlots: input.slots, readablePlan: input.plan })).toBeUndefined();
    }
    const input = prepare();
    expect(prepareSourceOwnedFactPlan({ source, instruction, systemPrompt: general, task: "polish",
      scopeContext: input.scope, originalSlots: input.slots, readablePlan: input.plan })).toBeUndefined();
  });

  it("does not trust a modified candidate slot, foreign plan, or partial source scope", () => {
    const input = prepare();
    const originalSlots = input.slots.map(slot => ({ ...slot, range: { ...slot.range } }));
    const forged = originalSlots.find(slot => slot.dateOwnerCandidate);
    if (forged) forged.sourceText += "伪造";
    expect(prepareSourceOwnedFactPlan({ authority: input.authority, source, instruction,
      systemPrompt: general, task: "polish", scopeContext: input.scope,
      originalSlots, readablePlan: input.plan })).toBeUndefined();

    const partial = { document: source, range: { from: 1, to: source.length } };
    expect(prepareSourceOwnedFactPlan({ authority: input.authority, source, instruction,
      systemPrompt: general, task: "polish", scopeContext: partial,
      originalSlots: input.slots, readablePlan: input.plan })).toBeUndefined();
    expect(prepareSourceOwnedFactPlan({ authority: input.authority, source: `${source}!`, instruction,
      systemPrompt: general, task: "polish", scopeContext: input.scope,
      originalSlots: input.slots, readablePlan: input.plan })).toBeUndefined();
  });
});
