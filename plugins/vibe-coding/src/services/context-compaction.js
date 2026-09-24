export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'

export const DEFAULT_CONTEXT_POLICY = Object.freeze({
  contextWindow: 262144,
  thresholdRatio: 0.7,
  retainRatio: 0.2,
  summaryMaxTokens: 8192,
  toolResultThresholdChars: 8192,
  toolResultHeadChars: 4096,
  toolResultTailChars: 1024,
})

const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'
const TOOL_RESULT_PRUNE_MARKER = '\n\n[... 工具结果中间内容已裁剪 ...]\n\n'
const SUMMARY_PREAMBLE = '以下内容是较早会话的自动摘要检查点。请将其视为已经确认的背景，直接结合后续消息继续完成任务，不要复述或提及上下文压缩。'

export const COMPACTION_INSTRUCTION = [
  '你现在是 AI 助手的上下文压缩引擎。请把上面的会话压缩为一个结构化检查点，让另一个模型可以无损地继续当前工作。',
  '',
  '严格按照下面的 Markdown 结构输出，所有章节必须保留。使用简洁条目，不要写长段落；没有内容时写“无”。',
  '',
  '## 用户目标与意图',
  '- 用户最初目标、后续修正和当前真实诉求；精确措辞重要时逐字引用用户原话。',
  '',
  '## 关键技术与约束',
  '- 技术栈、架构决定、规范、偏好和不能违反的边界。',
  '',
  '## 文件与实现',
  '- 精确文件路径、关键代码位置、已经完成的修改。',
  '',
  '## 错误与处理',
  '- 遇到的问题、原因、已经验证的修复和用户反馈。',
  '',
  '## 待办事项',
  '- 尚未完成但用户明确要求的工作。',
  '',
  '## 当前进展',
  '- 压缩发生时正在处理的具体内容。',
  '',
  '## 下一步',
  '- 与用户最近请求直接一致的下一项行动。',
  '',
  '## 关键上下文',
  '- 继续工作必须知道的标识符、命令、错误文本、数值、开放问题和决策理由。',
  '',
  '规则：',
  '- 保留精确路径、命令、错误文本、标识符、数值和函数签名。',
  '- 忠实保留用户的纠正、偏好和明确指令。',
  '- 如果上文已有 compacted-summary，它是旧检查点。合并仍然有效的事实并删除过期内容，不要原样嵌套复制。',
  '- 不要调用工具，不要解释压缩行为，只输出检查点正文。',
].join('\n')

/**
 * 将数值限制在指定闭区间内。
 * @param {unknown} value 待限制的数值。
 * @param {number} minimum 允许的最小值。
 * @param {number} maximum 允许的最大值。
 * @param {number} fallback 无效输入使用的默认值。
 * @returns {number} 经过取整和边界限制的数值。
 */
export function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)))
}

/**
 * 规范化模型上下文窗口配置。
 * @param {unknown} value 用户或存储中的窗口大小。
 * @returns {number} 介于 4096 和 2000000 之间的 token 数。
 */
export function normalizeContextWindow(value) {
  return clampInteger(value, 4096, 2000000, DEFAULT_CONTEXT_POLICY.contextWindow)
}

/**
 * 创建空白的会话上下文压缩状态。
 * @returns {Record<string, unknown>} 可直接持久化的默认状态。
 */
export function createEmptyContextState() {
  return {
    version: 1,
    summary: '',
    compactedThroughMessageId: '',
    compactedThroughTurnId: '',
    estimatedTokens: 0,
    summaryTokens: 0,
    lastPromptTokens: 0,
    sampledPromptEstimateTokens: 0,
    tokenScale: 1,
    lastCompactedAt: 0,
    modelKey: '',
  }
}

/**
 * 将持久化数据收敛为当前支持的上下文状态。
 * @param {unknown} value 原始上下文状态。
 * @returns {Record<string, unknown>} 字段完整且数值有界的上下文状态。
 */
