import { describe, expect, it } from "vitest";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import { BUILTIN_SKILLS } from "../../src/core/ai/skillsManager";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const source = "由周岚负责的验收日期是2027-01-09，请请相关同事再次进行核对。";
const polishExpectedRepair = "由周岚负责的验收日期是2027-01-09，请相关同事再次进行核对。";
const proofreadExpectedRepair = "由周岚负责的验收日期是 2027-01-09，请相关同事再次进行核对。";
const sourceMarker = "纠正下面这一行正文：\n\n";
const slotMarker = "正文文本槽：";
const modelId = "Qwen3-0.6B-Q4_K_M.gguf";

interface CapturedCall {
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  sourceViews: string[];
}

interface RunOutcome {
  candidate: string;
  calls: CapturedCall[];
  plannedCalls: number;
  request: AiTaskRequest;
  snapshot: AiDocumentSnapshot;
}

function buildRequest(input: {
  action: AiTaskRequest["action"];
  skill?: AiTaskRequest["skill"];
  userPrompt?: string;
  customSystemPrompt?: string;
}): AiTaskRequest {
  return buildAiTaskRequest({
    source,
    selected: false,
    action: input.action,
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.userPrompt !== undefined ? { userPrompt: input.userPrompt } : {}),
    config: {
      provider: "local",
      activeRoleId: "general",
      executionPolicy: "thin",
      model: modelId,
      ...(input.customSystemPrompt ? { customSystemPrompt: input.customSystemPrompt } : {})
    }
  });
}

function sourceViewsFromCall(prompt: string, schema?: Record<string, unknown>): string[] {
  if (schema) {
    const payloadAt = prompt.lastIndexOf(slotMarker);
    if (payloadAt < 0) throw new Error("Unexpected non-slot model request in the default pipeline.");
    const payload = JSON.parse(prompt.slice(payloadAt + slotMarker.length).trim()) as {
      slots?: Array<{ text?: string }>;
    };
    const views = payload.slots?.map(slot => slot.text ?? "") ?? [];
    if (!views.length || views.some(view => !view || !source.includes(view))) {
      throw new Error("Expected source-owned Markdown slots in the provider request.");
    }
    return views;
  }

  const lineAt = prompt.lastIndexOf(sourceMarker);
  if (lineAt < 0) throw new Error("Unexpected request shape; expected the readable prose provider seam.");
  const view = prompt.slice(lineAt + sourceMarker.length);
  if (!view || !source.includes(view)) throw new Error("The no-op stub may only return exact source text.");
  return [view];
}

function candidateText(result: Awaited<ReturnType<typeof runPlannedAiTaskCore>>): string {
  const resolved = result.proposal ? resolveAiEdit(result.proposal)?.content : undefined;
  return resolved ?? result.candidateText ?? result.text;
}

async function runNoopPipeline(request: AiTaskRequest): Promise<RunOutcome> {
  const snapshot: AiDocumentSnapshot = {
    documentId: "routine-style-canonical.md",
    revision: 7,
    content: source,
    selection: null,
    cursor: null,
    readOnly: false
  };
  const calls: CapturedCall[] = [];
  let plannedCalls = 0;
  const invoke: AiTaskRunnerOptions["invoke"] = async (prompt, systemPrompt, maxTokens, _onChunk, schema) => {
    const sourceViews = sourceViewsFromCall(prompt, schema);
    calls.push({ prompt, systemPrompt, maxTokens, sourceViews });
    return schema
      ? JSON.stringify({ edits: sourceViews.map((text, index) => ({ id: readSlotId(prompt, index), text })) })
      : sourceViews[0]!;
  };
  const result = await runPlannedAiTaskCore(request, snapshot, {
    invoke,
    isCurrent: () => true,
    abortCurrent() {},
    maxCalls: 16,
    onProgress(message) {
      const planned = /(?:校对|润色)第 \d+\/(\d+) (?:段|组)/u.exec(message);
      if (planned) plannedCalls = Number(planned[1]);
    }
  });
  return { candidate: candidateText(result), calls, plannedCalls, request, snapshot };
}

function readSlotId(prompt: string, index: number): string {
  const payloadAt = prompt.lastIndexOf(slotMarker);
  if (payloadAt < 0) throw new Error("Expected the slot payload marker.");
  const payload = JSON.parse(prompt.slice(payloadAt + slotMarker.length).trim()) as {
    slots?: Array<{ id?: string }>;
  };
  const id = payload.slots?.[index]?.id;
  if (!id) throw new Error(`Missing source slot ${index}.`);
  return id;
}

function expectPlannedNoopCalls(outcome: RunOutcome): void {
  expect(outcome.plannedCalls).toBeGreaterThan(0);
  expect(outcome.calls).toHaveLength(outcome.plannedCalls);
  expect(outcome.calls.every(call => call.maxTokens > 0 && call.sourceViews.length > 0)).toBe(true);
}

describe("canonical routine-style authority through the default AI pipeline", () => {
  it.each([
    ["default polish action", { action: "polish" }, polishExpectedRepair],
    ["polish action with its canonical Skill", { action: "polish", skill: BUILTIN_SKILLS.find(skill => skill.id === "polish")! }, polishExpectedRepair],
    ["default proofread action", { action: "proofread" }, proofreadExpectedRepair],
    ["typo-proofread Skill", { action: "typo-proofread", skill: BUILTIN_SKILLS.find(skill => skill.id === "typo-proofread")! }, proofreadExpectedRepair]
  ] as const)("applies canonical text and spacing repairs for %s after an exact model no-op", async (_label, input, expectedCandidate) => {
    const outcome = await runNoopPipeline(buildRequest(input));

    expectPlannedNoopCalls(outcome);
    expect(outcome.calls.every(call => call.sourceViews.every(view => source.includes(view)))).toBe(true);
    expect(outcome.candidate).toBe(expectedCandidate);
    expect(outcome.candidate).toContain("周岚");
    expect(outcome.candidate).toContain("2027-01-09");
    expect(outcome.snapshot.content).toBe(source);
  });

  it.each([
    ["custom system context", { action: "polish", customSystemPrompt: "保留重复请求词，不要删除正文字符。" }],
    ["custom Skill", { action: "polish", skill: {
      ...BUILTIN_SKILLS.find(skill => skill.id === "polish")!,
      id: "custom-polish-routine-style",
      systemPrompt: "自定义润色规则：保留重复请求词。"
    } }],
    ["user override", { action: "polish", userPrompt: "润色正文，但不要删掉重复的请求词；请原样保留。" }]
  ] as const)("preserves the repeated marker and facts for %s", async (_label, input) => {
    const outcome = await runNoopPipeline(buildRequest(input));

    expectPlannedNoopCalls(outcome);
    expect(outcome.candidate).toBe(source);
    expect(outcome.candidate).toContain("请请相关同事");
    expect(outcome.candidate).toContain("周岚");
    expect(outcome.candidate).toContain("2027-01-09");
    expect(outcome.snapshot.content).toBe(source);
  });
});
