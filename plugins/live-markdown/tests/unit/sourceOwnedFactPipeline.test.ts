import { describe, expect, it, vi } from "vitest";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { ROLE_PRESETS } from "../../src/core/ai/agentOrchestrator";

const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";
const instruction = "润色正文使其简洁，不改变日期和负责人。";

type RunnerOverrides = Partial<Pick<AiTaskRunnerOptions, "invoke" | "isCurrent" | "abortCurrent" | "maxCalls" |
  "maxDurationMs" | "now" | "signal">>;

async function run(requestPrompt = instruction, overrides: RunnerOverrides = {}) {
  const request = buildAiTaskRequest({ source, selected: false, action: "polish", userPrompt: requestPrompt,
    config: { provider: "local", activeRoleId: "general", executionPolicy: "thin", model: "Qwen3-0.6B-Q4_K_M.gguf" } });
  const snapshot: AiDocumentSnapshot = { documentId: "closed-fact.md", revision: 1, content: source,
    selection: null, cursor: null, readOnly: false };
  const calls: Array<{ prompt: string; system: string; maxTokens: number }> = [];
  const defaultInvoke: AiTaskRunnerOptions["invoke"] = async (prompt, system, maxTokens) => {
    calls.push({ prompt, system, maxTokens });
    const marker = "纠正下面这一行正文：\n\n";
    const at = prompt.lastIndexOf(marker);
    if (at < 0) throw new Error("Expected the original readable prose request.");
    return prompt.slice(at + marker.length);
  };
  const invoke = overrides.invoke ?? defaultInvoke;
  const result = await runPlannedAiTaskCore(request, snapshot, { invoke, isCurrent: overrides.isCurrent ?? (() => true),
    abortCurrent: overrides.abortCurrent ?? vi.fn(), maxCalls: overrides.maxCalls ?? 16,
    maxDurationMs: overrides.maxDurationMs, now: overrides.now, signal: overrides.signal });
  return { result, calls, candidate: result.proposal ? resolveAiEdit(result.proposal)?.content : result.candidateText ?? result.text,
    snapshot };
}

describe("source-owned closed date facts in the real thin prose pipeline", () => {
  it("keeps the closed owner/event/date window out of model calls while the ordinary request still runs", async () => {
    const outcome = await run();

    expect(outcome.calls).toHaveLength(1);
    expect(outcome.calls[0]?.prompt).toContain("请请大家进行确认。");
    expect(outcome.calls[0]?.prompt).not.toContain("由林安负责的排期日期是2026-11-03");
    expect(outcome.candidate).toBe("由林安负责的排期日期是2026-11-03，请大家进行确认。");
    expect(outcome.snapshot.content).toBe(source);
  });

  it("uses the same R22 date formatting under the canonical default proofread action", async () => {
    const proofSource = "由周岚负责的验收日期是2027-01-09，请请相关同事再次进行核对。";
    const request = buildAiTaskRequest({ source: proofSource, selected: false, action: "proofread",
      config: { provider: "local", activeRoleId: "general", executionPolicy: "thin", model: "Qwen3-0.6B-Q4_K_M.gguf" } });
    const snapshot: AiDocumentSnapshot = { documentId: "canonical-fact.md", revision: 1, content: proofSource,
      selection: null, cursor: null, readOnly: false };
    const calls: string[] = [];
    const invoke: AiTaskRunnerOptions["invoke"] = async prompt => {
      calls.push(prompt);
      const marker = "纠正下面这一行正文：\n\n";
      const at = prompt.lastIndexOf(marker);
      if (at < 0) throw new Error("Expected the original readable prose request.");
      return prompt.slice(at + marker.length);
    };
    const result = await runPlannedAiTaskCore(request, snapshot, { invoke, isCurrent: () => true,
      abortCurrent: vi.fn(), maxCalls: 16 });
    const candidate = result.proposal ? resolveAiEdit(result.proposal)?.content : result.candidateText ?? result.text;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("请请相关同事再次进行核对。");
    expect(calls[0]).not.toContain("由周岚负责的验收日期是2027-01-09");
    expect(candidate).toBe("由周岚负责的验收日期是 2027-01-09，请相关同事再次进行核对。");
    expect(snapshot.content).toBe(proofSource);
    expect(request.baseSystemPrompt).toBe(ROLE_PRESETS.find(role => role.id === "general")?.systemPrompt);
  });

  it("does not call the model when the remaining-call budget cannot cover the ordinary prose jobs", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "");
    await expect(run(instruction, { invoke, maxCalls: 0 })).rejects.toThrow(/调用预算/u);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["provider failure", async () => { throw new Error("provider failed"); }],
    ["incomplete slot coverage", async () => ""]
  ])("discards the entire staged candidate after %s", async (_label, invoke) => {
    const snapshotBefore = source;
    await expect(run(instruction, { invoke })).rejects.toThrow();
    expect(snapshotBefore).toBe(source);
  });

  it("rejects a response when the document becomes stale immediately after the model returns", async () => {
    let current = true;
    const invoke: AiTaskRunnerOptions["invoke"] = async prompt => {
      const marker = "纠正下面这一行正文：\n\n";
      const at = prompt.lastIndexOf(marker);
      if (at < 0) throw new Error("Expected the original readable prose request.");
      current = false;
      return prompt.slice(at + marker.length);
    };
    const outcome = run(instruction, { invoke, isCurrent: () => current });
    await expect(outcome).rejects.toThrow();
  });

  it("rejects a response that arrives after the task deadline", async () => {
    let time = 0;
    const invoke: AiTaskRunnerOptions["invoke"] = async prompt => {
      const marker = "纠正下面这一行正文：\n\n";
      const at = prompt.lastIndexOf(marker);
      if (at < 0) throw new Error("Expected the original readable prose request.");
      time = 101;
      return prompt.slice(at + marker.length);
    };
    await expect(run(instruction, { invoke, maxDurationMs: 100, now: () => time })).rejects.toThrow(/时间上限/u);
  });
});
