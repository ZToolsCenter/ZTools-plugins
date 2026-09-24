/**
 * 行内 AI 菜单错误文案。xl-ai 流式 update 在块 id 失效时会抛
 * `Tool execution failed: block not found`。
 */
export function isMissingTargetBlockError(error: unknown): boolean {
  const message = toErrorText(error).toLowerCase();
  if (!message) return false;
  return (
    message.includes("block not found") ||
    message.includes("找不到块") ||
    message.includes("目标块已不在")
  );
}

export function formatAiMenuError(error: unknown): string {
  const message = toErrorText(error);
  if (!message) return "";

  if (isMissingTargetBlockError(message)) {
    return "替换中断：目标块已变化，已恢复原文。请再试一次";
  }
  if (/tool_choice|Thinking mode/i.test(message)) {
    return "当前模型的思考模式不支持强制工具调用，请换非思考模型或关闭思考后再试";
  }
  if (
    /\b401\b|\b403\b|unauthorized|forbidden|invalid.?api.?key|api.?key.*(invalid|missing|required)|incorrect.?api.?key|authentication/i.test(
      message,
    )
  ) {
    return "密钥无效或未配置";
  }
  if (
    /network|fetch failed|failed to fetch|load failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|timeout|网路|网络/i.test(
      message,
    )
  ) {
    return "网络请求失败，请检查网络或 Base URL";
  }
  if (/abort|cancel|停止/i.test(message)) {
    return "已停止";
  }
  if (/invalid json response/i.test(message)) {
    return "模型返回格式异常，请换模型或稍后再试";
  }
  return message;
}

function toErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error != null) {
    const text = String(error);
    if (text && text !== "[object Object]") return text;
  }
  return "";
}