export function normalizeContextState(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    version: 1,
    summary: typeof source.summary === 'string' ? source.summary : '',
    compactedThroughMessageId: typeof source.compactedThroughMessageId === 'string' ? source.compactedThroughMessageId : '',
    compactedThroughTurnId: typeof source.compactedThroughTurnId === 'string' ? source.compactedThroughTurnId : '',
    estimatedTokens: Math.max(0, Math.round(Number(source.estimatedTokens) || 0)),
    summaryTokens: Math.max(0, Math.round(Number(source.summaryTokens) || 0)),
    lastPromptTokens: Math.max(0, Math.round(Number(source.lastPromptTokens) || 0)),
    sampledPromptEstimateTokens: Math.max(0, Math.round(Number(source.sampledPromptEstimateTokens) || 0)),
    tokenScale: Math.min(4, Math.max(0.5, Number(source.tokenScale) || 1)),
    lastCompactedAt: Math.max(0, Math.round(Number(source.lastCompactedAt) || 0)),
    modelKey: typeof source.modelKey === 'string' ? source.modelKey : '',
  }
}

/**
 * 按中英文字符密度估算文本 token 数。
 * @param {unknown} value 待估算的文本。
 * @returns {number} 向上取整后的保守 token 估算值。
 */
export function estimateTextTokens(value) {
  let asciiLike = 0
  let dense = 0
  for (const character of Array.from(String(value || ''))) {
    if (character.codePointAt(0) <= 0x7f) asciiLike += 1
    else dense += 1
  }
  return Math.ceil(asciiLike / 4) + dense
}

/**
 * 估算任意 JSON 兼容值的 token 数。
 * @param {unknown} value 待序列化的数据。
 * @returns {number} 数据内容和结构开销的估算 token 数。
 */
function estimateJsonTokens(value) {
  if (value === undefined || value === null) return 0
  try {
    return estimateTextTokens(JSON.stringify(value)) + 4
  } catch {
    return estimateTextTokens(String(value)) + 4
  }
}

/**
 * 估算一条 OpenAI 兼容消息的 token 数。
 * @param {Record<string, unknown>} message 待估算的 API 消息。
 * @returns {number} 包含角色和工具协议结构开销的 token 数。
 */
export function estimateApiMessageTokens(message) {
  if (!message || typeof message !== 'object') return 0
  let tokens = 4 + estimateTextTokens(message.role)
  if (typeof message.content === 'string') tokens += estimateTextTokens(message.content)
  else if (message.content !== null && message.content !== undefined) tokens += estimateJsonTokens(message.content)
  if (typeof message.reasoning_content === 'string') tokens += estimateTextTokens(message.reasoning_content)
  if (message.tool_calls) tokens += estimateJsonTokens(message.tool_calls)
  if (message.tool_call_id) tokens += estimateTextTokens(message.tool_call_id)
  if (message.name) tokens += estimateTextTokens(message.name)
  return tokens
}

/**
 * 估算完整模型请求的输入 token 数。
 * @param {Array<Record<string, unknown>>} messages 模型可见消息。
 * @param {Array<Record<string, unknown>>} tools 模型工具定义。
 * @param {number} scale 根据提供商 usage 校正的倍率。
 * @returns {number} 应用于压力判断的输入 token 估算值。
 */
export function estimateContextTokens(messages, tools = [], scale = 1) {
  const messageTokens = (Array.isArray(messages) ? messages : []).reduce((total, message) => total + estimateApiMessageTokens(message), 0)
  const toolTokens = Array.isArray(tools) && tools.length ? estimateJsonTokens(tools) : 0
  return Math.ceil((messageTokens + toolTokens) * Math.min(4, Math.max(0.5, Number(scale) || 1)))
}

/**
 * 从可能不完整的工具参数文本中提取合法 JSON 对象。
 * @param {unknown} raw 模型返回的工具参数文本。
 * @returns {string} 合法 JSON 字符串；无法修复时返回空对象。
 */
export function sanitizeToolArguments(raw) {
  const source = String(raw || '').trim()
  if (!source) return '{}'
  try {
    JSON.parse(source)
    return source
  } catch {
    const start = source.indexOf('{')
    if (start < 0) return '{}'
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = start; index < source.length; index += 1) {
      const character = source[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === '{') depth += 1
      else if (character === '}' && --depth === 0) {
        const candidate = source.slice(start, index + 1)
        try {
          JSON.parse(candidate)
          return candidate
        } catch {
          return '{}'
        }
      }
    }
    return '{}'
  }
}

