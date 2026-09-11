/**
 * 判断持久化工具调用是否为可恢复的普通对象。
 * @param {unknown} value 待校验的工具调用值。
 * @returns {boolean} 是否为非数组对象。
 */
function isToolCallRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 清理会话消息中的稀疏或空工具调用，兼容旧版本已经写入的 null 项。
 * @param {unknown} value 原始会话消息列表。
 * @returns {Array<Record<string, unknown>>} 工具列表可安全遍历的会话消息。
 */
function normalizeConversationMessages(value) {
  return (Array.isArray(value) ? value : []).map((message) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.tool_calls)) {
      return message;
    }
    const toolCalls = message.tool_calls.filter(isToolCallRecord);
    return toolCalls.length === message.tool_calls.length
      ? message
      : { ...message, tool_calls: toolCalls };
  });
}

module.exports = { normalizeConversationMessages };
