import { expect, it, vi } from "vitest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { planReadableProse } from "../../src/core/ai/readableProsePlan";
import type { ReadableProsePlan } from "../../src/core/ai/readableProsePlan";
import { runReadableProsePlan } from "../../src/core/ai/readableProseExecution";
import { buildThinProseSlots, type ThinProseSlot } from "../../src/core/ai/thinProseSlots";
import type { EnglishAgreementAnalysis } from "../../src/core/ai/englishAgreementTypes";
import { analyzeEnglishAgreement } from "../../src/core/ai/englishAgreementService";

const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";
const input = {
  instruction: "润色正文使其简洁，不改变日期和负责人。",
  systemPrompt: ""
};

function fixture() {
  const plan = planReadableProse(source, buildThinProseSlots(source, input.instruction));
  if (!plan) throw new Error("Expected the held-out clause plan to be safe.");
  return plan;
}

function applyStaged(plan: ReturnType<typeof fixture>, staged: Map<string, string>): string {
  return [...plan.slots].sort((left, right) => right.range.from - left.range.from).reduce((result, slot) => {
    return result.slice(0, slot.range.from) + staged.get(slot.id)! + result.slice(slot.range.to);
  }, source);
}

function harness(invoke: AiTaskRunnerOptions["invoke"], maxCalls = 64, signal?: AbortSignal) {
  const onProgress = vi.fn();
  const options: AiTaskRunnerOptions = {
    invoke,
    maxCalls,
    signal,
    isCurrent: () => true,
    abortCurrent: vi.fn(),
    onProgress
  };
  return { execution: createAiTaskExecution(options), options, onProgress };
}

it("executes only model clauses and stages the literal comma with model edits", async () => {
  const plan = fixture();
  const modelJobs = plan.jobs.filter(job => job.kind !== "literal");
  let next = 0;
  const invoke = vi.fn(async () => modelJobs[next++]!.view.text);
  const { execution, options, onProgress } = harness(invoke);

  const staged = await runReadableProsePlan(input, plan, execution, options);

  expect(invoke).toHaveBeenCalledTimes(2);
  expect(onProgress.mock.calls).toEqual([
    ["正在校对第 1/2 段正文"],
    ["正在校对第 2/2 段正文"]
  ]);
  expect(staged.size).toBe(plan.slots.length);
  expect(applyStaged(plan, staged)).toBe(source);
  expect(execution.remainingCalls).toBe(62);
});

it("checks the model-call budget before invoking any chunk", async () => {
  const plan = fixture();
  const invoke = vi.fn(async () => "unused");
  const analyze = vi.fn(async () => ({
    scope: "simple-present-subject-verb-agreement" as const, disposition: "abstained" as const,
    reason: "budget preflight", outputText: "unused", edits: []
  }));
  const { execution, options, onProgress } = harness(invoke, 1);

  await expect(runReadableProsePlan(input, plan, execution, options, analyze)).rejects.toThrow("正文分片超过本次调用预算");
  expect(invoke).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
  expect(onProgress).not.toHaveBeenCalled();
});

it("predecodes every literal clause before the first model call", async () => {
  const plan = fixture();
  const sentinel = new Error("literal-preflight-sentinel");
  const jobs = plan.jobs.map(job => job.kind === "literal"
    ? { ...job, view: { ...job.view, decode: () => { throw sentinel; } } }
    : job);
  const invoke = vi.fn(async () => "unused");
  const { execution, options } = harness(invoke);

  await expect(runReadableProsePlan(input, { ...plan, jobs }, execution, options)).rejects.toBe(sentinel);
  expect(invoke).not.toHaveBeenCalled();
});

