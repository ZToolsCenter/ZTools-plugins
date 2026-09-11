import type { PermissionMode } from "@/lib/agent/permission";

/**
 * 定时任务默认权限：完整权限（含 shell / runCommand）。
 * 与对话 Composer 的 DEFAULT_PERMISSION_MODE（工作区读写）分开，互不影响。
 */
export const DEFAULT_AUTOMATION_PERMISSION_MODE: PermissionMode = "full-access";

/** 调度预设（与 croner 计算 nextRunAt） */
export type Schedule =
  | { kind: "manual" }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; dayOfWeek: number; hour: number; minute: number }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "once"; atMs: number }
  | { kind: "cron"; expression: string };

export type AutomationRunStatus =
  | "running"
  | "success"
  | "error"
  | "skipped";

export type AutomationFireReason = "schedule" | "manual" | "catchup";

/** 定时任务（产品名：定时任务；内部类型 Automation） */
export interface Automation {
  id: string;
  name: string;
  prompt: string;
  /**
   * 绑定工作区；可空（null = 不选择工作区，等同快速对话工具面）。
   * 有值时一任务一 workspace。
   */
  workspaceId: string | null;
  schedule: Schedule;
  enabled: boolean;
  /** 默认 full-access（见 DEFAULT_AUTOMATION_PERMISSION_MODE） */
  permissionMode: PermissionMode;
  /** 下次计划触发（ms）；manual / 无下一档为 null */
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: AutomationRunStatus | null;
  consecutiveFailures: number;
  createdAt: number;
  updatedAt: number;
  /** IANA 时区；缺省用系统 / Asia/Shanghai */
  timeZone?: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  conversationId: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: AutomationRunStatus;
  reason: AutomationFireReason;
  error?: string;
}

export type CreateAutomationInput = {
  name: string;
  prompt: string;
  /** null / 缺省 = 不选择工作区 */
  workspaceId?: string | null;
  schedule: Schedule;
  enabled?: boolean;
  permissionMode?: PermissionMode;
  timeZone?: string;
};

export type UpdateAutomationInput = Partial<
  Pick<
    Automation,
    | "name"
    | "prompt"
    | "workspaceId"
    | "schedule"
    | "enabled"
    | "permissionMode"
    | "timeZone"
  >
>;

/** 单任务最多保留 run 条数 */
export const MAX_RUNS_PER_AUTOMATION = 50;
/** 全局 run 上限 */
export const MAX_RUNS_GLOBAL = 500;
/** 错过补跑窗口：7 天 */
export const CATCHUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 连续失败达此数自动禁用 */
export const MAX_CONSECUTIVE_FAILURES = 3;
/** interval 最短 5 分钟 */
export const MIN_INTERVAL_MINUTES = 5;
