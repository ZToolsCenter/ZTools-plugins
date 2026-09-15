/**
 * Beautiful UI 纯映射：tool parts / thinking steps → 原语 props。
 * 状态对齐 ToolProgressCard.getToolProgressStepStatus，不另起状态机。
 */
import {
  getStepText,
  getToolProgressStepStatus,
  type ToolProgressPart,
} from "./ToolProgressCard";

export type BuiChipStatus = "pending" | "running" | "done" | "error";

export type BuiToolChip = {
  id: string;
  name: string;
  status: BuiChipStatus;
  label: string;
};

export type BuiTaskRow = {
  id: string;
  title: string;
  status: BuiChipStatus;
  detail?: string;
};

export type BuiThinkingRow = {
  primary: string;
  secondary?: string;
  mono?: boolean;
  add?: number;
  del?: number;
};

export type BuiThinkingTrace = {
  variant: "Steps" | "Reasoning" | "Search" | "Coding";
  activeLabel: string;
  doneLabel: string;
  rows: BuiThinkingRow[];
};

export type BuiThinkingStep = string | BuiThinkingRow;

/** 最短展示时长，避免 loader 闪一下就没。 */
export const LOADER_MIN_HOLD_MS = 400;

const INPUT_ONLY_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function asFiniteMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms;
}

/**
 * 与 Loading State 文案一致：
 * &lt;60s → `12.3s`，否则 `1m 2.3s`。
 */
export function formatLoaderElapsed(ms: number): string {
  const total = asFiniteMs(ms) / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

export function loaderHoldMs(
  elapsedMs: number,
  minHoldMs = LOADER_MIN_HOLD_MS,
): number {
  return Math.max(0, minHoldMs - asFiniteMs(elapsedMs));
}

export function shouldHoldLoader(
  elapsedMs: number,
  minHoldMs = LOADER_MIN_HOLD_MS,
): boolean {
  return loaderHoldMs(elapsedMs, minHoldMs) > 0;
}

function mapProgressStatus(
  status: "running" | "done" | "error" | "waiting",
): BuiChipStatus {
  if (status === "waiting") return "pending";
  return status;
}

function partId(part: ToolProgressPart, index: number): string {
  return part.toolCallId || `${part.type}-${index}`;
}

export function mapToolPartsToChips(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
  workspaceRoot?: string | null,
): BuiToolChip[] {
  return parts.map((part, index) => {
    const text = getStepText(part, workspaceRoot);
    return {
      id: partId(part, index),
      name: text.label,
      status: mapProgressStatus(
        getToolProgressStepStatus(part, isMessageStreaming),
      ),
      label: text.detail || text.label,
    };
  });
}

export function mapToolPartsToTaskRows(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
  workspaceRoot?: string | null,
): BuiTaskRow[] {
  return parts.map((part, index) => {
    const text = getStepText(part, workspaceRoot);
    const row: BuiTaskRow = {
      id: partId(part, index),
      title: text.label,
      status: mapProgressStatus(
        getToolProgressStepStatus(part, isMessageStreaming),
      ),
    };
    if (text.detail) row.detail = text.detail;
    return row;
  });
}

function normalizeThinkingRow(step: BuiThinkingStep): BuiThinkingRow {
  if (typeof step === "string") return { primary: step };
  return {
    primary: step.primary,
    ...(step.secondary ? { secondary: step.secondary } : {}),
    ...(step.mono ? { mono: true } : {}),
    ...(step.add !== undefined ? { add: step.add } : {}),
    ...(step.del !== undefined ? { del: step.del } : {}),
  };
}

function inferThinkingVariant(
  rows: BuiThinkingRow[],
): BuiThinkingTrace["variant"] {
  if (rows.some((row) => row.add !== undefined || row.del !== undefined)) {
    return "Coding";
  }
  if (rows.some((row) => row.mono)) return "Coding";
  if (rows.some((row) => row.secondary)) return "Steps";
  return "Reasoning";
}

export function mapStepsToThinkingTrace(
  steps: BuiThinkingStep[],
  elapsedMs: number,
): BuiThinkingTrace {
  const rows = steps.map(normalizeThinkingRow);
  const variant = inferThinkingVariant(rows);
  const elapsed = formatLoaderElapsed(elapsedMs);
  const activeLabel =
    variant === "Coding"
      ? "正在运行工具"
      : variant === "Search"
        ? "正在搜索"
        : "思考中";
  const doneLabel =
    variant === "Coding"
      ? elapsedMs > 0
        ? `运行了 ${rows.length} 个工具 · ${elapsed}`
        : `运行了 ${rows.length} 个工具`
      : variant === "Search"
        ? elapsedMs > 0
          ? `已搜索 · ${elapsed}`
          : "已搜索"
        : elapsedMs > 0
          ? `思考了 ${elapsed}`
          : "思考完成";
  return { variant, activeLabel, doneLabel, rows };
}

/** 测试与调用方可复用：input-only 集合与进度卡一致。 */
export function isInputOnlyToolState(state?: string): boolean {
  return INPUT_ONLY_STATES.has(state ?? "");
}