/**
 * 修复历史工具调用顺序，并为缺失结果的调用补充占位结果。
 * @param {Array<Record<string, unknown>>} messages 待发送给模型的消息历史。
 * @returns {Array<Record<string, unknown>>} 满足工具调用协议的消息历史。
 */
export function normalizeToolCallHistory(messages) {
  const normalized = []
  let pendingCalls = new Map()
  const missingResult = '[System Note]: Tool call was cancelled or its historical result was unavailable.'

  /**
   * 为当前未配对的工具调用写入取消占位结果。
   * @returns {void} 无返回值。
   */
  const flushPendingCalls = () => {
    for (const call of pendingCalls.values()) {
      normalized.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: missingResult })
    }
    pendingCalls = new Map()
  }

  // 只接受与前一条 assistant 调用配对的 tool 结果，避免兼容接口拒绝历史。
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue
    if (message.role === 'tool') {
      const callId = typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
      if (callId && pendingCalls.has(callId)) {
        normalized.push(message)
        pendingCalls.delete(callId)
      }
      continue
    }
    if (pendingCalls.size) flushPendingCalls()
    const next = { ...message }
    if (next.role === 'assistant' && Array.isArray(next.tool_calls)) {
      next.tool_calls = next.tool_calls.map((call) => {
        const id = typeof call?.id === 'string' ? call.id : ''
        const name = typeof call?.function?.name === 'string' ? call.function.name : ''
        if (!id || !name) return null
        pendingCalls.set(id, { id, name })
        return { id, type: 'function', function: { name, arguments: sanitizeToolArguments(call.function.arguments) } }
      }).filter(Boolean)
      if (!next.tool_calls.length) delete next.tool_calls
    }
    normalized.push(next)
  }
  if (pendingCalls.size) flushPendingCalls()
  return normalized
}

/**
 * 将一条 ZVC 展示消息转换为 OpenAI 兼容消息。
 * @param {Record<string, unknown>} message 界面持久化消息。
 * @returns {Record<string, unknown>|null} 模型消息；不支持的界面消息返回空值。
 */
function toApiMessage(message) {
  if (!message || typeof message !== 'object') return null
  const parts = Array.isArray(message.parts) ? message.parts.filter((part) => part && typeof part === 'object' && (part.type === 'text' || part.type === 'image')) : []
  const content = parts.length
    ? parts.map((part) => part.type === 'image'
      ? { type: 'image', attachment: part.attachment }
      : { type: 'text', text: String(part.text || '') })
    : String(message.content || '')
  if (message.role === 'assistant') {
    const item = { role: 'assistant', content: content || null }
    if (message.reasoning) item.reasoning_content = String(message.reasoning)
    // 回放状态由宿主校验协议和模型身份，插件只负责随所属 assistant 原样传回。
    if (message.replay_state && typeof message.replay_state === 'object' && !Array.isArray(message.replay_state)) {
      item.replay_state = message.replay_state
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      item.tool_calls = message.tool_calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: sanitizeToolArguments(call.arguments) },
      }))
    }
    return item
  }
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.tool_call_id, name: message.name, content: content || '' }
  }
  if (message.role === 'user') return { role: 'user', content: content || '' }
  return null
}

/**
 * 将 ZVC 展示消息列表转换并修复为模型请求历史。
 * @param {Array<Record<string, unknown>>} messages 界面消息列表。
 * @returns {Array<Record<string, unknown>>} 可发送给兼容接口的消息列表。
 */
export function displayMessagesToApi(messages) {
  const projected = (Array.isArray(messages) ? messages : []).map(toApiMessage).filter(Boolean)
  // 界面可能已插入尚无内容的流式占位，模型请求不能携带该空 assistant。
  while (projected.at(-1)?.role === 'assistant' && !projected.at(-1)?.content && !projected.at(-1)?.tool_calls?.length) projected.pop()
  return normalizeToolCallHistory(projected)
}

/**
 * 裁剪超长工具结果的中间部分，同时保留诊断最有价值的首尾内容。
 * @param {unknown} content 原始工具结果。
 * @param {Record<string, number>} policy 工具结果字符预算。
 * @returns {{content: string, pruned: boolean, charsBefore: number, charsAfter: number}} 裁剪后的内容和统计信息。
 */
