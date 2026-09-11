import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationHistoryRuntime } from '../../src/services/conversation-history-runtime.js'

test('冷会话只保留可见窗口，发送时按需恢复非响应式完整历史', async () => {
  const complete = Array.from({ length: 120 }, (_, index) => ({ id: `message-${index}`, role: 'user', content: String(index) }))
  const traces = []
  const history = createConversationHistoryRuntime({
    bridge: { getConversationExecutionMessages: () => structuredClone(complete) },
    markRaw: (value) => value,
    onTrace: (event, details) => traces.push({ event, ...details }),
    messageHasImages: () => false,
  })
  const runtime = {
    id: 'paged',
    messages: structuredClone(complete.slice(-50)),
    historyTotal: 120,
    historyHasMore: true,
    historyStartIndex: 70,
    hasImages: false,
  }

  const execution = await history.ensureExecutionMessages(runtime)

  assert.equal(execution.length, 120)
  assert.equal(runtime.messages.length, 50)
  assert.deepEqual(traces, [{ event: 'execution:history-loaded', conversationId: 'paged', messages: 120 }])
})

test('原子变更只捕获新增或修改消息，并使用版本保护异步确认', async () => {
  const history = createConversationHistoryRuntime({
    bridge: { getConversationExecutionMessages: () => [] },
    markRaw: (value) => value,
    messageHasImages: (message) => Array.isArray(message.parts),
  })
  const runtime = { id: 'atomic', messages: [], historyTotal: 0, historyHasMore: false, historyStartIndex: 0, hasImages: false }
  await history.ensureExecutionMessages(runtime)
  const message = history.appendMessage(runtime, { id: 'message-1', role: 'user', content: '初始内容', parts: [{ type: 'image' }] })
  const firstCapture = history.captureChanges(runtime)

  message.content = '后续修改'
  history.markMessageDirty(runtime, message)
  history.acknowledgeChanges(runtime, firstCapture)
  const secondCapture = history.captureChanges(runtime)

  assert.equal(runtime.messages.length, 1)
  assert.equal(runtime.historyTotal, 1)
  assert.equal(runtime.hasImages, true)
  assert.equal(firstCapture[0].message.content, '初始内容')
  assert.equal(secondCapture[0].message.content, '后续修改')
  history.acknowledgeChanges(runtime, secondCapture)
  assert.deepEqual(history.captureChanges(runtime), [])
})
