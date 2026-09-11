import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAgentChatsStreamPersistPaused,
  setAgentChatsStreamPersistPaused,
} from "../useAgentChats";
import {
  MAX_CONCURRENT_SESSION_RUNS,
  resetSessionRunsForTests,
  selectIsSessionRunning,
  useSessionRuns,
} from "../useSessionRuns";

beforeEach(() => {
  resetSessionRunsForTests();
  setAgentChatsStreamPersistPaused(false);
});

afterEach(() => {
  resetSessionRunsForTests();
  setAgentChatsStreamPersistPaused(false);
  vi.restoreAllMocks();
});

describe("useSessionRuns concurrent registry", () => {
  it(`beginRun succeeds ${MAX_CONCURRENT_SESSION_RUNS} times; 4th is capped`, () => {
    const store = useSessionRuns.getState();
    const c1 = store.beginRun("conv-1", "msg-1");
    const c2 = store.beginRun("conv-2", "msg-2");
    const c3 = store.beginRun("conv-3", "msg-3");
    expect(c1).toBeInstanceOf(AbortController);
    expect(c2).toBeInstanceOf(AbortController);
    expect(c3).toBeInstanceOf(AbortController);
    expect(useSessionRuns.getState().getRunningCount()).toBe(3);
    expect(useSessionRuns.getState().canStartRun("conv-4")).toBe("capped");
    expect(useSessionRuns.getState().beginRun("conv-4", "msg-4")).toBeNull();
  });

  it("beginRun same conversation twice → already-running / null", () => {
    const first = useSessionRuns.getState().beginRun("conv-a", "msg-a");
    expect(first).toBeInstanceOf(AbortController);
    expect(useSessionRuns.getState().canStartRun("conv-a")).toBe(
      "already-running",
    );
    expect(useSessionRuns.getState().beginRun("conv-a", "msg-a2")).toBeNull();
    expect(useSessionRuns.getState().getStreamingMessageId("conv-a")).toBe(
      "msg-a",
    );
  });

  it("endRun frees a slot so another beginRun succeeds", () => {
    useSessionRuns.getState().beginRun("c1", "m1");
    useSessionRuns.getState().beginRun("c2", "m2");
    useSessionRuns.getState().beginRun("c3", "m3");
    expect(useSessionRuns.getState().beginRun("c4", "m4")).toBeNull();

    useSessionRuns.getState().endRun("c2");
    expect(useSessionRuns.getState().isRunning("c2")).toBe(false);
    expect(useSessionRuns.getState().getRunningCount()).toBe(2);
    expect(useSessionRuns.getState().canStartRun("c4")).toBe("ok");
    const next = useSessionRuns.getState().beginRun("c4", "m4");
    expect(next).toBeInstanceOf(AbortController);
  });

  it("abortRun aborts the controller and frees the slot", () => {
    const controller = useSessionRuns.getState().beginRun("conv-x", "msg-x");
    expect(controller).not.toBeNull();
    expect(controller!.signal.aborted).toBe(false);

    useSessionRuns.getState().abortRun("conv-x");
    expect(controller!.signal.aborted).toBe(true);
    expect(useSessionRuns.getState().isRunning("conv-x")).toBe(false);
    expect(useSessionRuns.getState().getRunningCount()).toBe(0);
  });

  it("beginRun pauses stream persist; last endRun unpauses and flushes", () => {
    expect(isAgentChatsStreamPersistPaused()).toBe(false);

    useSessionRuns.getState().beginRun("a", "m-a");
    expect(isAgentChatsStreamPersistPaused()).toBe(true);
    useSessionRuns.getState().beginRun("b", "m-b");
    expect(isAgentChatsStreamPersistPaused()).toBe(true);

    useSessionRuns.getState().endRun("a");
    // still one run active → keep paused
    expect(isAgentChatsStreamPersistPaused()).toBe(true);

    useSessionRuns.getState().endRun("b");
    expect(isAgentChatsStreamPersistPaused()).toBe(false);
    expect(useSessionRuns.getState().getRunningCount()).toBe(0);
  });

  it("selectIsSessionRunning tracks run state", () => {
    const sel = selectIsSessionRunning("conv-s");
    expect(sel(useSessionRuns.getState())).toBe(false);
    useSessionRuns.getState().beginRun("conv-s", "msg-s");
    expect(sel(useSessionRuns.getState())).toBe(true);
    expect(selectIsSessionRunning(null)(useSessionRuns.getState())).toBe(
      false,
    );
  });

  /**
   * Switching active conversation is NOT handled here — abort only via abortRun.
   * setActiveConversation must never call abortRun (wired in AgentSession / shell).
   */
  it("registry does not abort on unrelated endRun for other ids", () => {
    const c = useSessionRuns.getState().beginRun("keep", "m-keep");
    useSessionRuns.getState().endRun("other");
    expect(c!.signal.aborted).toBe(false);
    expect(useSessionRuns.getState().isRunning("keep")).toBe(true);
  });
});