export function pruneToolResultContent(content, policy = DEFAULT_CONTEXT_POLICY) {
  const text = String(content || '')
  const points = Array.from(text)
  const threshold = clampInteger(policy.toolResultThresholdChars, 256, 200000, DEFAULT_CONTEXT_POLICY.toolResultThresholdChars)
  if (points.length <= threshold) return { content: text, pruned: false, charsBefore: points.length, charsAfter: points.length }
  const head = Math.min(clampInteger(policy.toolResultHeadChars, 0, threshold, DEFAULT_CONTEXT_POLICY.toolResultHeadChars), threshold)
  const tail = Math.min(clampInteger(policy.toolResultTailChars, 0, threshold, DEFAULT_CONTEXT_POLICY.toolResultTailChars), Math.max(0, threshold - head - TOOL_RESULT_PRUNE_MARKER.length))
  const next = `${points.slice(0, head).join('')}${TOOL_RESULT_PRUNE_MARKER}${points.slice(-tail).join('')}`
  return { content: next, pruned: true, charsBefore: points.length, charsAfter: Array.from(next).length }
}

/**
 * 在不修改原消息的前提下裁剪所有模型可见工具结果。
 * @param {Array<Record<string, unknown>>} messages API 消息列表。
 * @param {Record<string, number>} policy 工具结果字符预算。
 * @returns {{messages: Array<Record<string, unknown>>, prunedCount: number, removedChars: number}} 请求投影和裁剪统计。
 */
export function pruneToolResults(messages, policy = DEFAULT_CONTEXT_POLICY) {
  let prunedCount = 0
  let removedChars = 0
  const projected = (Array.isArray(messages) ? messages : []).map((message) => {
    if (message?.role !== 'tool' || typeof message.content !== 'string') return { ...message }
    const result = pruneToolResultContent(message.content, policy)
    if (!result.pruned) return { ...message }
    prunedCount += 1
    removedChars += result.charsBefore - result.charsAfter
    return { ...message, content: result.content }
  })
  return { messages: projected, prunedCount, removedChars }
}

/**
 * 构造仅供模型消费的摘要检查点消息。
 * @param {unknown} summary 已验证的摘要正文。
 * @returns {Record<string, string>} OpenAI 兼容的用户消息。
 */
export function createSummaryCheckpointMessage(summary) {
  return {
    role: 'user',
    content: `${SUMMARY_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\n${String(summary || '').trim()}\n${SUMMARY_CLOSE_TAG}`,
  }
}

/**
 * 根据摘要边界解析模型仍需查看的原始消息。
 * @param {Array<Record<string, unknown>>} messages 完整界面历史。
 * @param {Record<string, unknown>} contextState 当前上下文状态。
 * @returns {{messages: Array<Record<string, unknown>>, checkpoint: Record<string, string>|null, stateValid: boolean}} 活跃历史和有效检查点。
 */
export function resolveActiveContext(messages, contextState) {
  const history = Array.isArray(messages) ? messages : []
  const state = normalizeContextState(contextState)
  if (!state.summary || !state.compactedThroughMessageId) return { messages: history, checkpoint: null, stateValid: true }
  const boundary = history.findIndex((message) => message?.id === state.compactedThroughMessageId)
  if (boundary < 0) return { messages: history, checkpoint: null, stateValid: false }
  return {
    messages: history.slice(boundary + 1),
    checkpoint: createSummaryCheckpointMessage(state.summary),
    stateValid: true,
  }
}

/**
 * 构建当前模型请求投影并计算上下文压力。
 * @param {{messages: Array<Record<string, unknown>>, contextState: Record<string, unknown>, systemPrompt: string, tools?: Array<Record<string, unknown>>, policy?: Record<string, number>, modelKey?: string}} input 会话历史和请求信封。
 * @returns {{messages: Array<Record<string, unknown>>, estimatedTokens: number, rawEstimatedTokens: number, prunedCount: number, removedChars: number, stateValid: boolean}} 模型请求投影。
 */
