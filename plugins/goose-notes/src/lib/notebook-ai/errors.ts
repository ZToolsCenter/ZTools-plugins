const BATCH_PLAN_SCHEMA_ERROR =
  "计划格式生成失败，AI 已停止执行。已执行 0 项，且没有写入。请重试，或切换模型后再试。";
const BATCH_PLAN_BUSINESS_ERROR =
  "计划无法执行，已执行 0 项且没有写入。请调整目标后重试。";
const BATCH_PLAN_EXECUTION_ERROR =
  "执行未完成，已尝试恢复。请检查相关页面后重试。";
const UNDO_ERROR = "撤回失败，页面可能已发生变化。请检查页面后重试。";
const DEFAULT_ERROR = "本轮请求失败，请稍后重试。";

function toText(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message.trim() : "";
  }
  return "";
}

/** 同一原因被分号叠多遍时只保留一条；多种原因按条列出。 */
export function collapseRepeatedErrorSegments(message: string): string {
  const text = message.trim();
  if (!text) return "";
  const parts = text
    .split("；")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part);
  }
  if (unique.length === parts.length) return text;
  if (unique.length === 1) return unique[0];
  return unique.map((part, index) => `${index + 1}. ${part}`).join("\n");
}

export function formatBatchPlanErrors(errors: string[]): string {
  const unique: string[] = [];
  for (const error of errors) {
    const text = collapseRepeatedErrorSegments(error);
    if (text && !unique.includes(text)) unique.push(text);
  }
  if (unique.length <= 1) return unique[0] ?? "";
  return unique.map((text, index) => `${index + 1}. ${text}`).join("\n");
}

export function isNotebookAiBatchPlanSchemaError(error: unknown): boolean {
  const message = toText(error).toLowerCase();
  if (!message) return false;
  return [
    "zod",
    "schema",
    "invalid tool",
    "tool call",
    "tool arguments",
    "validation error",
    "invalid input",
    "expected object",
    "received null",
  ].some((token) => message.includes(token));
}

export function isNotebookAiBatchPlanBusinessError(error: unknown): boolean {
  const message = toText(error).toLowerCase();
  return Boolean(message) && !isNotebookAiBatchPlanSchemaError(message);
}

function batchBusinessMessage(message: string): string {
  if (message.includes("本地文件夹")) {
    return "当前批量计划不支持本地文件夹页面的该操作，已执行 0 项且没有写入。";
  }
  if (
    message.includes("父级不存在") ||
    (message.includes("父级") && message.includes("不属于"))
  ) {
    return "新页面的父级不可用，已执行 0 项且没有写入。请换一个有效父页面后重试。";
  }
  if (
    message.includes("删除目标不存在") ||
    message.includes("不属于当前笔记本")
  ) {
    return "计划目标不可用或不属于当前笔记本，已执行 0 项且没有写入。请检查目标后重试。";
  }
  if (message.includes("至少选择一项")) {
    return "请至少选择一项操作后重试；当前没有写入。";
  }
  if (message.includes("参数不完整")) {
    return "计划内容不完整，已执行 0 项且没有写入。请让 AI 重新生成计划。";
  }
  return BATCH_PLAN_BUSINESS_ERROR;
}

export function formatNotebookAiError(
  error: unknown,
  options: {
    phase?: "prepare" | "execute" | "undo" | "chat";
  } = {},
): string {
  const message = collapseRepeatedErrorSegments(toText(error));
  const phase = options.phase ?? "chat";
  if (phase === "execute") {
    if (message.includes("页面内容已发生变化")) {
      return "页面内容已发生变化，为避免覆盖新的编辑，本次写入已取消";
    }
    return BATCH_PLAN_EXECUTION_ERROR;
  }
  if (phase === "undo") return UNDO_ERROR;
  if (phase === "prepare") {
    if (isNotebookAiBatchPlanSchemaError(message))
      return BATCH_PLAN_SCHEMA_ERROR;
    return batchBusinessMessage(message);
  }
  if (!message) return DEFAULT_ERROR;
  const lower = message.toLowerCase();
  if (
    lower.includes("api key required") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("authentication")
  ) {
    return "无法通过 AI 服务鉴权。请到「设置 → AI 助手」检查 API Key 与 Base URL。";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed") ||
    lower.includes("timeout")
  ) {
    return "无法连接 AI 服务。请检查 Base URL、网络或代理是否可达。";
  }
  if (
    lower.includes("responses") &&
    (lower.includes("404") ||
      lower.includes("not found") ||
      lower.includes("not supported"))
  ) {
    return "当前 AI 协议无法访问 Responses 接口，请确认服务端兼容 /v1/responses。";
  }
  return DEFAULT_ERROR;
}

export const NOTEBOOK_AI_BATCH_PLAN_SCHEMA_ERROR = BATCH_PLAN_SCHEMA_ERROR;
export const NOTEBOOK_AI_BATCH_PLAN_BUSINESS_ERROR = BATCH_PLAN_BUSINESS_ERROR;
export const NOTEBOOK_AI_BATCH_PLAN_EXECUTION_ERROR =
  BATCH_PLAN_EXECUTION_ERROR;