it("returns no staged result when a later model clause fails", async () => {
  const plan = fixture();
  const sentinel = new Error("second-clause-sentinel");
  const invoke = vi.fn(async (_prompt: string, _system: string, _tokens: number, _emit: (chunk: string) => void) => {
    if (invoke.mock.calls.length === 2) throw sentinel;
    return plan.jobs.find(job => job.kind !== "literal")!.view.text;
  });
  const { execution, options } = harness(invoke);

  await expect(runReadableProsePlan(input, plan, execution, options)).rejects.toBe(sentinel);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("treats legacy jobs without a kind as model calls", async () => {
  const plan = fixture();
  const legacyPlan = {
    ...plan,
    jobs: plan.jobs.map(({ kind: _kind, ...job }) => job)
  };
  let next = 0;
  const invoke = vi.fn(async () => legacyPlan.jobs[next++]!.view.text);
  const { execution, options, onProgress } = harness(invoke);

  await runReadableProsePlan(input, legacyPlan, execution, options);

  expect(invoke).toHaveBeenCalledTimes(3);
  expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
    "正在校对第 1/3 段正文",
    "正在校对第 2/3 段正文",
    "正在校对第 3/3 段正文"
  ]);
});

it("still invokes the model for a caller-owned punctuation and emoji slot", async () => {
  const punctuationSource = "，🙂";
  const slots: ThinProseSlot[] = [{
    id: "punctuation-content", range: { from: 0, to: punctuationSource.length },
    sourceText: punctuationSource, contextBefore: "", contextAfter: ""
  }];
  const plan = planReadableProse(punctuationSource, slots)!;
  const invoke = vi.fn(async () => plan.jobs[0]!.view.text);
  const { execution, options } = harness(invoke);

  const staged = await runReadableProsePlan(input, plan, execution, options);

  expect(plan.jobs[0]!.kind ?? "model").toBe("model");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(staged.get(plan.slots[0]!.id)).toBe(punctuationSource);
});

it("uses bounded SVA suggestions in the prompt and postprocesses model output before decode", async () => {
  const englishSource = "The release notes needs careful review.";
  const instruction = "Correct grammar only. Do not rewrite or paraphrase; keep already correct content unchanged.";
  const englishInput = { instruction, systemPrompt: "Keep the author's requested scope." };
  const plan = planReadableProse(englishSource, buildThinProseSlots(englishSource, instruction))!;
  const events: string[] = [];
  const analyze = vi.fn(async (request: { text: string; readonlyPlaceholders?: string[]; referenceText?: string }, analyzeOptions?: { signal?: AbortSignal; timeoutMs?: number }): Promise<EnglishAgreementAnalysis> => {
    events.push("analyze");
    expect(analyzeOptions?.timeoutMs).toBeLessThanOrEqual(1500);
    const from = request.text.indexOf("needs");
    if (from < 0) return { scope: "simple-present-subject-verb-agreement", disposition: "no-supported-edit", reason: "no change", outputText: request.text, edits: [] };
    const outputText = `${request.text.slice(0, from)}need${request.text.slice(from + 5)}`;
    return {
      scope: "simple-present-subject-verb-agreement", disposition: "suggestions", reason: "subject agreement",
      outputText, edits: [{ from, to: from + 5, source: "needs", replacement: "need", subject: "notes", lemma: "need" }]
    };
  });
  const invoke = vi.fn(async (prompt: string, system: string) => {
    events.push("model");
    expect(prompt).toContain("The release notes need careful review.");
    expect(prompt).toContain(instruction);
    expect(system).toContain(englishInput.systemPrompt);
    return englishSource;
  });
  const { execution, options } = harness(invoke);

  const staged = await runReadableProsePlan(englishInput, plan, execution, options, analyze);

  expect(events).toEqual(["analyze", "model", "analyze"]);
  expect(analyze).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(analyze.mock.calls[0]?.[0].referenceText).toBeUndefined();
  expect(analyze.mock.calls[1]?.[0].referenceText).toBe("The release notes need careful review.");
  expect(plan.jobs[0]!.view.text).toBe(englishSource);
  expect(staged.get(plan.slots[0]!.id)).toBe("The release notes need careful review.");
});

