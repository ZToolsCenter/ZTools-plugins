import {
  getToolProgressStepStatus,
  getToolProgressStepText,
  type ProgressStep,
  type ToolProgressPart,
} from "./toolProgressModel";

export type LoaderChipStatus = "pending" | "running" | "done" | "error";
export type LoaderTaskStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "failed";
export type ThinkingTraceVariant = "Steps" | "Reasoning" | "Search" | "Coding";

export type ToolChipView = {
  id: string;
  name: string;
  status: LoaderChipStatus;
  label: string;
};

export type ToolTaskRowView = {
  id: string;
  title: string;
  status: LoaderTaskStatus;
  detail?: string;
};

export type ThinkingTraceView = {
  variant: ThinkingTraceVariant;
  activeLabel: string;
  doneLabel: string;
  rows: { primary: string; secondary?: string }[];
};

export type ThinkingTraceStepInput = {
  label: string;
  detail?: string;
  status?: ProgressStep["status"] | string;
};

function chipStatusFromStep(
  status: ProgressStep["status"],
): LoaderChipStatus {
  if (status === "waiting") return "pending";
  return status;
}

function taskStatusFromStep(
  status: ProgressStep["status"],
): LoaderTaskStatus {
  if (status === "waiting") return "pending";
  if (status === "error") return "failed";
  return status;
}

function partId(part: ToolProgressPart, index: number): string {
  return part.toolCallId?.trim() || `${part.type}:${index}`;
}

/** LoadingState 等宽耗时：<60s 用 `12.3s`，否则 `1m 2.3s` */
export function formatLoaderElapsed(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function mapToolPartsToChips(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
): ToolChipView[] {
  return parts.map((part, index) => {
    const text = getToolProgressStepText(part);
    return {
      id: partId(part, index),
      name: text.label,
      status: chipStatusFromStep(
        getToolProgressStepStatus(part, isMessageStreaming),
      ),
      label: text.detail,
    };
  });
}

export function mapToolPartsToTaskRows(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
): ToolTaskRowView[] {
  return parts.map((part, index) => {
    const text = getToolProgressStepText(part);
    const status = getToolProgressStepStatus(part, isMessageStreaming);
    return {
      id: partId(part, index),
      title: text.label,
      status: taskStatusFromStep(status),
      detail:
        status === "waiting"
          ? "本步骤未完成，可能已被本轮生成跳过。"
          : text.detail,
    };
  });
}

function inferThinkingVariant(
  steps: ThinkingTraceStepInput[],
): ThinkingTraceVariant {
  const haystack = steps
    .map((step) => `${step.label} ${step.detail ?? ""}`)
    .join("\n");
  if (/搜索|联网|查找|检索/.test(haystack)) return "Search";
  if (/写入|创建|修改|追加|替换|重命名|删除|代码|命令/.test(haystack))
    return "Coding";
  if (/思考|推理|分析/.test(haystack)) return "Reasoning";
  return "Steps";
}

export function mapStepsToThinkingTrace(
  steps: ThinkingTraceStepInput[],
  elapsedMs: number,
): ThinkingTraceView {
  const variant = inferThinkingVariant(steps);
  const elapsed = formatLoaderElapsed(Math.max(0, elapsedMs));
  const activeLabel =
    variant === "Search"
      ? "正在搜索"
      : variant === "Coding"
        ? "正在运行工具"
        : variant === "Reasoning"
          ? "思考中"
          : "处理中";
  const doneLabel =
    variant === "Search"
      ? "已搜索"
      : variant === "Coding"
        ? `已运行 ${steps.length} 个工具`
        : variant === "Reasoning"
          ? `思考了 ${elapsed}`
          : `处理了 ${elapsed}`;

  return {
    variant,
    activeLabel,
    doneLabel,
    rows: steps.map((step) => ({
      primary: step.label,
      ...(step.detail ? { secondary: step.detail } : {}),
    })),
  };
}

/** 真值立即亮；假值可被 held 粘住。对应 useMinHoldActive 的可见性合成。 */
export function resolveLoaderHold(active: boolean, held: boolean): boolean {
  return active || held;
}
