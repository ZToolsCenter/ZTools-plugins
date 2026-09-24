/**
 * 切换 active 会话不得 abort 运行中 turn（ADR 0015）。
 * abort 仅经由 abortRun 显式触发。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentMessageId,
  setAgentChatsStreamPersistPaused,
  useAgentChats,
  type AgentMessage,
} from "../useAgentChats";
import {
  resetSessionRunsForTests,
  useSessionRuns,
} from "../useSessionRuns";

function seedConversation(workspaceId: string | null = null): string {
  // 先建再塞一条消息，避免 createConversation 复用空会话
  const id = useAgentChats.getState().createConversation({ workspaceId });
  const msg: AgentMessage = {
    id: createAgentMessageId("user"),
    role: "user",
    parts: [{ type: "text", text: "hi" }],
    createdAt: Date.now(),
  };
  useAgentChats.getState().appendMessage(id, msg);
  return id;
}

beforeEach(() => {
  resetSessionRunsForTests();
  setAgentChatsStreamPersistPaused(false);
  useAgentChats.setState({
    conversations: {},
    activeConversationId: null,
    composerDrafts: {},
  });
});

afterEach(() => {
  resetSessionRunsForTests();
  setAgentChatsStreamPersistPaused(false);
});

describe("session switch does not abort runs", () => {
  it("beginRun a+b, setActiveConversation, both still running", () => {
    const a = seedConversation();
    const b = seedConversation();
    expect(a).not.toBe(b);

    const ctrlA = useSessionRuns.getState().beginRun(a, "msg-a");
    const ctrlB = useSessionRuns.getState().beginRun(b, "msg-b");
    expect(ctrlA).toBeInstanceOf(AbortController);
    expect(ctrlB).toBeInstanceOf(AbortController);
    expect(ctrlA!.signal.aborted).toBe(false);
    expect(ctrlB!.signal.aborted).toBe(false);

    // 模拟 UI 切换 active —— 不得 abort（勿 spy zustand action，会污染后续用例）
    useAgentChats.getState().setActiveConversation(a);
    expect(useAgentChats.getState().activeConversationId).toBe(a);
    useAgentChats.getState().setActiveConversation(b);
    expect(useAgentChats.getState().activeConversationId).toBe(b);

    expect(useSessionRuns.getState().isRunning(a)).toBe(true);
    expect(useSessionRuns.getState().isRunning(b)).toBe(true);
    expect(ctrlA!.signal.aborted).toBe(false);
    expect(ctrlB!.signal.aborted).toBe(false);
    expect(useSessionRuns.getState().getRunningCount()).toBe(2);
  });

  it("abortRun only aborts the targeted session", () => {
    useSessionRuns.getState().beginRun("keep", "m-keep");
    const abortMe = useSessionRuns.getState().beginRun("drop", "m-drop");
    expect(abortMe).not.toBeNull();

    useSessionRuns.getState().abortRun("drop");

    expect(abortMe!.signal.aborted).toBe(true);
    expect(useSessionRuns.getState().isRunning("drop")).toBe(false);
    expect(useSessionRuns.getState().isRunning("keep")).toBe(true);
    expect(useSessionRuns.getState().getRunningCount()).toBe(1);
  });

  it("setActiveConversation itself never touches the run registry", () => {
    const c1 = useSessionRuns.getState().beginRun("x", "mx");
    const before = { ...useSessionRuns.getState().runs };

    seedConversation();
    // create / setActive 不得改 runs
    expect(useSessionRuns.getState().runs).toEqual(before);
    expect(c1!.signal.aborted).toBe(false);
    expect(useSessionRuns.getState().isRunning("x")).toBe(true);
  });
});