it("restores a spelled readonly count before strict-reference NLP repairs an unjustified synonym", async () => {
  const englishSource = "The release has 3 stages, and each stage needs approval.";
  const instruction = "润色正文，已经正确的句子必须保持原样，不作同义词替换。";
  const englishInput = { instruction, systemPrompt: "Keep source facts and wording." };
  const slots = buildThinProseSlots(englishSource, instruction);
  const plan = planReadableProse(englishSource, slots)!;
  const requests: Array<{ text: string; referenceText?: string }> = [];
  const analyzer = async (request: { text: string; readonlyPlaceholders?: string[]; referenceText?: string }, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
    requests.push({ text: request.text, referenceText: request.referenceText });
    return analyzeEnglishAgreement(request, options);
  };
  const invoke = vi.fn(async () => "The release has three stages, and each stage requires approval.");
  const { execution, options } = harness(invoke);

  const staged = await runReadableProsePlan(englishInput, plan, execution, options, analyzer);
  const result = [...plan.slots].reverse().reduce((text, slot) =>
    text.slice(0, slot.range.from) + staged.get(slot.id)! + text.slice(slot.range.to), englishSource);

  expect(requests[1]).toEqual({
    text: "The release has 3 stages, and each stage requires approval.",
    referenceText: englishSource
  });
  expect(result).toBe(englishSource);
});

it("keeps a genuine grammar correction and rejects a changed readonly number after canonicalization", async () => {
  const englishSource = "The release have 3 stages.";
  const instruction = "校对语法，已经正确的句子必须保持原样，不作同义词替换。";
  const slots = buildThinProseSlots(englishSource, instruction);
  const plan = planReadableProse(englishSource, slots)!;
  const invoke = vi.fn(async () => "The release has three stages.");
  const { execution, options } = harness(invoke);
  const staged = await runReadableProsePlan({ instruction, systemPrompt: "" }, plan, execution, options);
  const result = [...plan.slots].reverse().reduce((text, slot) =>
    text.slice(0, slot.range.from) + staged.get(slot.id)! + text.slice(slot.range.to), englishSource);
  expect(result).toBe("The release has 3 stages.");

  const changedPlan = planReadableProse(englishSource, slots)!;
  const changedInvoke = vi.fn(async () => "The release has 4 stages.");
  const changedHarness = harness(changedInvoke);
  await expect(runReadableProsePlan({ instruction, systemPrompt: "" }, changedPlan,
    changedHarness.execution, changedHarness.options)).rejects.toThrow();
});

