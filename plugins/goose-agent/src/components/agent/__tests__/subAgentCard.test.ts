import { describe, expect, it } from "vitest";
import {
  isSubAgentToolPart,
  resolveSubRunFromPart,
  resolveSubRunUsageProps,
} from "../SubAgentCard";
import type {
  AgentSubRunSnapshot,
  AgentToolPart,
} from "@/stores/useAgentChats";
import type { AgentTokenUsage } from "@/lib/agent/usage";

describe("isSubAgentToolPart", () => {
  it("detects runSubagent types and subRun field", () => {
    expect(isSubAgentToolPart({ type: "tool-runSubagent" })).toBe(true);
    expect(isSubAgentToolPart({ type: "tool-task" })).toBe(true);
    expect(
      isSubAgentToolPart({
        type: "tool-readFile",
        subRun: { runId: "x" } as never,
      }),
    ).toBe(true);
    expect(isSubAgentToolPart({ type: "tool-readFile" })).toBe(false);
  });
});

describe("resolveSubRunFromPart", () => {
  it("prefers subRun snapshot", () => {
    const part: AgentToolPart = {
      type: "tool-runSubagent",
      subRun: {
        runId: "sub-1",
        name: "调研",
        task: "查文档",
        modelId: "gpt-4o",
        reasoningLevel: "medium",
        status: "running",
        depth: 1,
        startedAt: 1,
        steps: [],
      },
    };
    const snap = resolveSubRunFromPart(part);
    expect(snap?.name).toBe("调研");
    expect(snap?.modelId).toBe("gpt-4o");
    expect(snap?.reasoningLevel).toBe("medium");
  });

  it("falls back to input/output", () => {
    const part: AgentToolPart = {
      type: "tool-runSubagent",
      state: "output-available",
      input: { task: "任务 A", name: "A", reasoningLevel: "high" },
      output: { ok: true, summary: "完成了" },
    };
    const snap = resolveSubRunFromPart(part);
    expect(snap?.task).toBe("任务 A");
    expect(snap?.summary).toBe("完成了");
    expect(snap?.reasoningLevel).toBe("high");
    expect(snap?.status).toBe("done");
  });
});

describe("resolveSubRunUsageProps", () => {
  const base: AgentSubRunSnapshot = {
    runId: "sub-1",
    name: "调研",
    task: "查文档",
    modelId: "gpt-4o",
    reasoningLevel: "medium",
    status: "running",
    depth: 1,
    startedAt: 1,
    steps: [],
  };

  it("wraps lastTurn usage and keeps modelId", () => {
    const usage: AgentTokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      tokensPerSecond: 40,
      source: "provider",
      updatedAt: 1,
    };
    const props = resolveSubRunUsageProps({ ...base, usage });
    expect(props.usageOverride?.lastTurn).toEqual(usage);
    expect(props.usageOverride?.session.totalTokens).toBe(0);
    expect(props.modelIdOverride).toBe("gpt-4o");
  });

  it("builds estimate messages from task + liveText + summary when no usage", () => {
    const props = resolveSubRunUsageProps({
      ...base,
      liveText: "进行中…",
      summary: "做完了",
    });
    expect(props.usageOverride).toBeNull();
    const texts = props.estimateMessages.flatMap((m) =>
      m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text),
    );
    expect(texts).toEqual(["查文档", "进行中…", "做完了"]);
  });
});
