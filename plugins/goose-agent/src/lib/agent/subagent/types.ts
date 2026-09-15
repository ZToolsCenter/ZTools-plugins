/**
 * 子代理（Subagent）运行快照与工具入参类型。
 * 持久化落在 AgentToolPart.subRun；父模型仅收 summary。
 */

import type { AgentTokenUsage } from "../usage";

export type SubAgentStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled";

export type SubAgentReasoningLevel = "low" | "medium" | "high";

/** 子 run 内部一步 tool（轻量，供折叠卡 / 轨迹） */
export type SubAgentToolStep = {
  id: string;
  name: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/**
 * 子代理 run 快照（启动时冻结模型 / 思考长度，不跟 Composer 事后改动）。
 * depth：1 = 根 turn 直接派发；2 = 再嵌套一层（叶节点禁再派发）。
 */
export type SubAgentRunSnapshot = {
  runId: string;
  /** 展示名（用户/模型给定或默认「子代理」） */
  name: string;
  task: string;
  modelId: string;
  reasoningLevel: SubAgentReasoningLevel;
  status: SubAgentStatus;
  depth: number;
  startedAt: number;
  endedAt?: number;
  /** 当前正在执行的工具名 */
  currentTool?: string | null;
  steps: SubAgentToolStep[];
  summary?: string;
  errorText?: string;
  /** 子 turn 累计 token usage（不写入父会话 recordTurnUsage） */
  usage?: AgentTokenUsage;
  /** 运行中的 partial 文本（可选，节流写） */
  liveText?: string;
};

/** runSubagent / task 工具入参 */
export type RunSubagentInput = {
  /** 交给子代理的任务说明（必填） */
  task: string;
  /** 展示名 */
  name?: string;
  /** 覆盖模型 id；缺省继承父 turn 快照 */
  modelId?: string;
  /** 覆盖思考长度；缺省继承父 turn 快照 */
  reasoningLevel?: SubAgentReasoningLevel;
};

/** 父模型可见的工具结果（不含完整 steps） */
export type RunSubagentResult = {
  ok: boolean;
  name?: string;
  summary?: string;
  status?: SubAgentStatus;
  error?: string;
  runId?: string;
};

export const MAX_SUBAGENT_DEPTH = 2;
export const MAX_CONCURRENT_SUBAGENT_RUNS = 3;

export const RUN_SUBAGENT_TOOL_NAME = "runSubagent" as const;
/** 兼容别名：部分模型可能叫 task */
export const RUN_SUBAGENT_TOOL_ALIASES = ["runSubagent", "task"] as const;

export function isRunSubagentToolName(name: string): boolean {
  return (
    name === "runSubagent" ||
    name === "task" ||
    name === "tool-runSubagent" ||
    name === "tool-task"
  );
}

export function normalizeReasoningLevel(
  value: unknown,
  fallback: SubAgentReasoningLevel = "medium",
): SubAgentReasoningLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (value === "default") return "medium";
  return fallback;
}

export function parseRunSubagentInput(
  input: Record<string, unknown>,
): { ok: true; value: RunSubagentInput } | { ok: false; error: string } {
  const taskRaw =
    typeof input.task === "string"
      ? input.task
      : typeof input.prompt === "string"
        ? input.prompt
        : typeof input.instruction === "string"
          ? input.instruction
          : "";
  const task = taskRaw.trim();
  if (!task) {
    return { ok: false, error: "runSubagent 需要非空 task" };
  }
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : typeof input.title === "string" && input.title.trim()
        ? input.title.trim()
        : undefined;
  const modelId =
    typeof input.modelId === "string" && input.modelId.trim()
      ? input.modelId.trim()
      : typeof input.model === "string" && input.model.trim()
        ? input.model.trim()
        : undefined;
  let reasoningLevel: SubAgentReasoningLevel | undefined;
  if (
    input.reasoningLevel === "low" ||
    input.reasoningLevel === "medium" ||
    input.reasoningLevel === "high"
  ) {
    reasoningLevel = input.reasoningLevel;
  } else if (
    input.thinking === "low" ||
    input.thinking === "medium" ||
    input.thinking === "high"
  ) {
    reasoningLevel = input.thinking;
  }
  return {
    ok: true,
    value: { task, name, modelId, reasoningLevel },
  };
}