it("still calls the model when the SVA analyzer reports no supported edit", async () => {
  const englishSource = "The release notes need careful review.";
  const englishInput = { instruction: "Polish this sentence.", systemPrompt: "" };
  const plan = planReadableProse(englishSource, buildThinProseSlots(englishSource, englishInput.instruction))!;
  const noEdit: EnglishAgreementAnalysis = {
    scope: "simple-present-subject-verb-agreement", disposition: "no-supported-edit", reason: "no SVA issue",
    outputText: englishSource, edits: []
  };
  const analyze = vi.fn(async () => noEdit);
  const invoke = vi.fn(async () => englishSource);
  const { execution, options } = harness(invoke);

  await runReadableProsePlan(englishInput, plan, execution, options, analyze);

  expect(analyze).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("does not run NLP for literal jobs", async () => {
  const modelText = "The release notes need careful review.";
  const modelSlot: ThinProseSlot = {
    id: "model-slot", range: { from: 0, to: modelText.length }, sourceText: modelText,
    contextBefore: "", contextAfter: ","
  };
  const literalSlot: ThinProseSlot = {
    id: "literal-slot", range: { from: modelText.length, to: modelText.length + 1 }, sourceText: ",",
    contextBefore: modelText, contextAfter: ""
  };
  const plan: ReadableProsePlan = {
    slots: [modelSlot, literalSlot],
    jobs: [
      { kind: "model", slotIds: [modelSlot.id], view: { text: modelText, readonlyPlaceholders: [], normalizeReadonlySurface: raw => raw, decode: raw => new Map([[modelSlot.id, raw]]) } },
      { kind: "literal", slotIds: [literalSlot.id], view: { text: ",", readonlyPlaceholders: [], normalizeReadonlySurface: raw => raw, decode: raw => new Map([[literalSlot.id, raw]]) } }
    ]
  };
  const noEdit: EnglishAgreementAnalysis = {
    scope: "simple-present-subject-verb-agreement", disposition: "no-supported-edit", reason: "no SVA issue",
    outputText: modelText, edits: []
  };
  const analyze = vi.fn(async () => noEdit);
  const invoke = vi.fn(async () => modelText);
  const { execution, options } = harness(invoke);

  await runReadableProsePlan({ instruction: "Proofread this sentence.", systemPrompt: "" }, plan, execution, options, analyze);

  expect(analyze).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("finishes every analyzer and budget preflight before the first model call", async () => {
  const englishSource = "The release notes needs review.\nThe device need service.";
  const englishInput = { instruction: "Proofread these sentences.", systemPrompt: "" };
  const plan = planReadableProse(englishSource, buildThinProseSlots(englishSource, englishInput.instruction))!;
  expect(plan.jobs).toHaveLength(2);
  const events: string[] = [];
  const analyze = vi.fn(async (request: { text: string }): Promise<EnglishAgreementAnalysis> => {
    events.push("analyze");
    return {
      scope: "simple-present-subject-verb-agreement", disposition: "no-supported-edit", reason: "preflight",
      outputText: request.text, edits: []
    };
  });
  const invoke = vi.fn(async (prompt: string) => {
    events.push("model");
    return prompt.includes("The device") ? "The device need service." : "The release notes needs review.";
  });
  const { execution, options } = harness(invoke);

  await runReadableProsePlan(englishInput, plan, execution, options, analyze);

  expect(events).toEqual(["analyze", "analyze", "model", "analyze", "model", "analyze"]);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("falls back to the untouched prompt when the optional analyzer fails", async () => {
  const englishSource = "The release notes needs careful review.";
  const englishInput = { instruction: "Proofread this sentence.", systemPrompt: "Keep the facts." };
  const plan = planReadableProse(englishSource, buildThinProseSlots(englishSource, englishInput.instruction))!;
  const analyze = vi.fn(async () => { throw new Error("optional analyzer failed"); });
  const invoke = vi.fn(async (prompt: string) => {
    expect(prompt).toContain(englishSource);
    return englishSource;
  });
  const { execution, options } = harness(invoke);

  const staged = await runReadableProsePlan(englishInput, plan, execution, options, analyze);

  expect(analyze).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(staged.get(plan.slots[0]!.id)).toBe(englishSource);
});

it("preserves task cancellation while the optional analyzer is pending", async () => {
  const englishSource = "The release notes need careful review.";
  const englishInput = { instruction: "Proofread this sentence.", systemPrompt: "" };
  const plan = planReadableProse(englishSource, buildThinProseSlots(englishSource, englishInput.instruction))!;
  const controller = new AbortController();
  let started!: () => void;
  const analyzing = new Promise<void>(resolve => { started = resolve; });
  const analyze = vi.fn(async (_request: { text: string }, analyzeOptions?: { signal?: AbortSignal }) => {
    started();
    await new Promise<void>(resolve => analyzeOptions?.signal?.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("analyzer cancelled");
  });
  const invoke = vi.fn(async () => englishSource);
  const { execution, options } = harness(invoke, 64, controller.signal);
  const pending = runReadableProsePlan(englishInput, plan, execution, options, analyze);

  await analyzing;
  controller.abort();

  await expect(pending).rejects.toMatchObject({ name: "AiTaskCancelledError" });
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects multiline model output at the readonly-surface boundary before NLP postprocessing", async () => {
  const englishSource = "The release notes needs careful review.";
  const englishInput = { instruction: "Polish this sentence.", systemPrompt: "" };
  const plan = planReadableProse(englishSource, buildThinProseSlots(englishSource, englishInput.instruction))!;
  const noEdit: EnglishAgreementAnalysis = {
    scope: "simple-present-subject-verb-agreement", disposition: "no-supported-edit", reason: "no SVA issue",
    outputText: englishSource, edits: []
  };
  const analyze = vi.fn(async () => noEdit);
  const normalizeSurface = vi.spyOn(plan.jobs[0]!.view, "normalizeReadonlySurface");
  const decode = vi.spyOn(plan.jobs[0]!.view, "decode");
  const invoke = vi.fn(async () => `${englishSource}\nadded line`);
  const { execution, options } = harness(invoke);

  await expect(runReadableProsePlan(englishInput, plan, execution, options, analyze)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(normalizeSurface).toHaveBeenCalledOnce();
  expect(normalizeSurface).toHaveBeenCalledWith(`${englishSource}\nadded line`);
  expect(decode).not.toHaveBeenCalled();
});