export function buildContextProjection(input) {
  const state = normalizeContextState(input.contextState)
  const active = resolveActiveContext(input.messages, state)
  const history = displayMessagesToApi(active.messages)
  const pruned = pruneToolResults(history, input.policy)
  const requestMessages = [
    ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
    ...(active.checkpoint ? [active.checkpoint] : []),
    ...pruned.messages,
  ]
  const scale = state.modelKey && input.modelKey && state.modelKey !== input.modelKey ? 1 : state.tokenScale
  const rawEstimatedTokens = estimateContextTokens(requestMessages, input.tools, 1)
  return {
    messages: requestMessages,
    rawEstimatedTokens,
    estimatedTokens: estimateContextTokens(requestMessages, input.tools, scale),
    prunedCount: pruned.prunedCount,
    removedChars: pruned.removedChars,
    stateValid: active.stateValid,
  }
}

/**
 * 估算单条展示消息进入模型请求后的 token 数，并应用工具结果裁剪规则。
 * @param {Record<string, unknown>} message ZVC 展示消息。
 * @param {Record<string, number>|undefined} policy 上下文裁剪策略。
 * @returns {number} 当前消息的模型可见 token 估算；非模型消息返回 0。
 */
function estimateDisplayMessageTokens(message, policy) {
  const apiMessage = toApiMessage(message)
  if (!apiMessage) return 0
  const projected = pruneToolResults([apiMessage], policy).messages[0]
  return estimateApiMessageTokens(projected)
}

/**
 * 将候选切点向历史方向调整，确保保留侧不会出现失去 assistant 调用的 tool 结果。
 * @param {Array<Record<string, unknown>>} messages 按模型协议顺序排列的展示消息。
 * @param {number} desiredKeepFrom 按 token 预算得到的首条保留消息位置。
 * @returns {number} 工具调用配对完整的首条保留消息位置。
 */
function roundRetentionBoundaryForToolPairs(messages, desiredKeepFrom) {
  const callOwnerIndexes = new Map()
  for (const [index, message] of messages.entries()) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      const callId = typeof call?.id === 'string' ? call.id : ''
      if (callId) callOwnerIndexes.set(callId, index)
    }
  }

  let keepFrom = desiredKeepFrom
  // 保留侧出现工具结果时，必须把发起调用的 assistant 一并移到保留侧。
  for (let index = desiredKeepFrom; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role !== 'tool') continue
    const ownerIndex = callOwnerIndexes.get(String(message.tool_call_id || ''))
    if (Number.isInteger(ownerIndex) && ownerIndex < keepFrom) keepFrom = ownerIndex
  }
  return keepFrom
}

/**
 * 分析从历史头部开始的协议安全压缩范围。
 * 最近消息按 token 预算原样保留，切点只在完整工具调用步骤之间产生，并始终至少保留一条当前消息。
 * @param {{messages: Array<Record<string, unknown>>, contextState: Record<string, unknown>, retainTokens?: number, policy?: Record<string, number>}} input 历史、摘要边界和保留预算。
 * @returns {{candidate: Record<string, unknown>|null, reason: string, retainedTokens: number}} 压缩候选、无候选原因和实际保留 token 数。
 */
