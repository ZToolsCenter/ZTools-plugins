import { create } from "zustand";
import { abortSubagentsForConversation } from "@/lib/agent/subagent/concurrency";
import { setAgentChatsStreamPersistPaused } from "@/stores/useAgentChats";

/** 全局最多同时运行的会话 turn 数（跨会话） */
export const MAX_CONCURRENT_SESSION_RUNS = 3;

export type SessionRunEntry = {
  assistantMessageId: string;
};

export type CanStartRunResult = "ok" | "already-running" | "capped";

export interface SessionRunsState {
  /** conversationId → 进行中 run 的 UI 元数据 */
  runs: Record<string, SessionRunEntry>;

  isRunning: (conversationId: string) => boolean;
  getRunningCount: () => number;
  getStreamingMessageId: (conversationId: string) => string | null;
  canStartRun: (conversationId: string) => CanStartRunResult;
  /**
   * 开始 run：写入 Map + state，并 pause chats 持久化。
   * 已在跑或达到上限时返回 null。
   * 注意：切换 active session 不得调用 abort；仅 abortRun 会中止。
   */
  beginRun: (
    conversationId: string,
    assistantMessageId: string,
  ) => AbortController | null;
  /** 结束 run 并在全局 count===0 时恢复持久化 + flush */
  endRun: (conversationId: string) => void;
  /** abort 对应 controller 后 endRun */
  abortRun: (conversationId: string) => void;
}

/** Module-level：不进 zustand state，避免序列化/订阅噪音 */
const controllers = new Map<string, AbortController>();

function runningCountFrom(
  runs: Record<string, SessionRunEntry>,
): number {
  return Object.keys(runs).length;
}

/**
 * 并发 session run 注册表（非持久化）。
 * 仅追踪 runs；流式文本 flush 仍由 AgentSession 处理。
 * 切换 activeConversation 不得 abort — 只通过 abortRun。
 */
export const useSessionRuns = create<SessionRunsState>()((set, get) => ({
  runs: {},

  isRunning: (conversationId) => {
    return Boolean(get().runs[conversationId]);
  },

  getRunningCount: () => runningCountFrom(get().runs),

  getStreamingMessageId: (conversationId) => {
    return get().runs[conversationId]?.assistantMessageId ?? null;
  },

  canStartRun: (conversationId) => {
    const { runs } = get();
    if (runs[conversationId]) return "already-running";
    if (runningCountFrom(runs) >= MAX_CONCURRENT_SESSION_RUNS) {
      return "capped";
    }
    return "ok";
  },

  beginRun: (conversationId, assistantMessageId) => {
    const status = get().canStartRun(conversationId);
    if (status !== "ok") return null;

    const controller = new AbortController();
    controllers.set(conversationId, controller);
    set((state) => ({
      runs: {
        ...state.runs,
        [conversationId]: { assistantMessageId },
      },
    }));
    // 任一 run 活跃即 pause 持久化
    setAgentChatsStreamPersistPaused(true);
    return controller;
  },

  endRun: (conversationId) => {
    if (!get().runs[conversationId] && !controllers.has(conversationId)) {
      return;
    }
    controllers.delete(conversationId);
    set((state) => {
      if (!state.runs[conversationId]) return state;
      const next = { ...state.runs };
      delete next[conversationId];
      return { runs: next };
    });
    if (get().getRunningCount() === 0) {
      setAgentChatsStreamPersistPaused(false);
    }
  },

  abortRun: (conversationId) => {
    const controller = controllers.get(conversationId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    // 父级中止 → 级联取消子代理
    abortSubagentsForConversation(conversationId);
    get().endRun(conversationId);
  },
}));

/** 选择器：某会话是否在跑 */
export function selectIsSessionRunning(
  conversationId: string | null,
): (s: SessionRunsState) => boolean {
  return (s) =>
    conversationId != null ? Boolean(s.runs[conversationId]) : false;
}

/** 测试 / 诊断：清空全部 runs 与 controllers（不 abort） */
export function resetSessionRunsForTests() {
  controllers.clear();
  useSessionRuns.setState({ runs: {} });
  setAgentChatsStreamPersistPaused(false);
}
