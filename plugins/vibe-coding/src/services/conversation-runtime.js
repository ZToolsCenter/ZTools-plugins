import { createEmptyChatRetryState } from './chat-retry.js'
import { recoverConversationInbox } from './conversation-inbox.js'

/**
 * 创建一个会话独占的前端运行时状态。
 * @param {Record<string, unknown>} conversation 已从持久层加载的会话快照。
 * @param {{defaultTools?: string[], defaultAutoApprove?: boolean, normalizeContextState: (value: unknown) => Record<string, unknown>}} options 运行时默认值与上下文规范化函数。
 * @returns {Record<string, unknown>} 可交给 Vue `reactive` 的会话运行时对象。
 */
export function createConversationRuntime(conversation, options) {
  const enabledTools = Array.isArray(conversation.enabledTools) && conversation.enabledTools.length
    ? conversation.enabledTools.filter((name) => name !== 'Skill')
    : [...(options.defaultTools || [])]

  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const history = conversation.history && typeof conversation.history === 'object' ? conversation.history : {}
  return {
    id: String(conversation.id || ''),
    modelKey: typeof conversation.modelKey === 'string' ? conversation.modelKey : '',
    reasoningEffort: typeof conversation.reasoningEffort === 'string' ? conversation.reasoningEffort : '',
    messages,
    historyStartIndex: Math.max(0, Math.floor(Number(history.start) || 0)),
    historyHasMore: history.hasMore === true,
    historyTotal: Math.max(messages.length, Math.floor(Number(history.total) || messages.length)),
    historyLoading: false,
    lastAccessedAt: Date.now(),
    projectId: String(conversation.projectId || ''),
    workspaceLocked: conversation.workspaceLocked === true,
    enabledToolNames: enabledTools,
    enabledSkills: Array.isArray(conversation.enabledSkills) ? conversation.enabledSkills : [],
    autoApproveTools: conversation.autoApproveTools ?? options.defaultAutoApprove ?? true,
    tasks: Array.isArray(conversation.tasks) ? conversation.tasks : [],
    pendingMessages: recoverConversationInbox(conversation.pendingMessages),
    contextState: options.normalizeContextState(conversation.contextState),
    contextMeter: conversation.contextMeter && typeof conversation.contextMeter === 'object'
      ? conversation.contextMeter
      : { usedTokens: 0, contextWindow: 0, breakdown: {} },
    hasImages: conversation.hasImages === true,
    input: '',
    inputAttachments: [],
    error: '',
    busy: false,
    compacting: false,
    requestId: '',
    retryState: createEmptyChatRetryState(),
    retryWaitCancel: null,
    autoScrollMessages: true,
    activeAssistantStream: null,
    activeTurnElapsedSeconds: 0,
    activeTurnStartedAt: 0,
    activeTurnClock: 0,
    activeTurnId: '',
    turnTokenStats: {
      inputTokens: 0,
      outputTokens: 0,
      exact: false,
      committedInputTokens: 0,
      committedOutputTokens: 0,
      stepInputTokens: 0,
      stepOutputTokens: 0,
      stepUsage: null,
      allStepsExact: true,
    },
    contextOperationGeneration: 0,
    contextMeterGeneration: 0,
    runningModelKey: '',
    runningReasoningEffort: '',
    operationPromise: null,
    stopRequested: false,
    completedUnread: false,
  }
}