export function analyzeCompactionCandidate(input) {
  const state = normalizeContextState(input.contextState)
  const active = resolveActiveContext(input.messages, state)
  const effectiveState = active.stateValid ? state : createEmptyContextState()
  const modelMessages = active.messages.filter((message) => message && ['user', 'assistant', 'tool'].includes(message.role))
  // 流式请求会预先追加空 assistant；它不会进入模型协议，也不能替代当前用户消息成为保留锚点。
  while (modelMessages.at(-1)?.role === 'assistant') {
    const tail = toApiMessage(modelMessages.at(-1))
    if (tail?.content || tail?.tool_calls?.length) break
    modelMessages.pop()
  }
  if (modelMessages.length < 2) return { candidate: null, reason: '模型可见历史不足两条消息', retainedTokens: 0 }

  // 从尾部逐条累计最近上下文；即使保留预算为零，也保留最后一条当前消息。
  const retainTokens = Math.max(0, Number(input.retainTokens) || 0)
  let keepFrom = modelMessages.length
  let retainedTokens = 0
  for (let index = modelMessages.length - 1; index >= 0; index -= 1) {
    retainedTokens += estimateDisplayMessageTokens(modelMessages[index], input.policy)
    keepFrom = index
    if (retainedTokens >= retainTokens && index < modelMessages.length) break
  }
  if (keepFrom <= 0) {
    return { candidate: null, reason: '最近上下文保留预算已覆盖全部历史', retainedTokens }
  }

  // Harness 风格切点只保证协议配对，不再把整个超长 Turn 视为不可分割单元。
  keepFrom = roundRetentionBoundaryForToolPairs(modelMessages, keepFrom)
  if (keepFrom <= 0) {
    return { candidate: null, reason: '最近工具调用步骤覆盖全部可压缩历史', retainedTokens }
  }
  retainedTokens = modelMessages
    .slice(keepFrom)
    .reduce((total, message) => total + estimateDisplayMessageTokens(message, input.policy), 0)

  const sourceMessages = modelMessages.slice(0, keepFrom)
  const lastMessage = sourceMessages.at(-1)
  if (!lastMessage?.id) return { candidate: null, reason: '压缩边界消息缺少标识', retainedTokens }
  const sourceApiMessages = pruneToolResults(displayMessagesToApi(sourceMessages), input.policy).messages
  const checkpoint = effectiveState.summary ? createSummaryCheckpointMessage(effectiveState.summary) : null
  const shadowedTokens = sourceApiMessages.reduce((total, message) => total + estimateApiMessageTokens(message), checkpoint ? estimateApiMessageTokens(checkpoint) : 0)
  return {
    candidate: {
      sourceMessages,
      sourceApiMessages,
      previousSummary: effectiveState.summary,
      lastMessageId: lastMessage.id,
      lastTurnId: typeof lastMessage.turnId === 'string' ? lastMessage.turnId : '',
      sourceMessageIds: sourceMessages.map((message) => message.id).filter(Boolean),
      shadowedTokens,
      retainedTokens,
    },
    reason: '',
    retainedTokens,
  }
}

/**
 * 选择一个从历史起点开始、且不会切断工具调用步骤的压缩前缀。
 * @param {{messages: Array<Record<string, unknown>>, contextState: Record<string, unknown>, retainTokens?: number, policy?: Record<string, number>}} input 历史、摘要边界和保留预算。
 * @returns {Record<string, unknown>|null} 协议安全的压缩候选；没有可缩减前缀时返回空值。
 */
export function selectCompactionCandidate(input) {
  return analyzeCompactionCandidate(input).candidate
}

/**
 * 判断请求压力是否达到自动压缩阈值。
 * @param {number} estimatedTokens 当前输入 token 估算。
 * @param {unknown} contextWindow 模型上下文窗口。
 * @param {number} thresholdRatio 自动触发比例。
 * @returns {boolean} 是否应在下一次模型请求前压缩。
 */
export function shouldCompactContext(estimatedTokens, contextWindow, thresholdRatio = DEFAULT_CONTEXT_POLICY.thresholdRatio) {
  const windowTokens = normalizeContextWindow(contextWindow)
  const ratio = Math.min(0.95, Math.max(0.5, Number(thresholdRatio) || DEFAULT_CONTEXT_POLICY.thresholdRatio))
  return Math.max(0, Number(estimatedTokens) || 0) >= Math.floor(windowTokens * ratio)
}

/**
 * 构建复用原会话前缀的摘要请求消息。
 * @param {{previousSummary?: string, sourceApiMessages: Array<Record<string, unknown>>}} candidate 压缩候选。
 * @param {string} systemPrompt 原会话系统提示词。
 * @returns {Array<Record<string, unknown>>} 末尾追加压缩指令的请求消息。
 */
export function buildCompactionMessages(candidate, systemPrompt) {
  return [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...(candidate.previousSummary ? [createSummaryCheckpointMessage(candidate.previousSummary)] : []),
    ...candidate.sourceApiMessages,
    { role: 'user', content: COMPACTION_INSTRUCTION },
  ]
}

/**
 * 清理模型可能重复输出的摘要标签。
 * @param {unknown} value 模型摘要正文。
 * @returns {string} 不含外层检查点标签的摘要。
 */
function cleanSummaryText(value) {
  return String(value || '').trim()
    .replace(/^<compacted-summary>\s*/i, '')
    .replace(/\s*<\/compacted-summary>$/i, '')
    .trim()
}

