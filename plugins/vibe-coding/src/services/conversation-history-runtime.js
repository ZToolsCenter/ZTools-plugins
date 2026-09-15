/**
 * 创建会话执行历史管理器，隔离完整模型历史、可见窗口和原子消息变更。
 * @param {{bridge: Record<string, Function>, markRaw: (value: unknown) => unknown, onTrace?: (event: string, details: Record<string, unknown>) => void, messageHasImages?: (message: Record<string, unknown>) => boolean}} options 桥接、非响应式标记和诊断依赖。
 * @returns {{getExecutionMessages: Function, ensureExecutionMessages: Function, hasExecutionMessages: Function, markMessageDirty: Function, appendMessage: Function, replaceMessages: Function, findToolCallMessage: Function, captureChanges: Function, acknowledgeChanges: Function, release: Function}} 执行历史管理接口。
 */
export function createConversationHistoryRuntime(options) {
  const executionMessages = new Map()
  const dirtyMessages = new Map()
  let dirtyVersion = 0

  /**
   * 返回指定会话当前驻留的完整执行历史；尚未恢复时退化为可见窗口。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @returns {Array<Record<string, unknown>>} 模型和工具循环使用的消息时间线。
   */
  function getExecutionMessages(runtime) {
    return executionMessages.get(runtime?.id) || runtime?.messages || []
  }

  /**
   * 判断指定会话是否已经恢复完整执行历史。
   * @param {string} conversationId 会话标识。
   * @returns {boolean} 完整执行历史是否驻留。
   */
  function hasExecutionMessages(conversationId) {
    return executionMessages.has(String(conversationId || ''))
  }

  /**
   * 按需从 preload 恢复完整执行历史，并合并尚未落盘的消息变更。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @returns {Promise<Array<Record<string, unknown>>>} 完整执行历史。
   * @throws {Error} 会话不存在或历史读取失败时抛出。
   */
  async function ensureExecutionMessages(runtime) {
    const resident = executionMessages.get(runtime?.id)
    if (resident) return resident
    if (!runtime?.id) return []
    const loaded = await options.bridge?.getConversationExecutionMessages?.(runtime.id)
    if (!Array.isArray(loaded)) throw new Error('无法恢复会话执行历史')
    const dirty = dirtyMessages.get(runtime.id)
    const dirtyById = new Map([...(dirty?.values() || [])].map((entry) => [String(entry.message?.id || ''), entry.message]))
    const merged = loaded.map((message) => dirtyById.get(String(message?.id || '')) || message)
    const knownIds = new Set(merged.map((message) => String(message?.id || '')).filter(Boolean))
    for (const entry of dirty?.values() || []) {
      const id = String(entry.message?.id || '')
      if (id && !knownIds.has(id)) merged.push(entry.message)
    }
    // 完整历史不交给 Vue 代理，避免长会话产生大规模响应式依赖。
    executionMessages.set(runtime.id, options.markRaw(merged))
    options.onTrace?.('execution:history-loaded', { conversationId: runtime.id, messages: merged.length })
    return merged
  }

  /**
   * 标记一条消息需要在下一次持久化时执行原子 upsert。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @param {Record<string, unknown>} message 已新增或实质修改的消息。
   * @returns {void} 无返回值。
   */
  function markMessageDirty(runtime, message) {
    const id = String(message?.id || '')
    if (!runtime?.id || !id) return
    let dirty = dirtyMessages.get(runtime.id)
    if (!dirty) {
      dirty = new Map()
      dirtyMessages.set(runtime.id, dirty)
    }
    dirtyVersion += 1
    dirty.set(id, { version: dirtyVersion, message })
  }

  /**
   * 同时向完整执行历史和当前可见尾部追加消息，并登记原子写入。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @param {Record<string, unknown>} message 待追加消息。
   * @returns {Record<string, unknown>} 已追加消息。
   */
  function appendMessage(runtime, message) {
    const complete = getExecutionMessages(runtime)
    complete.push(message)
    if (complete !== runtime.messages) runtime.messages.push(message)
    runtime.historyTotal = Math.max(runtime.historyTotal + 1, complete.length)
    if (options.messageHasImages?.(message)) runtime.hasImages = true
    markMessageDirty(runtime, message)
    return message
  }

  /**
   * 替换完整执行历史，并保留当前已加载窗口和最新尾页。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @param {Array<Record<string, unknown>>} nextMessages 新的完整消息时间线。
   * @returns {void} 无返回值。
   */
  function replaceMessages(runtime, nextMessages) {
    const previousVisibleIds = new Set(runtime.messages.map((message) => String(message?.id || '')))
    const normalized = options.markRaw(Array.isArray(nextMessages) ? nextMessages : [])
    executionMessages.set(runtime.id, normalized)
    runtime.messages = normalized.filter((message, index) => previousVisibleIds.has(String(message?.id || '')) || index >= normalized.length - 50)
    runtime.historyTotal = normalized.length
    runtime.historyHasMore = runtime.messages.length < normalized.length
    runtime.historyStartIndex = Math.max(0, normalized.length - runtime.messages.length)
  }

  /**
   * 查找包含指定工具调用的助手消息。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @param {string} callId 工具调用标识。
   * @returns {Record<string, unknown>|null} 匹配的助手消息；不存在时返回空值。
   */
  function findToolCallMessage(runtime, callId) {
    return getExecutionMessages(runtime).find((message) => (
      Array.isArray(message?.tool_calls) && message.tool_calls.some((call) => call?.id === callId)
    )) || null
  }

  /**
   * 冻结当前待提交消息版本，供串行持久化操作使用。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @returns {Array<{id: string, version: number, message: Record<string, unknown>}>} 可安全跨异步边界的消息变化快照。
   */
  function captureChanges(runtime) {
    const dirty = dirtyMessages.get(runtime?.id)
    return [...(dirty?.entries() || [])].map(([id, entry]) => ({
      id,
      version: entry.version,
      message: JSON.parse(JSON.stringify(entry.message)),
    }))
  }

  /**
   * 在持久化成功后确认已提交版本，同时保留写入期间产生的后续修改。
   * @param {Record<string, unknown>} runtime 会话运行时。
   * @param {Array<{id: string, version: number}>} captured 本次已经提交的消息版本。
   * @returns {void} 无返回值。
   */
  function acknowledgeChanges(runtime, captured) {
    const dirty = dirtyMessages.get(runtime?.id)
    if (!dirty) return
    for (const entry of captured) if (dirty.get(entry.id)?.version === entry.version) dirty.delete(entry.id)
    if (!dirty.size) dirtyMessages.delete(runtime.id)
  }

  /**
   * 释放指定会话的完整执行历史和未提交跟踪。
   * @param {string} conversationId 会话标识。
   * @returns {void} 无返回值。
   */
  function release(conversationId) {
    const id = String(conversationId || '')
    executionMessages.delete(id)
    dirtyMessages.delete(id)
  }

  return {
    getExecutionMessages,
    ensureExecutionMessages,
    hasExecutionMessages,
    markMessageDirty,
    appendMessage,
    replaceMessages,
    findToolCallMessage,
    captureChanges,
    acknowledgeChanges,
    release,
  }
}
