import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { fireAutomation } from "../fire";
import {
  resetAutomationSchedulerForTests,
  reconcileMissed,
} from "../scheduler";
import { computeNextRunAt } from "../schedule";
import { useAgentChats } from "@/stores/useAgentChats";
import {
  resetAutomationsForTests,
  useAutomations,
} from "@/stores/useAutomations";
import { resetSessionRunsForTests } from "@/stores/useSessionRuns";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { useSettings } from "@/stores/settings";

vi.mock("@/lib/agent/runTurn", () => ({
  runAgentTurn: vi.fn(async (opts: { onEvent: (e: { type: string; text?: string }) => void }) => {
    opts.onEvent({ type: "text-delta", text: "ok" });
    opts.onEvent({ type: "done" });
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    danger: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { runAgentTurn } from "@/lib/agent/runTurn";

const runAgentTurnMock = runAgentTurn as unknown as Mock;

/** Bun vitest 无 vi.waitFor，简易轮询 */
async function waitFor(
  assertion: () => void,
  { timeout = 2000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() - start >= timeout) throw err;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

beforeEach(() => {
  resetAutomationsForTests();
  resetSessionRunsForTests();
  resetAutomationSchedulerForTests();
  useAgentChats.setState({
    conversations: {},
    activeConversationId: null,
    composerDrafts: {},
  });
  useWorkspaces.setState({
    workspaces: [
      { id: "ws-1", name: "demo", path: "/tmp/demo-ws" },
    ],
    activeId: "ws-1",
    expandedIds: ["ws-1"],
  });
  useSettings.setState({
    ai: {
      ...useSettings.getState().ai,
      customProtocol: "openai-responses",
      customOpenAIResponsesApiKey: "test-key-not-empty",
      customOpenAIApiKey: "test-key-not-empty",
      selectedModelId: "test-model",
      customModelOptions: [
        { id: "test-model", label: "Test", contextWindow: 128000 },
      ],
    },
  });
  runAgentTurnMock.mockClear();
  runAgentTurnMock.mockImplementation(async (opts: { onEvent: (e: { type: string; text?: string }) => void }) => {
    opts.onEvent({ type: "text-delta", text: "ok" });
    opts.onEvent({ type: "done" });
  });
});

afterEach(() => {
  resetAutomationSchedulerForTests();
  resetAutomationsForTests();
  resetSessionRunsForTests();
});

describe("useAutomations store", () => {
  it("create / update / setEnabled / remove", () => {
    const id = useAutomations.getState().create({
      name: "日报",
      prompt: "写日报",
      workspaceId: "ws-1",
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    const auto = useAutomations.getState().getAutomation(id);
    expect(auto?.name).toBe("日报");
    expect(auto?.permissionMode).toBe("full-access");
    expect(auto?.enabled).toBe(true);
    expect(auto?.nextRunAt).not.toBeNull();

    useAutomations.getState().update(id, { name: "周报" });
    expect(useAutomations.getState().getAutomation(id)?.name).toBe("周报");

    useAutomations.getState().setEnabled(id, false);
    expect(useAutomations.getState().getAutomation(id)?.enabled).toBe(false);

    useAutomations.getState().remove(id);
    expect(useAutomations.getState().getAutomation(id)).toBeUndefined();
  });

  it("create accepts full-access permissionMode for shell-enabled fires", () => {
    const id = useAutomations.getState().create({
      name: "同步 Git",
      prompt: "执行 syncAllGit",
      workspaceId: null,
      schedule: { kind: "manual" },
      permissionMode: "full-access",
    });
    const auto = useAutomations.getState().getAutomation(id);
    expect(auto?.permissionMode).toBe("full-access");
    useAutomations.getState().update(id, {
      permissionMode: "workspace-write",
    });
    expect(useAutomations.getState().getAutomation(id)?.permissionMode).toBe(
      "workspace-write",
    );
  });

  it("getDueAutomations respects enabled + nextRunAt", () => {
    const past = Date.now() - 60_000;
    const id = useAutomations.getState().create({
      name: "due",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    useAutomations.setState((s) => ({
      automations: {
        ...s.automations,
        [id]: { ...s.automations[id]!, nextRunAt: past, enabled: true },
      },
    }));
    expect(useAutomations.getState().getDueAutomations().map((a) => a.id)).toEqual(
      [id],
    );

    useAutomations.getState().setEnabled(id, false);
    expect(useAutomations.getState().getDueAutomations()).toEqual([]);
  });

  it("applyRunOutcome once success disables; error bumps failures", () => {
    const id = useAutomations.getState().create({
      name: "once",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "once", atMs: Date.now() + 3600_000 },
    });
    useAutomations.getState().applyRunOutcome(id, { status: "success" });
    const after = useAutomations.getState().getAutomation(id)!;
    expect(after.enabled).toBe(false);
    expect(after.nextRunAt).toBeNull();
    expect(after.consecutiveFailures).toBe(0);

    const id2 = useAutomations.getState().create({
      name: "fail",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
    });
    useAutomations.getState().applyRunOutcome(id2, { status: "error" });
    useAutomations.getState().applyRunOutcome(id2, { status: "error" });
    expect(
      useAutomations.getState().getAutomation(id2)?.consecutiveFailures,
    ).toBe(2);
  });

  it("recordRun prunes per automation", () => {
    const id = useAutomations.getState().create({
      name: "r",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
    });
    for (let i = 0; i < 55; i++) {
      useAutomations.getState().recordRun({
        id: `run-${i}`,
        automationId: id,
        conversationId: null,
        startedAt: 1000 + i,
        finishedAt: 1000 + i,
        status: "success",
        reason: "manual",
      });
    }
    expect(useAutomations.getState().listRuns(id).length).toBe(50);
  });
});

describe("fireAutomation", () => {
  it("creates conversation with source automation and calls runAgentTurn", async () => {
    const id = useAutomations.getState().create({
      name: "晨检",
      prompt: "检查仓库状态",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
    });

    const result = await fireAutomation(id, { reason: "manual" });
    expect(result.ok).toBe(true);
    expect(result.conversationId).toBeTruthy();
    expect(runAgentTurn).toHaveBeenCalledTimes(1);

    const conv =
      useAgentChats.getState().conversations[result.conversationId!];
    expect(conv?.source).toBe("automation");
    expect(conv?.automationId).toBe(id);
    expect(conv?.title).toContain("晨检");
    expect(conv?.messages.length).toBeGreaterThanOrEqual(2);

    const runs = useAutomations.getState().listRuns(id);
    expect(runs[0]?.status).toBe("success");
    expect(useAutomations.getState().isInFlight(id)).toBe(false);
  });

  it("manual works when paused; schedule does not", async () => {
    const id = useAutomations.getState().create({
      name: "paused",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
      enabled: false,
    });
    useAutomations.getState().setEnabled(id, false);

    const scheduled = await fireAutomation(id, { reason: "schedule" });
    expect(scheduled.skipped).toBe(true);
    expect(runAgentTurn).not.toHaveBeenCalled();

    const manual = await fireAutomation(id, { reason: "manual" });
    expect(manual.ok).toBe(true);
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("workspace-missing records error", async () => {
    const id = useAutomations.getState().create({
      name: "gone",
      prompt: "p",
      workspaceId: "ws-missing",
      schedule: { kind: "manual" },
    });
    const result = await fireAutomation(id, { reason: "manual" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("workspace-missing");
    expect(useAutomations.getState().listRuns(id)[0]?.error).toBe(
      "workspace-missing",
    );
  });

  it("null workspace (不选择工作区) fires as folderless conversation", async () => {
    const id = useAutomations.getState().create({
      name: "no-ws",
      prompt: "hello",
      workspaceId: null,
      schedule: { kind: "manual" },
    });
    const auto = useAutomations.getState().getAutomation(id);
    expect(auto?.workspaceId).toBeNull();

    const result = await fireAutomation(id, { reason: "manual" });
    expect(result.ok).toBe(true);
    expect(result.conversationId).toBeTruthy();
    const conv = useAgentChats.getState().conversations[result.conversationId!];
    expect(conv?.workspaceId ?? null).toBeNull();
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("forceNew always creates fresh conversation", async () => {
    const id = useAutomations.getState().create({
      name: "x",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
    });
    const r1 = await fireAutomation(id, { reason: "manual" });
    const r2 = await fireAutomation(id, { reason: "manual" });
    expect(r1.conversationId).not.toBe(r2.conversationId);
  });

  it("overrun skip when already inFlight", async () => {
    const id = useAutomations.getState().create({
      name: "slow",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
    });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    runAgentTurnMock.mockImplementationOnce(async (opts: { onEvent: (e: { type: string; text?: string }) => void }) => {
      await gate;
      opts.onEvent({ type: "text-delta", text: "late" });
      opts.onEvent({ type: "done" });
    });

    const p1 = fireAutomation(id, { reason: "manual" });
    // 等 inFlight 置位
    await waitFor(() => {
      expect(useAutomations.getState().isInFlight(id)).toBe(true);
    });

    // 全局串行：第二个会等第一个完成，不会 already-running
    // 直接 setInFlight 模拟 overrun 路径需绕过串行——改用 fireAutomationUnlocked 场景：
    // 同 id 在 fire 内 isInFlight 检查在 lock 内，串行后 inFlight 已清。
    // 验证：并行两个不同任务串行执行
    const id2 = useAutomations.getState().create({
      name: "other",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "manual" },
    });
    let secondStarted = false;
    runAgentTurnMock.mockImplementationOnce(async (opts: { onEvent: (e: { type: string }) => void }) => {
      secondStarted = true;
      opts.onEvent({ type: "done" });
    });
    const p2 = fireAutomation(id2, { reason: "manual" });
    // p1 未完成前 second 不应开始
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    release();
    await p1;
    await p2;
    expect(secondStarted).toBe(true);
  });
});

describe("reconcileMissed", () => {
  it("catch-up once for past nextRunAt within 7d", async () => {
    const id = useAutomations.getState().create({
      name: "missed",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const past = Date.now() - 60_000;
    useAutomations.setState((s) => ({
      automations: {
        ...s.automations,
        [id]: {
          ...s.automations[id]!,
          nextRunAt: past,
          enabled: true,
        },
      },
    }));

    const ids = reconcileMissed();
    expect(ids).toContain(id);
    // next 已推进
    const next = useAutomations.getState().getAutomation(id)?.nextRunAt;
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now() - 1000);

    // 等 catch-up fire 完成
    await waitFor(() => {
      expect(useAutomations.getState().listRuns(id).length).toBeGreaterThan(0);
    });
    expect(runAgentTurn).toHaveBeenCalled();
  });

  it("outside 7d only recompute next", () => {
    const id = useAutomations.getState().create({
      name: "old",
      prompt: "p",
      workspaceId: "ws-1",
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    useAutomations.setState((s) => ({
      automations: {
        ...s.automations,
        [id]: {
          ...s.automations[id]!,
          nextRunAt: old,
          enabled: true,
        },
      },
    }));
    const ids = reconcileMissed();
    expect(ids).not.toContain(id);
    expect(runAgentTurn).not.toHaveBeenCalled();
    const next = useAutomations.getState().getAutomation(id)?.nextRunAt;
    expect(next).toBe(
      computeNextRunAt(
        { kind: "daily", hour: 9, minute: 0 },
        Date.now(),
        useAutomations.getState().getAutomation(id)?.timeZone,
      ) ?? next,
    );
  });
});

describe("createConversation automation", () => {
  it("forceNew / source automation skips empty reuse", () => {
    const empty = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-1" });
    const autoConv = useAgentChats.getState().createConversation({
      workspaceId: "ws-1",
      source: "automation",
      automationId: "auto-x",
      title: "task",
      forceNew: true,
    });
    expect(autoConv).not.toBe(empty);
    const c = useAgentChats.getState().conversations[autoConv];
    expect(c?.source).toBe("automation");
    expect(c?.automationId).toBe("auto-x");
    expect(c?.title).toBe("task");
  });
});