/**
 * 校验摘要完整性和实际缩减效果。
 * @param {Record<string, unknown>} response 摘要模型响应。
 * @param {Record<string, unknown>} candidate 生成摘要时使用的压缩候选。
 * @returns {{summary: string, summaryTokens: number}} 可提交的摘要和检查点 token 数。
 * @throws {Error} 摘要为空、被截断、包含工具调用或没有缩小时抛出。
 */
export function validateCompactionSummary(response, candidate) {
  if (response?.finish_reason === 'length') throw new Error('上下文摘要达到输出上限，未提交不完整结果')
  if (Array.isArray(response?.tool_calls) && response.tool_calls.length) throw new Error('上下文摘要意外调用了工具，已拒绝提交')
  const summary = cleanSummaryText(response?.content)
  if (!summary) throw new Error('模型没有返回可用的上下文摘要')
  const summaryTokens = estimateApiMessageTokens(createSummaryCheckpointMessage(summary))
  if (summaryTokens >= Number(candidate.shadowedTokens || 0)) {
    throw new Error(`上下文摘要没有缩小历史（${summaryTokens} >= ${candidate.shadowedTokens} tokens）`)
  }
  return { summary, summaryTokens }
}

/**
 * 根据成功摘要生成下一版持久化上下文状态。
 * @param {Record<string, unknown>} current 当前上下文状态。
 * @param {Record<string, unknown>} candidate 已提交的压缩候选。
 * @param {{summary: string, summaryTokens: number}} validated 已验证摘要。
 * @param {string} modelKey 生成摘要时使用的模型标识。
 * @returns {Record<string, unknown>} 指向新历史边界的上下文状态。
 */
export function createCompactedContextState(current, candidate, validated, modelKey) {
  const state = normalizeContextState(current)
  return {
    ...state,
    summary: validated.summary,
    compactedThroughMessageId: String(candidate.lastMessageId || ''),
    compactedThroughTurnId: String(candidate.lastTurnId || ''),
    summaryTokens: validated.summaryTokens,
    estimatedTokens: 0,
    lastCompactedAt: Date.now(),
    modelKey: String(modelKey || state.modelKey || ''),
  }
}

/**
 * 创建一条仅供聊天时间线展示的上下文压缩标记。
 * @param {Record<string, unknown>} candidate 已提交的压缩候选。
 * @param {{summary: string, summaryTokens: number}} validated 已验证的压缩摘要。
 * @param {{id: string, reason?: string, timestamp?: number}} metadata 标记标识、触发原因和完成时间。
 * @returns {Record<string, unknown>} 不会进入模型请求的压缩标记消息。
 */
export function createContextCompactionMarker(candidate, validated, metadata) {
  return {
    id: String(metadata?.id || ''),
    role: 'context',
    kind: 'context-compaction',
    boundaryMessageId: String(candidate?.lastMessageId || ''),
    boundaryTurnId: String(candidate?.lastTurnId || ''),
    summary: String(validated?.summary || ''),
    summaryTokens: Math.max(0, Math.round(Number(validated?.summaryTokens) || 0)),
    shadowedItemCount: Array.isArray(candidate?.sourceMessageIds) ? candidate.sourceMessageIds.length : 0,
    shadowedTokenCount: Math.max(0, Math.round(Number(candidate?.shadowedTokens) || 0)),
    reason: String(metadata?.reason || 'pressure'),
    timestamp: Math.max(0, Math.round(Number(metadata?.timestamp) || Date.now())),
  }
}

/**
 * 按压缩完成时间将上下文标记追加到消息末尾，同时校验摘要边界仍然有效。
 * @param {Array<Record<string, unknown>>} messages 完整的界面消息时间线。
 * @param {Record<string, unknown>} marker 待追加的压缩标记。
 * @returns {Array<Record<string, unknown>>} 末尾包含压缩标记的新消息数组。
 * @throws {Error} 标记缺少标识或对应历史边界已不存在时抛出。
 */
