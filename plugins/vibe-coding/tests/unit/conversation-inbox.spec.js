import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendPendingMessage,
  claimPendingMessages,
  createPendingMessage,
  editPendingMessage,
  recoverConversationInbox,
  removePendingMessage,
  steerPendingMessage,
} from '../../src/services/conversation-inbox.js'

test('排队消息按 FIFO 逐条领取且不会修改原数组', () => {
  const first = createPendingMessage({ id: 'first', text: '第一条' })
  const second = createPendingMessage({ id: 'second', text: '第二条' })
  const initial = appendPendingMessage(appendPendingMessage([], first), second)
  const result = claimPendingMessages(initial, 'queued', 1)

  assert.deepEqual(result.claimed.map((item) => item.id), ['first'])
  assert.deepEqual(result.inbox.map((item) => item.id), ['second'])
  assert.deepEqual(initial.map((item) => item.id), ['first', 'second'])
})

test('插话消息可以批量领取并保留普通排队消息', () => {
  let inbox = appendPendingMessage([], createPendingMessage({ id: 'queued', text: '稍后执行' }))
  inbox = appendPendingMessage(inbox, createPendingMessage({ id: 'steer-a', text: '先看这个', placement: 'steering' }))
  inbox = appendPendingMessage(inbox, createPendingMessage({ id: 'steer-b', text: '再补一句', placement: 'steering' }))
  const result = claimPendingMessages(inbox, 'steering')

  assert.deepEqual(result.claimed.map((item) => item.id), ['steer-a', 'steer-b'])
  assert.deepEqual(result.inbox.map((item) => item.id), ['queued'])
})

test('排队消息支持编辑、删除和提升为插话', () => {
  const initial = [createPendingMessage({ id: 'message', text: '旧内容' })]
  const edited = editPendingMessage(initial, 'message', '新内容')
  const steered = steerPendingMessage(edited, 'message')

  assert.equal(edited[0].text, '新内容')
  assert.equal(steered[0].placement, 'steering')
  assert.deepEqual(removePendingMessage(steered, 'message'), [])
})

test('恢复会话时把没有活动 Turn 的插话降级为排队', () => {
  const recovered = recoverConversationInbox([
    createPendingMessage({ id: 'steer', text: '中断前插话', placement: 'steering' }),
    createPendingMessage({ id: 'queued', text: '原排队消息' }),
  ])

  assert.deepEqual(recovered.map((item) => item.placement), ['queued', 'queued'])
  assert.deepEqual(recovered.map((item) => item.id), ['steer', 'queued'])
})
