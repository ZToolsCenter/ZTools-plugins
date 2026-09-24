import { useAutomations } from "@/stores/useAutomations";
import { fireAutomation } from "./fire";
import {
  CATCHUP_WINDOW_MS,
  type Automation,
} from "./types";

const POLL_MS = 30_000;

let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
/** 待处理队列（automationId + reason）；fireAutomation 内部全局串行 */
const queue: Array<{ id: string; reason: "schedule" | "catchup" | "manual" }> =
  [];
let draining = false;

function clearWake() {
  if (wakeTimer != null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
}

function clearPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function armWakeToNext() {
  clearWake();
  const now = Date.now();
  const enabled = useAutomations
    .getState()
    .listAutomations()
    .filter((a) => a.enabled && a.nextRunAt != null && a.nextRunAt > now);
  if (enabled.length === 0) return;
  let earliest = Infinity;
  for (const a of enabled) {
    if (a.nextRunAt != null && a.nextRunAt < earliest) {
      earliest = a.nextRunAt;
    }
  }
  if (!Number.isFinite(earliest)) return;
  // 最多等到 POLL_MS，避免长 sleep 漏 tick；并加 50ms 缓冲
  const delay = Math.min(Math.max(earliest - now + 50, 50), POLL_MS);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void tick();
  }, delay);
}

function enqueue(
  id: string,
  reason: "schedule" | "catchup" | "manual",
) {
  if (queue.some((q) => q.id === id)) return;
  queue.push({ id, reason });
  void drainQueue();
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      try {
        await fireAutomation(next.id, { reason: next.reason });
      } catch {
        // fire 内部已记 run / toast
      }
    }
  } finally {
    draining = false;
    armWakeToNext();
  }
}

/**
 * 启动时补跑：7 天内、每任务最多 1 次 catch-up。
 * 将 nextRunAt 已过的 enabled 任务入队 reason=catchup，
 * 并先推进 nextRunAt 避免重复补。
 */
export function reconcileMissed(now = Date.now()): string[] {
  const store = useAutomations.getState();
  const windowStart = now - CATCHUP_WINDOW_MS;
  const catchupIds: string[] = [];

  for (const auto of store.listAutomations()) {
    if (!auto.enabled) continue;
    if (auto.nextRunAt == null) continue;
    if (auto.nextRunAt > now) continue;
    // 超出 7 天窗口：只推进 next，不补跑
    if (auto.nextRunAt < windowStart) {
      store.recomputeNextRun(auto.id, now);
      continue;
    }
    // 仍在跑则跳过补跑
    if (store.isInFlight(auto.id)) {
      store.recomputeNextRun(auto.id, now);
      continue;
    }
    catchupIds.push(auto.id);
    // 先推进 next，避免 tick 再次 due
    store.recomputeNextRun(auto.id, now);
    enqueue(auto.id, "catchup");
  }

  return catchupIds;
}

function collectDue(now: number): Automation[] {
  return useAutomations.getState().getDueAutomations(now);
}

async function tick() {
  const now = Date.now();
  const due = collectDue(now);
  for (const auto of due) {
    // 推进 next 再 fire，避免 30s 内重复 due
    useAutomations.getState().recomputeNextRun(auto.id, now);
    enqueue(auto.id, "schedule");
  }
  armWakeToNext();
}

/**
 * 启动应用内调度器（幂等）。
 * 插件打开时调用；先 reconcileMissed，再 30s poll + sleep-to-next。
 */
export function startAutomationScheduler(): void {
  if (started) return;
  started = true;
  reconcileMissed();
  void tick();
  pollTimer = setInterval(() => {
    void tick();
  }, POLL_MS);
}

/** 停止调度器（测试 / 卸载） */
export function stopAutomationScheduler(): void {
  started = false;
  clearPoll();
  clearWake();
  queue.length = 0;
  draining = false;
}

/** 是否已启动 */
export function isAutomationSchedulerStarted(): boolean {
  return started;
}

/** 测试：重置串行状态 */
export function resetAutomationSchedulerForTests(): void {
  stopAutomationScheduler();
}
