/**
 * 子代理并发槽：不占用会话 cap=3，另设上限 MAX_CONCURRENT_SUBAGENT_RUNS。
 */

import {
  MAX_CONCURRENT_SUBAGENT_RUNS,
  type SubAgentRunSnapshot,
} from "./types";

export type SubAgentRunEntry = {
  runId: string;
  parentConversationId?: string;
  controller: AbortController;
  startedAt: number;
};

const active = new Map<string, SubAgentRunEntry>();
const waiters: Array<{
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}> = [];

function tryWakeWaiters() {
  while (
    waiters.length > 0 &&
    active.size < MAX_CONCURRENT_SUBAGENT_RUNS
  ) {
    const next = waiters.shift();
    if (!next) break;
    if (next.signal?.aborted) {
      next.reject(
        new DOMException("The operation was aborted", "AbortError"),
      );
      continue;
    }
    // 调用方在 acquire 返回后再 register；此处只放行
    next.resolve(() => {
      /* release 由 register/unregister 管理；占位 no-op */
    });
  }
}

/**
 * 等待空闲槽（不注册）。返回后应立刻 registerSubagentRun。
 * 若 signal 中止则 reject AbortError。
 */
export function waitForSubagentSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException("The operation was aborted", "AbortError"),
    );
  }
  if (active.size < MAX_CONCURRENT_SUBAGENT_RUNS) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const entry = {
      resolve: () => resolve(),
      reject,
      signal,
      onAbort: undefined as (() => void) | undefined,
    };
    entry.onAbort = () => {
      const idx = waiters.indexOf(entry);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    if (signal) {
      signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    waiters.push(entry);
  });
}

export function getActiveSubagentCount(): number {
  return active.size;
}

export function registerSubagentRun(entry: SubAgentRunEntry): boolean {
  if (active.size >= MAX_CONCURRENT_SUBAGENT_RUNS && !active.has(entry.runId)) {
    return false;
  }
  active.set(entry.runId, entry);
  return true;
}

export function unregisterSubagentRun(runId: string): void {
  if (!active.delete(runId)) return;
  tryWakeWaiters();
}

/** 父会话中止时级联取消其名下子 run */
export function abortSubagentsForConversation(
  conversationId: string | undefined | null,
): void {
  if (!conversationId) return;
  for (const entry of active.values()) {
    if (entry.parentConversationId === conversationId) {
      if (!entry.controller.signal.aborted) {
        entry.controller.abort();
      }
    }
  }
}

/** 测试：清空 */
export function resetSubagentConcurrencyForTests(): void {
  for (const entry of active.values()) {
    if (!entry.controller.signal.aborted) {
      entry.controller.abort();
    }
  }
  active.clear();
  while (waiters.length) {
    const w = waiters.shift();
    w?.reject(new DOMException("The operation was aborted", "AbortError"));
  }
}

/** 诊断：列出活跃 runId */
export function listActiveSubagentRunIds(): string[] {
  return [...active.keys()];
}

/** 合并进度 patch 到快照（不可变） */
export function mergeSubRunSnapshot(
  prev: SubAgentRunSnapshot,
  patch: Partial<SubAgentRunSnapshot>,
): SubAgentRunSnapshot {
  return {
    ...prev,
    ...patch,
    steps: patch.steps ?? prev.steps,
  };
}
