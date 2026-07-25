'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { CLIENT_IDS, STORAGE_KEY, createClientVisibilityManager } = require('../preload/clientVisibility')

function createStorage(initial) {
  const values = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]])
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    value: () => values.get(STORAGE_KEY)
  }
}

test('客户端菜单默认全部显示并按固定顺序持久化', () => {
  const storage = createStorage()
  const manager = createClientVisibilityManager({ storage })
  assert.deepEqual(manager.getVisibleClients(), CLIENT_IDS)
  assert.deepEqual(manager.setVisibleClients(['codex', 'claude', 'codex']), ['claude', 'codex'])
  assert.deepEqual(storage.value(), ['claude', 'codex'])
})

test('客户端菜单支持仅显示 Codex，并拒绝隐藏全部或未知客户端', () => {
  const storage = createStorage()
  const manager = createClientVisibilityManager({ storage })
  assert.deepEqual(manager.setVisibleClients(['codex']), ['codex'])
  assert.throws(() => manager.setVisibleClients([]), /至少保留一个/)
  assert.throws(() => manager.setVisibleClients(['codex', 'unknown']), /未知客户端菜单/)
  assert.deepEqual(manager.getVisibleClients(), ['codex'])
})

test('损坏的客户端菜单偏好安全降级为全部显示', () => {
  const manager = createClientVisibilityManager({ storage: createStorage([]) })
  assert.deepEqual(manager.getVisibleClients(), CLIENT_IDS)
})
