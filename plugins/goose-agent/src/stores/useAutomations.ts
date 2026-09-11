import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  isPermissionMode,
  type PermissionMode,
} from "@/lib/agent/permission";
import {
  computeNextRunAt,
  defaultTimeZone,
} from "@/lib/automations/schedule";
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  CreateAutomationInput,
  Schedule,
  UpdateAutomationInput,
} from "@/lib/automations/types";
import {
  DEFAULT_AUTOMATION_PERMISSION_MODE,
  MAX_RUNS_GLOBAL,
  MAX_RUNS_PER_AUTOMATION,
} from "@/lib/automations/types";
import { gaStateStorage } from "@/stores/settings/gaStorage";

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeSchedule(value: unknown): Schedule | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "manual":
      return { kind: "manual" };
    case "daily":
      return {
        kind: "daily",
        hour: Number(value.hour) || 0,
        minute: Number(value.minute) || 0,
      };
    case "weekdays":
      return {
        kind: "weekdays",
        hour: Number(value.hour) || 0,
        minute: Number(value.minute) || 0,
      };
    case "weekly":
      return {
        kind: "weekly",
        dayOfWeek: Number(value.dayOfWeek) || 0,
        hour: Number(value.hour) || 0,
        minute: Number(value.minute) || 0,
      };
    case "interval":
      return {
        kind: "interval",
        everyMinutes: Number(value.everyMinutes) || 5,
      };
    case "once":
      return {
        kind: "once",
        atMs: Number(value.atMs) || 0,
      };
    case "cron":
      return {
        kind: "cron",
        expression: typeof value.expression === "string" ? value.expression : "",
      };
    default:
      return null;
  }
}

function normalizePermissionMode(value: unknown): PermissionMode {
  return isPermissionMode(value) ? value : DEFAULT_AUTOMATION_PERMISSION_MODE;
}

function normalizeRunStatus(value: unknown): AutomationRunStatus | null {
  if (
    value === "running" ||
    value === "success" ||
    value === "error" ||
    value === "skipped"
  ) {
    return value;
  }
  return null;
}

function normalizeAutomation(
  value: unknown,
  fallbackId: string,
): Automation | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : fallbackId;
  const name = typeof value.name === "string" ? value.name : "";
  const prompt = typeof value.prompt === "string" ? value.prompt : "";
  const workspaceId =
    typeof value.workspaceId === "string" && value.workspaceId.trim()
      ? value.workspaceId.trim()
      : null;
  const schedule = normalizeSchedule(value.schedule);
  if (!schedule) return null;
  const now = Date.now();
  const nextRunAt =
    typeof value.nextRunAt === "number" && Number.isFinite(value.nextRunAt)
      ? value.nextRunAt
      : value.nextRunAt === null
        ? null
        : null;
  const lastRunAt =
    typeof value.lastRunAt === "number" && Number.isFinite(value.lastRunAt)
      ? value.lastRunAt
      : null;
  return {
    id,
    name,
    prompt,
    workspaceId,
    schedule,
    enabled: value.enabled !== false,
    permissionMode: normalizePermissionMode(value.permissionMode),
    nextRunAt,
    lastRunAt,
    lastRunStatus: normalizeRunStatus(value.lastRunStatus),
    consecutiveFailures:
      typeof value.consecutiveFailures === "number" &&
      Number.isFinite(value.consecutiveFailures)
        ? Math.max(0, Math.floor(value.consecutiveFailures))
        : 0,
    createdAt: normalizeTimestamp(value.createdAt, now),
    updatedAt: normalizeTimestamp(value.updatedAt, now),
    timeZone:
      typeof value.timeZone === "string" && value.timeZone.trim()
        ? value.timeZone.trim()
        : undefined,
  };
}

