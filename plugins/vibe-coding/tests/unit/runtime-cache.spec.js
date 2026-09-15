import assert from 'node:assert/strict'
import test from 'node:test'
import { selectRuntimeEvictions } from '../../src/services/runtime-cache.js'

/**
 * 创建默认处于静止状态的测试运行时。
 * @param {string} id 会话标识。
 * @param {number} lastAccessedAt 最近访问时间。
 * @param {Record<string, unknown>} patch 覆盖字段。
 * @returns {Record<string, unknown>} 测试运行时。
 */
function runtime(id, lastAccessedAt, patch = {}) {
  return {
    id,
    lastAccessedAt,
    busy: false,
    compacting: false,
    operationPromise: null,
    requestId: '',
    completedUnread: false,
    input: '',
    inputAttachments: [],
    ...patch,
  }
}

test('LRU 只回收超过容量且最久未访问的静止后台会话', () => {
  const runtimes = Array.from({ length: 8 }, (_, index) => runtime(`session-${index}`, index))
  assert.deepEqual(selectRuntimeEvictions(runtimes, { activeId: 'session-0', limit: 6 }), ['session-1', 'session-2'])
})

test('运行中、持久化中、含草稿和未读完成状态的会话不可回收', () => {
  const pendingIds = new Set(['persisting'])
  const runtimes = [
    runtime('active', 0),
    runtime('running', 1, { busy: true }),
    runtime('persisting', 2),
    runtime('draft', 3, { input: '未发送内容' }),
    runtime('unread', 4, { completedUnread: true }),
    runtime('idle', 5),
    runtime('newer', 6),
  ]
  assert.deepEqual(selectRuntimeEvictions(runtimes, { activeId: 'active', limit: 2, pendingIds }), ['idle', 'newer'])
})
