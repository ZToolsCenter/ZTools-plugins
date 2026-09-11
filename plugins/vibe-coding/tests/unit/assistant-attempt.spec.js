import assert from 'node:assert/strict'
import test from 'node:test'
import {
  finalizeAssistantAfterChatFailure,
  resetAssistantForChatRetry,
} from '../../src/services/assistant-attempt.js'

test('重试时丢弃半截正文、思考和工具调用', () => {
  const assistant = {
    content: 'partial',
    reasoning: 'thinking',
    reasoningStatus: 'streaming',
    status: 'error',
    tool_calls: [{ id: 'call-1', status: 'streaming' }],
    replay_state: { version: 1, apiFormat: 'openai-responses' },
  }
  resetAssistantForChatRetry(assistant)
  assert.deepEqual(assistant, {
    content: '',
    reasoning: '',
    reasoningStatus: 'idle',
    status: 'streaming',
    tool_calls: [],
  })
})

test('最终失败时不提交空助手占位，并收口未执行工具', () => {
  const empty = { id: 'empty', status: 'streaming', content: '', reasoning: '', tool_calls: [] }
  const runtime = { messages: [empty] }
  assert.deepEqual(finalizeAssistantAfterChatFailure(runtime, empty, { code: 'SERVER', message: 'upstream failed' }), {
    removed: true,
    interruptedTools: 0,
  })
  assert.deepEqual(runtime.messages, [])

  const partial = {
    id: 'partial',
    status: 'streaming',
    content: '',
    reasoning: '',
    reasoningStatus: 'streaming',
    tool_calls: [{ id: 'call-1', status: 'streaming', result: '' }],
  }
  const partialRuntime = { messages: [partial] }
  const result = finalizeAssistantAfterChatFailure(partialRuntime, partial, { code: 'SERVER', message: 'upstream failed', status: 502 })
  assert.deepEqual(result, { removed: false, interruptedTools: 1 })
  assert.equal(partial.status, 'error')
  assert.equal(partial.reasoningStatus, 'completed')
  assert.equal(partial.tool_calls[0].status, 'error')
  assert.match(partial.tool_calls[0].result, /工具未执行/)
  assert.deepEqual(partial.failure, { code: 'SERVER', message: 'upstream failed', status: 502 })
})
