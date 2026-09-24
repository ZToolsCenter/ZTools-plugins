const PARTIAL_TOOL_STATUSES = new Set(['streaming', 'queued'])

/**
 * 判断助手尝试是否已经产生用户可见或可诊断的内容。
 * @param {Record<string, unknown>} assistant 当前助手消息对象。
 * @returns {boolean} 是否包含正文、思考或工具调用。
 */
function hasAssistantAttemptEvidence(assistant) {
  return Boolean(
    String(assistant?.content || '').trim()
    || String(assistant?.reasoning || '').trim()
    || (Array.isArray(assistant?.tool_calls) && assistant.tool_calls.length),
  )
}

/**
 * 丢弃失败请求已经发布的临时流内容，准备在同一助手消息中重新请求。
 * @param {Record<string, unknown>} assistant 当前助手消息对象。
 * @returns {void} 无返回值。
 */
export function resetAssistantForChatRetry(assistant) {
  if (!assistant) return
  // 工具尚未进入执行阶段，清空临时卡片可防止重试结果重复调用。
  assistant.content = ''
  assistant.reasoning = ''
  assistant.reasoningStatus = 'idle'
  assistant.status = 'streaming'
  assistant.tool_calls = []
  // 新请求不能携带失败尝试可能遗留的协议原生响应状态。
  delete assistant.replay_state
  delete assistant.failure
}

/**
 * 收口一项不会继续重试的助手失败尝试，并明确标记未执行的工具调用。
 * @param {Record<string, unknown>} runtime 助手消息所属会话运行时。
 * @param {Record<string, unknown>} assistant 当前助手消息对象。
 * @param {{message?: string, code?: string, status?: number, requestId?: string}} failure 稳定模型失败快照。
 * @returns {{removed: boolean, interruptedTools: number}} 是否移除空占位及被收口的工具数量。
 */
export function finalizeAssistantAfterChatFailure(runtime, assistant, failure = {}) {
  if (!assistant) return { removed: false, interruptedTools: 0 }
  let interruptedTools = 0

  // 流已经终止，思考面板和所有未完成工具都不能继续显示运行状态。
  if (assistant.reasoningStatus === 'streaming') assistant.reasoningStatus = 'completed'
  for (const call of Array.isArray(assistant.tool_calls) ? assistant.tool_calls : []) {
    if (!call || typeof call !== 'object') continue
    if (!PARTIAL_TOOL_STATUSES.has(call.status)) continue
    call.status = 'error'
    call.result = '模型响应在工具调用生成完成前中断，工具未执行。'
    interruptedTools += 1
  }

  if (!hasAssistantAttemptEvidence(assistant)) {
    // 与 Harness 一致，完全空白的失败尝试不提交为助手消息。
    const index = Array.isArray(runtime?.messages) ? runtime.messages.indexOf(assistant) : -1
    if (index >= 0) runtime.messages.splice(index, 1)
    return { removed: index >= 0, interruptedTools }
  }

  assistant.status = 'error'
  assistant.failure = {
    message: String(failure.message || '模型请求失败'),
    code: String(failure.code || 'UNKNOWN'),
    ...(Number.isInteger(failure.status) ? { status: failure.status } : {}),
    ...(failure.requestId ? { requestId: String(failure.requestId) } : {}),
  }
  return { removed: false, interruptedTools }
}
