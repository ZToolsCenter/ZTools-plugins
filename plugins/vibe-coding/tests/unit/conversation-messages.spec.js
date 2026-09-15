import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { normalizeConversationMessages } = require('../../public/conversation-messages.js')

test('会话恢复时清除工具调用数组中的 null 和稀疏空位', () => {
  const sparse = []
  sparse[1] = { id: 'call-a', name: 'lookup' }
  sparse[3] = null
  const messages = normalizeConversationMessages([
    { id: 'assistant-a', role: 'assistant', tool_calls: sparse },
    { id: 'user-a', role: 'user', content: '继续' },
  ])

  assert.deepEqual(messages[0].tool_calls, [{ id: 'call-a', name: 'lookup' }])
  assert.equal(messages[1].id, 'user-a')
})
