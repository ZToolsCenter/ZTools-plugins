/**
 * 判断工具调用值是否为可渲染和可执行的对象。
 * @param {unknown} value 待校验的工具调用值。
 * @returns {boolean} 是否为非数组对象。
 */
function isToolCallRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 将工具调用列表压缩为不含稀疏空位或空值的连续数组。
 * @param {unknown} value 原始工具调用列表。
 * @returns {Array<Record<string, unknown>>} 可安全遍历的连续工具调用列表。
 */
export function normalizeToolCalls(value) {
  const calls = Array.isArray(value) ? value : [];
  // filter 会跳过稀疏空位，同时清理 JSON 恢复后形成的显式 null。
  return calls.filter(isToolCallRecord);
}

/**
 * 将一项宿主工具调用增量合并到连续展示列表中。
 * @param {Array<Record<string, unknown>>} toolCalls 当前助手消息的连续工具列表。
 * @param {Map<number|string, Record<string, unknown>>} slots 宿主流索引到工具对象的映射。
 * @param {Record<string, unknown>} event 宿主发送的工具调用增量事件。
 * @param {{makeId: () => string, parseArguments: (value: string) => Record<string, unknown>}} helpers 标识与参数解析依赖。
 * @returns {Record<string, unknown>} 已创建或更新的工具调用对象。
 */
export function applyStreamingToolCallDelta(toolCalls, slots, event, helpers) {
  // 宿主索引只用于关联分片，工具对象始终通过 push 进入连续展示数组。
  const numericIndex = Number(event?.index);
  const streamKey = Number.isInteger(numericIndex) && numericIndex >= 0
    ? numericIndex
    : `id:${String(event?.id || "fallback")}`;
  let call = slots.get(streamKey);
  if (!call) {
    call = {
      id: event?.id || helpers.makeId(),
      name: event?.name || "",
      arguments: "",
      args: {},
      status: "streaming",
      result: "",
    };
    slots.set(streamKey, call);
    toolCalls.push(call);
  }
  if (event?.id) call.id = event.id;
  if (event?.name) call.name = event.name;
  call.arguments += event?.argumentsDelta || "";
  call.args = helpers.parseArguments(call.arguments);
  return call;
}
