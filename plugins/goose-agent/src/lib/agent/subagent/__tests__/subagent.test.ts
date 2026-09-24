import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_SUBAGENT_RUNS,
  MAX_SUBAGENT_DEPTH,
  getActiveSubagentCount,
  isRunSubagentToolName,
  parseRunSubagentInput,
  registerSubagentRun,
  resetSubagentConcurrencyForTests,
  shouldExposeRunSubagent,
  unregisterSubagentRun,
  waitForSubagentSlot,
} from "../index";
import type { SubAgentRunSnapshot } from "../types";
import { mergeUsage } from "../../usage";
import type { AgentTokenUsage } from "../../usage";
import { loadAgentTools } from "../../runTurn";
import type { AgentToolContext } from "../../types";

afterEach(() => {
  resetSubagentConcurrencyForTests();
});

describe("parseRunSubagentInput", () => {
  it("requires non-empty task", () => {
    expect(parseRunSubagentInput({}).ok).toBe(false);
    expect(parseRunSubagentInput({ task: "  " }).ok).toBe(false);
  });

  it("accepts task + optional overrides", () => {
    const r = parseRunSubagentInput({
      task: "调研 API",
      name: "调研",
      modelId: "gpt-4o",
      reasoningLevel: "high",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.task).toBe("调研 API");
    expect(r.value.name).toBe("调研");
    expect(r.value.modelId).toBe("gpt-4o");
    expect(r.value.reasoningLevel).toBe("high");
  });

  it("accepts prompt alias", () => {
    const r = parseRunSubagentInput({ prompt: "hello" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.task).toBe("hello");
  });
});

describe("shouldExposeRunSubagent / depth", () => {
  it("exposes at depth 0 and 1, hides at 2+", () => {
    expect(shouldExposeRunSubagent(0)).toBe(true);
    expect(shouldExposeRunSubagent(1)).toBe(true);
    expect(shouldExposeRunSubagent(MAX_SUBAGENT_DEPTH)).toBe(false);
    expect(shouldExposeRunSubagent(3)).toBe(false);
  });
});

describe("isRunSubagentToolName", () => {
  it("matches runSubagent and task aliases", () => {
    expect(isRunSubagentToolName("runSubagent")).toBe(true);
    expect(isRunSubagentToolName("task")).toBe(true);
    expect(isRunSubagentToolName("tool-runSubagent")).toBe(true);
    expect(isRunSubagentToolName("readFile")).toBe(false);
  });
});

describe("loadAgentTools runSubagent gating", () => {
  function ctx(depth: number): AgentToolContext {
    return {
      permissionMode: "workspace-write",
      workspaceRoot: null,
      loadedSkills: new Set(),
      signal: new AbortController().signal,
      subagentDepth: depth,
    };
  }

  it("includes runSubagent at root depth", () => {
    const tools = loadAgentTools(ctx(0));
    expect(tools.some((t) => t.name === "runSubagent")).toBe(true);
  });

  it("omits runSubagent at max depth", () => {
    const tools = loadAgentTools(ctx(MAX_SUBAGENT_DEPTH));
    expect(tools.some((t) => t.name === "runSubagent")).toBe(false);
  });
});

describe("subagent concurrency", () => {
  it("caps concurrent registrations", async () => {
    for (let i = 0; i < MAX_CONCURRENT_SUBAGENT_RUNS; i++) {
      const ok = registerSubagentRun({
        runId: `r${i}`,
        controller: new AbortController(),
        startedAt: Date.now(),
      });
      expect(ok).toBe(true);
    }
    expect(getActiveSubagentCount()).toBe(MAX_CONCURRENT_SUBAGENT_RUNS);

    const fourth = registerSubagentRun({
      runId: "r-extra",
      controller: new AbortController(),
      startedAt: Date.now(),
    });
    expect(fourth).toBe(false);

    const waiter = waitForSubagentSlot();
    unregisterSubagentRun("r0");
    await waiter;
    expect(getActiveSubagentCount()).toBe(MAX_CONCURRENT_SUBAGENT_RUNS - 1);
  });
});

describe("SubAgentRunSnapshot usage / liveText", () => {
  it("accepts usage and liveText on snapshot (emit payload shape)", () => {
    const usage: AgentTokenUsage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      source: "provider",
      updatedAt: Date.now(),
    };
    const snap: SubAgentRunSnapshot = {
      runId: "sub-1",
      name: "子代理",
      task: "hello",
      modelId: "gpt-4o",
      reasoningLevel: "medium",
      status: "running",
      depth: 1,
      startedAt: Date.now(),
      steps: [],
      usage,
      liveText: "partial…",
    };
    expect(snap.usage?.totalTokens).toBe(30);
    expect(snap.liveText).toBe("partial…");
  });

  it("mergeUsage accumulates multi-step child usage for snapshot", () => {
    const a: AgentTokenUsage = {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
      source: "provider",
      updatedAt: 1,
    };
    const b: AgentTokenUsage = {
      promptTokens: 7,
      completionTokens: 4,
      totalTokens: 11,
      source: "provider",
      updatedAt: 2,
    };
    const merged = mergeUsage(a, b);
    expect(merged.promptTokens).toBe(12);
    expect(merged.completionTokens).toBe(7);
    expect(merged.totalTokens).toBe(19);
    // 最终 emit 会把 merged 挂到 snapshot.usage，不写父会话
    const final: SubAgentRunSnapshot = {
      runId: "sub-2",
      name: "子代理",
      task: "t",
      modelId: "m",
      reasoningLevel: "low",
      status: "done",
      depth: 1,
      startedAt: 0,
      endedAt: 1,
      steps: [],
      usage: merged,
      summary: "done",
    };
    expect(final.usage?.promptTokens).toBe(12);
    expect(final.liveText).toBeUndefined();
  });
});
