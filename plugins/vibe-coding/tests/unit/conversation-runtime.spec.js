import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationRuntime } from '../../src/services/conversation-runtime.js'

const options = {
  defaultTools: ['bash'],
  defaultAutoApprove: true,
  normalizeContextState: (value) => value || { summaries: [] },
}

test('每个会话运行时隔离消息、任务和请求状态', () => {
  const first = createConversationRuntime({ id: 'first' }, options)
  const second = createConversationRuntime({ id: 'second' }, options)

  first.messages.push({ role: 'user', content: 'A' })
  first.tasks.push({ content: 'A task', status: 'in_progress' })
  first.busy = true
  first.requestId = 'request-a'
  first.retryState.attempt = 2

  assert.deepEqual(second.messages, [])
  assert.deepEqual(second.tasks, [])
  assert.equal(second.busy, false)
  assert.equal(second.requestId, '')
  assert.equal(second.retryState.attempt, 0)
})

test('会话运行时恢复持久字段但不恢复瞬时执行状态', () => {
  const runtime = createConversationRuntime({
    id: 'restored',
    modelKey: 'provider-a::model-a',
    reasoningEffort: 'xhigh',
    projectId: 'project-a',
    workspaceLocked: true,
    enabledTools: ['Skill', 'read'],
    enabledSkills: ['skill-a'],
    autoApproveTools: false,
    messages: [{ role: 'assistant', content: 'saved' }],
    history: { start: 50, hasMore: true, total: 51 },
    tasks: [{ content: 'saved task', status: 'completed' }],
    pendingMessages: [
      { id: 'queued', text: '稍后处理', placement: 'queued', createdAt: 10 },
      { id: 'steering', text: '原本准备插话', placement: 'steering', createdAt: 11 },
    ],
    contextState: { summaries: ['saved'] },
  }, options)

  assert.equal(runtime.projectId, 'project-a')
  assert.equal(runtime.workspaceLocked, true)
  assert.equal(runtime.modelKey, 'provider-a::model-a')
  assert.equal(runtime.reasoningEffort, 'xhigh')
  assert.deepEqual(runtime.enabledToolNames, ['read'])
  assert.deepEqual(runtime.enabledSkills, ['skill-a'])
  assert.equal(runtime.autoApproveTools, false)
  assert.equal(runtime.messages[0].content, 'saved')
  assert.equal(runtime.historyStartIndex, 50)
  assert.equal(runtime.historyHasMore, true)
  assert.equal(runtime.historyTotal, 51)
  assert.deepEqual(runtime.pendingMessages.map((message) => message.placement), ['queued', 'queued'])
  assert.equal(runtime.busy, false)
  assert.equal(runtime.compacting, false)
  assert.equal(runtime.retryState.attempt, 0)
  assert.equal(runtime.retryWaitCancel, null)
  assert.equal(runtime.operationPromise, null)
  assert.equal(runtime.activeTurnId, '')
  assert.equal(runtime.runningReasoningEffort, '')
})
