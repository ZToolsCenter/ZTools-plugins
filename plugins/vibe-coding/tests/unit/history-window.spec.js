import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialHistoryStart, findPreviousHistoryStart, normalizeHistoryStart } from '../../src/services/history-window.js'

/**
 * 创建带稳定 Turn 标识的测试消息。
 * @param {string} turnId Turn 标识。
 * @param {number} index Turn 内消息序号。
 * @returns {{id: string, turnId: string}} 测试消息。
 */
function message(turnId, index) {
  return { id: `${turnId}-${index}`, turnId }
}

test('首次历史窗口限制尾部数量且不会拆开最早可见 Turn', () => {
  const messages = [
    ...Array.from({ length: 45 }, (_, index) => message('turn-a', index)),
    ...Array.from({ length: 10 }, (_, index) => message('turn-b', index)),
    ...Array.from({ length: 45 }, (_, index) => message('turn-c', index)),
  ]

  assert.equal(createInitialHistoryStart(messages, 50), 45)
  assert.deepEqual(messages.slice(createInitialHistoryStart(messages, 50)).map((item) => item.turnId), [
    ...Array(10).fill('turn-b'),
    ...Array(45).fill('turn-c'),
  ])
})

test('向前分页扩展完整 Turn并规范化越界游标', () => {
  const messages = [
    ...Array.from({ length: 30 }, (_, index) => message('turn-a', index)),
    ...Array.from({ length: 30 }, (_, index) => message('turn-b', index)),
    ...Array.from({ length: 30 }, (_, index) => message('turn-c', index)),
  ]

  assert.equal(findPreviousHistoryStart(messages, 60, 20), 30)
  assert.equal(findPreviousHistoryStart(messages, 30, 20), 0)
  assert.equal(normalizeHistoryStart(messages, 999), messages.length)
})