export function appendContextCompactionMarker(messages, marker) {
  const history = Array.isArray(messages) ? messages : []
  if (!marker?.id) throw new Error('上下文压缩标记缺少有效标识')
  const boundaryIndex = history.findIndex((message) => message?.id === marker.boundaryMessageId)
  if (boundaryIndex < 0) throw new Error('上下文压缩标记对应的历史边界不存在')

  // 摘要边界由 marker 字段和 contextState 维护，界面位置按实际完成时间展示。
  return [...history, marker]
}

/**
 * 使用提供商输入 usage 平滑校正本地 token 估算倍率。
 * @param {Record<string, unknown>} current 当前上下文状态。
 * @param {Record<string, unknown>|undefined} usage 提供商 token 使用量。
 * @param {number} estimatedTokens 同一次请求的原始估算值。
 * @param {string} modelKey 当前模型标识。
 * @returns {Record<string, unknown>} 更新 usage 基线后的上下文状态。
 */
export function applyUsageCalibration(current, usage, estimatedTokens, modelKey) {
  const state = normalizeContextState(current)
  const promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens)
  const estimate = Math.max(0, Number(estimatedTokens) || 0)
  if (!Number.isFinite(promptTokens) || promptTokens <= 0 || estimate <= 0) {
    const nextModelKey = String(modelKey || state.modelKey || '')
    const sameModel = nextModelKey === state.modelKey
    return {
      ...state,
      estimatedTokens: Math.round(estimate),
      lastPromptTokens: sameModel ? state.lastPromptTokens : 0,
      sampledPromptEstimateTokens: sameModel ? state.sampledPromptEstimateTokens : 0,
      tokenScale: sameModel ? state.tokenScale : 1,
      modelKey: nextModelKey,
    }
  }
  const observedScale = Math.min(4, Math.max(0.5, promptTokens / estimate))
  const previousScale = state.modelKey === modelKey ? state.tokenScale : observedScale
  return {
    ...state,
    estimatedTokens: Math.round(promptTokens),
    lastPromptTokens: Math.round(promptTokens),
    sampledPromptEstimateTokens: Math.round(estimate),
    tokenScale: Number((previousScale * 0.7 + observedScale * 0.3).toFixed(4)),
    modelKey: String(modelKey || ''),
  }
}

/**
 * 将最近一次提供商输入 token 采样沿本地消息增量推进到当前上下文。
 * @param {Record<string, unknown>} current 当前持久化的上下文计量状态。
 * @param {number} rawEstimatedTokens 当前请求未校正的本地估算 token。
 * @param {number} estimatedTokens 当前请求经过密度校正的本地估算 token。
 * @param {string} modelKey 当前模型标识。
 * @returns {number} 当前模型下一次请求预计占用的输入 token。
 */
export function projectContextTokens(current, rawEstimatedTokens, estimatedTokens, modelKey) {
  const state = normalizeContextState(current)
  const raw = Math.max(0, Number(rawEstimatedTokens) || 0)
  const fallback = Math.max(0, Math.round(Number(estimatedTokens) || 0))
  const hasMatchingSample = state.modelKey === String(modelKey || '')
    && state.lastPromptTokens > 0
    && state.sampledPromptEstimateTokens > 0
  if (!hasMatchingSample) return fallback

  // 提供商采样负责绝对基线，本地估算只负责采样之后的表面增减。
  const delta = (raw - state.sampledPromptEstimateTokens) * state.tokenScale
  return Math.max(0, Math.round(state.lastPromptTokens + delta))
}

/**
 * 判断兼容接口错误是否明确表示模型上下文超限。
 * @param {unknown} error 捕获到的模型错误。
 * @returns {boolean} 是否可以进入一次强制压缩恢复流程。
 */
export function isContextWindowExceededError(error) {
  if (error?.code === CONTEXT_WINDOW_EXCEEDED_CODE) return true
  const detail = [error?.code, error?.type, error?.message, error?.error?.code, error?.error?.type, error?.error?.message].filter(Boolean).join(' ')
  return /context[\s_-](?:length|window)[\s_-](?:exceed|overflow|limit)/i.test(detail)
    || /(?:maximum|max)(?:\s+allowed|\s+supported)?\s+context\s+(?:length|window)/i.test(detail)
    || /(?:request|prompt|input|messages?).{0,30}too\s+(?:large|long).{0,30}context/i.test(detail)
}