function normalizeRun(value: unknown, fallbackId: string): AutomationRun | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : fallbackId;
  const automationId =
    typeof value.automationId === "string" ? value.automationId : "";
  if (!automationId) return null;
  const status = normalizeRunStatus(value.status) ?? "error";
  const reason =
    value.reason === "schedule" ||
    value.reason === "manual" ||
    value.reason === "catchup"
      ? value.reason
      : "schedule";
  return {
    id,
    automationId,
    conversationId:
      typeof value.conversationId === "string"
        ? value.conversationId
        : value.conversationId === null
          ? null
          : null,
    startedAt: normalizeTimestamp(value.startedAt, Date.now()),
    finishedAt:
      typeof value.finishedAt === "number" && Number.isFinite(value.finishedAt)
        ? value.finishedAt
        : null,
    status,
    reason,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

function pruneRuns(runs: AutomationRun[]): AutomationRun[] {
  // 全局按 startedAt 降序截断
  let sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  if (sorted.length > MAX_RUNS_GLOBAL) {
    sorted = sorted.slice(0, MAX_RUNS_GLOBAL);
  }
  // 每任务最多 MAX_RUNS_PER_AUTOMATION
  const counts = new Map<string, number>();
  const kept: AutomationRun[] = [];
  for (const run of sorted) {
    const n = counts.get(run.automationId) ?? 0;
    if (n >= MAX_RUNS_PER_AUTOMATION) continue;
    counts.set(run.automationId, n + 1);
    kept.push(run);
  }
  return kept;
}

function resolveTz(auto: Pick<Automation, "timeZone">): string {
  return auto.timeZone?.trim() || defaultTimeZone();
}

export interface AutomationsState {
  automations: Record<string, Automation>;
  runs: AutomationRun[];
  /** 当前正在跑的 automationId → conversationId（内存，不持久化） */
  inFlight: Record<string, string>;

  listAutomations: () => Automation[];
  getAutomation: (id: string) => Automation | undefined;
  create: (input: CreateAutomationInput) => string;
  update: (id: string, patch: UpdateAutomationInput) => void;
  remove: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  recomputeNextRun: (id: string, fromMs?: number) => void;
  getDueAutomations: (now?: number) => Automation[];
  listRuns: (automationId: string) => AutomationRun[];
  recordRun: (run: AutomationRun) => void;
  patchRun: (
    runId: string,
    patch: Partial<
      Pick<
        AutomationRun,
        "status" | "finishedAt" | "error" | "conversationId"
      >
    >,
  ) => void;
  applyRunOutcome: (
    automationId: string,
    outcome: {
      status: AutomationRunStatus;
      atMs?: number;
    },
  ) => void;
  setInFlight: (automationId: string, conversationId: string | null) => void;
  isInFlight: (automationId: string) => boolean;
  getInFlightConversationId: (automationId: string) => string | null;
}

/**
 * 定时任务 store。
 * 持久化名 `automations` → 物理 `ga:automations`（含 automations + runs）。
 */
export const useAutomations = create<AutomationsState>()(
  persist(
    (set, get) => ({
      automations: {},
      runs: [],
      inFlight: {},

      listAutomations: () => {
        return Object.values(get().automations).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
      },

      getAutomation: (id) => get().automations[id],

      create: (input) => {
        const now = Date.now();
        const id = createId("auto");
        const schedule = input.schedule;
        const timeZone = input.timeZone?.trim() || defaultTimeZone();
        const nextRunAt = computeNextRunAt(schedule, now, timeZone);
        const workspaceId =
          typeof input.workspaceId === "string" && input.workspaceId.trim()
            ? input.workspaceId.trim()
            : null;
        const auto: Automation = {
          id,
          name: input.name.trim() || "未命名任务",
          prompt: input.prompt ?? "",
          workspaceId,
          schedule,
          enabled: input.enabled !== false,
          permissionMode: isPermissionMode(input.permissionMode)
            ? input.permissionMode
            : DEFAULT_AUTOMATION_PERMISSION_MODE,
          nextRunAt,
          lastRunAt: null,
          lastRunStatus: null,
          consecutiveFailures: 0,
          createdAt: now,
          updatedAt: now,
          timeZone,
        };
        set((s) => ({
          automations: { ...s.automations, [id]: auto },
        }));
        return id;
      },

      update: (id, patch) => {
        set((s) => {
          const existing = s.automations[id];
          if (!existing) return s;
          const now = Date.now();
          const next: Automation = {
            ...existing,
            ...(patch.name !== undefined
              ? { name: patch.name.trim() || existing.name }
              : {}),
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
            ...(patch.workspaceId !== undefined
              ? {
                  workspaceId:
                    typeof patch.workspaceId === "string" &&
                    patch.workspaceId.trim()
                      ? patch.workspaceId.trim()
                      : null,
                }
              : {}),
            ...(patch.schedule !== undefined
              ? { schedule: patch.schedule }
              : {}),
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.permissionMode !== undefined &&
            isPermissionMode(patch.permissionMode)
              ? { permissionMode: patch.permissionMode }
              : {}),
            ...(patch.timeZone !== undefined
              ? {
                  timeZone: patch.timeZone?.trim() || defaultTimeZone(),
                }
              : {}),
            updatedAt: now,
          };
          if (patch.schedule !== undefined || patch.timeZone !== undefined) {
            next.nextRunAt = computeNextRunAt(
              next.schedule,
              now,
              resolveTz(next),
            );
          }
          return {
            automations: { ...s.automations, [id]: next },
          };
        });
      },

      remove: (id) => {
        set((s) => {
          if (!s.automations[id]) return s;
          const automations = { ...s.automations };
          delete automations[id];
          const inFlight = { ...s.inFlight };
          delete inFlight[id];
          const runs = s.runs.filter((r) => r.automationId !== id);
          return { automations, runs, inFlight };
        });
      },

      setEnabled: (id, enabled) => {
        set((s) => {
          const existing = s.automations[id];
          if (!existing || existing.enabled === enabled) return s;
          const now = Date.now();
          const next: Automation = {
            ...existing,
            enabled,
            updatedAt: now,
          };
          if (enabled) {
            next.nextRunAt = computeNextRunAt(
              next.schedule,
              now,
              resolveTz(next),
            );
            next.consecutiveFailures = 0;
          }
          return {
            automations: { ...s.automations, [id]: next },
          };
        });
      },

      recomputeNextRun: (id, fromMs) => {
        set((s) => {
          const existing = s.automations[id];
          if (!existing) return s;
          const from = fromMs ?? Date.now();
          const nextRunAt = computeNextRunAt(
            existing.schedule,
            from,
            resolveTz(existing),
          );
          return {
            automations: {
              ...s.automations,
              [id]: {
                ...existing,
                nextRunAt,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      getDueAutomations: (now = Date.now()) => {
        return Object.values(get().automations).filter((a) => {
          if (!a.enabled) return false;
          if (a.nextRunAt == null) return false;
          return a.nextRunAt <= now;
        });
      },

      listRuns: (automationId) => {
        return get()
          .runs.filter((r) => r.automationId === automationId)
          .sort((a, b) => b.startedAt - a.startedAt);
      },

      recordRun: (run) => {
        set((s) => ({
          runs: pruneRuns([run, ...s.runs]),
        }));
      },

      patchRun: (runId, patch) => {
        set((s) => {
          const idx = s.runs.findIndex((r) => r.id === runId);
          if (idx < 0) return s;
          const prev = s.runs[idx]!;
          const next = [...s.runs];
          next[idx] = { ...prev, ...patch };
          return { runs: next };
        });
      },

      applyRunOutcome: (automationId, outcome) => {
        set((s) => {
          const existing = s.automations[automationId];
          if (!existing) return s;
          const at = outcome.atMs ?? Date.now();
          let consecutiveFailures = existing.consecutiveFailures;
          let enabled = existing.enabled;
          if (outcome.status === "success") {
            consecutiveFailures = 0;
            // once 成功后禁用
            if (existing.schedule.kind === "once") {
              enabled = false;
            }
          } else if (outcome.status === "error") {
            consecutiveFailures += 1;
          }
          // skipped 不计入连续失败

          const kind = existing.schedule.kind;
          const finalNext =
            !enabled || kind === "manual" || kind === "once"
              ? null
              : computeNextRunAt(existing.schedule, at, resolveTz(existing));

          return {
            automations: {
              ...s.automations,
              [automationId]: {
                ...existing,
                lastRunAt: at,
                lastRunStatus: outcome.status,
                consecutiveFailures,
                enabled,
                nextRunAt: finalNext,
                updatedAt: at,
              },
            },
          };
        });
      },

      setInFlight: (automationId, conversationId) => {
        set((s) => {
          if (conversationId == null) {
            if (!(automationId in s.inFlight)) return s;
            const next = { ...s.inFlight };
            delete next[automationId];
            return { inFlight: next };
          }
          return {
            inFlight: { ...s.inFlight, [automationId]: conversationId },
          };
        });
      },

      isInFlight: (automationId) => Boolean(get().inFlight[automationId]),

      getInFlightConversationId: (automationId) =>
        get().inFlight[automationId] ?? null,
    }),
    {
      name: "automations",
      version: 1,
      storage: createJSONStorage(() => gaStateStorage),
      partialize: (state) => ({
        automations: state.automations,
        runs: state.runs,
      }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as {
                automations?: unknown;
                runs?: unknown;
              })
            : {};

        const automations: Record<string, Automation> = {};
        if (isRecord(raw.automations)) {
          for (const [id, value] of Object.entries(raw.automations)) {
            const auto = normalizeAutomation(value, id);
            if (auto) automations[auto.id] = auto;
          }
        }

        const runs: AutomationRun[] = [];
        if (Array.isArray(raw.runs)) {
          for (let i = 0; i < raw.runs.length; i++) {
            const run = normalizeRun(raw.runs[i], `run-migrate-${i}`);
            if (run) runs.push(run);
          }
        }

        return {
          ...current,
          automations,
          runs: pruneRuns(runs),
          inFlight: {},
        };
      },
    },
  ),
);

/** 新建 run id */
export function createAutomationRunId(): string {
  return createId("arun");
}

/** 测试重置 */
export function resetAutomationsForTests() {
  useAutomations.setState({
    automations: {},
    runs: [],
    inFlight: {},
  });
}
