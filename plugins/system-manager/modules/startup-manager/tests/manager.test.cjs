'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createItem } = require('../public/preload/core/model.cjs')
const { createManager, SNAPSHOT_TTL_MS } = require('../public/preload/core/manager.cjs')

function item(overrides = {}) {
  return createItem({
    key: 'user:test', name: 'Test Startup', scope: 'user', kind: 'launch-agent',
    source: { label: 'Fixture', location: '/Users/demo/Library/LaunchAgents/test.plist' },
    trigger: '登录时', commandSummary: '/Users/demo/bin/test', enabled: true, running: false, status: 'idle',
    action: { canToggle: true, requiresElevation: false, reason: '可管理' }, internal: { secretPath: '/Users/demo/private' }, ...overrides,
  }, '/Users/demo')
}

function createAdapter(overrides = {}) {
  let enabled = true
  const adapter = {
    async scan() { return { items: [item({ enabled })], warnings: [] } },
    async applyEnabled(target, next) { const before = enabled; enabled = next; return { kind: 'fixture', enabled: before, state: { enabled, running: false } } },
    async undo(target, rollback) { enabled = rollback.enabled },
    setState(value) { enabled = value },
  }
  return Object.assign(adapter, overrides)
}

test('scan produces opaque snapshot/item IDs and strips internal targets', async () => {
  const manager = createManager({ platform: 'linux', adapter: createAdapter(), clock: () => 1_700_000_000_000 })
  const result = await manager.scan()
  assert.match(result.snapshotId, /^[0-9a-f-]{36}$/)
  assert.match(result.items[0].id, /^[0-9a-f-]{36}$/)
  assert.equal(JSON.stringify(result).includes('secretPath'), false)
  assert.equal(result.items[0].source.location.includes('demo'), false)
})

test('createItem clamps retained metadata before snapshots store it', () => {
  const value = item({ metadata: { description: 'x'.repeat(10_000), publisher: 'Acme', untrusted: 'y'.repeat(10_000) } })
  assert.equal(value.metadata.description.length, 200)
  assert.equal(value.metadata.publisher, 'Acme')
  assert.equal(Object.hasOwn(value.metadata, 'untrusted'), false)
})

test('internal identity keys do not collide after display-style cleanup or truncation', () => {
  assert.notEqual(item({ key: 'win32:Task Name' }).key, item({ key: 'win32:Task  Name' }).key)
  const prefix = 'linux:desktop:' + 'x'.repeat(600)
  assert.notEqual(item({ key: `${prefix}:first` }).key, item({ key: `${prefix}:second` }).key)
})

test('scan is single-flight and shares one coherent snapshot', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const adapter = createAdapter({ async scan() { calls += 1; await gate; return { items: [item()], warnings: [] } } })
  const manager = createManager({ platform: 'linux', adapter })
  const first = manager.scan(); const second = manager.scan(); release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(a.snapshotId, b.snapshotId)
})

test('unknown item IDs and expired snapshots cannot reach adapter', async () => {
  let now = 10
  let calls = 0
  const adapter = createAdapter({ async applyEnabled() { calls += 1 } })
  const manager = createManager({ platform: 'linux', adapter, clock: () => now })
  const result = await manager.scan()
  await assert.rejects(manager.setEnabled({ snapshotId: result.snapshotId, itemId: 'forged', enabled: false }), (error) => error.code === 'ITEM_NOT_FOUND')
  now += SNAPSHOT_TTL_MS + 1
  await assert.rejects(manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false }), (error) => error.code === 'SNAPSHOT_EXPIRED')
  assert.equal(calls, 0)
})

test('read-only system items are rejected before mutation', async () => {
  let calls = 0
  const adapter = createAdapter({
    async scan() { return { items: [item({ scope: 'system', kind: 'service', action: { canToggle: false, requiresElevation: true, reason: '系统服务只读' } })], warnings: [] } },
    async applyEnabled() { calls += 1 },
  })
  const manager = createManager({ platform: 'linux', adapter })
  const result = await manager.scan()
  await assert.rejects(manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false }), (error) => error.code === 'READ_ONLY')
  assert.equal(calls, 0)
})

test('per-item mutex rejects concurrent toggle and failed actions create no journal', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const adapter = createAdapter({ async applyEnabled() { await gate; return { kind: 'fixture', enabled: true } } })
  const manager = createManager({ platform: 'linux', adapter })
  const result = await manager.scan()
  const request = { snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false }
  const first = manager.setEnabled(request)
  await assert.rejects(manager.setEnabled(request), (error) => error.code === 'ITEM_BUSY')
  release(); const changed = await first
  assert.equal(changed.changed, true)
  assert.equal(manager._state.operations.size, 1)
  assert.equal(Object.hasOwn(manager._state.operations.get(changed.operationId), 'snapshot'), false)

  const failure = createManager({ platform: 'linux', adapter: createAdapter({ async applyEnabled() { throw new Error('boom') } }) })
  const failureScan = await failure.scan()
  await assert.rejects(failure.setEnabled({ snapshotId: failureScan.snapshotId, itemId: failureScan.items[0].id, enabled: false }))
  assert.equal(failure._state.operations.size, 0)
})

test('scan and mutations share one global execution gate', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const adapter = {
    async scan() {
      return { items: [item({ key: 'user:first' }), item({ key: 'user:second' })], warnings: [] }
    },
    async applyEnabled() { await gate; return { kind: 'fixture', enabled: true, state: { enabled: false, running: false } } },
    async undo() {},
  }
  const manager = createManager({ platform: 'linux', adapter })
  const result = await manager.scan()
  const first = manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false })

  await assert.rejects(manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[1].id, enabled: false }), (error) => error.code === 'ITEM_BUSY')
  await assert.rejects(manager.scan(), (error) => error.code === 'ITEM_BUSY')
  release()
  await first
})

test('undo is one-time and restores the previous state', async () => {
  let undoCalls = 0
  const adapter = createAdapter()
  adapter.undo = async (target, rollback) => { undoCalls += 1; assert.equal(rollback.enabled, true); adapter.setState(true) }
  const manager = createManager({ platform: 'linux', adapter })
  const result = await manager.scan()
  const changed = await manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false })
  assert.equal(changed.item.enabled, false)
  const restored = await manager.undo({ operationId: changed.operationId })
  assert.equal(restored.item.enabled, true)
  assert.equal(undoCalls, 1)
  await assert.rejects(manager.undo({ operationId: changed.operationId }), (error) => error.code === 'OPERATION_NOT_FOUND')
})

test('a newer operation on the same target invalidates the older undo record', async () => {
  const adapter = createAdapter()
  const manager = createManager({ platform: 'linux', adapter })
  const result = await manager.scan()
  const first = await manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false })
  const second = await manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: true })
  assert.notEqual(first.operationId, second.operationId)
  await assert.rejects(manager.undo({ operationId: first.operationId }), (error) => error.code === 'OPERATION_NOT_FOUND')
})

test('the global undo journal retains only the latest operation', async () => {
  const states = new Map([['user:first', true], ['user:second', true]])
  const adapter = {
    async scan() {
      return {
        items: [...states].map(([key, enabled]) => item({ key, name: key, enabled })),
        warnings: [],
      }
    },
    async applyEnabled(target, enabled) {
      const before = states.get(target.name)
      states.set(target.name, enabled)
      return { kind: 'fixture', enabled: before, state: { enabled, running: false } }
    },
    async undo(target, rollback) { states.set(target.name, rollback.enabled) },
  }
  const manager = createManager({ platform: 'linux', adapter })
  const result = await manager.scan()
  const first = await manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[0].id, enabled: false })
  const second = await manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[1].id, enabled: false })

  assert.equal(manager._state.operations.size, 1)
  assert.equal(manager._state.operations.has(second.operationId), true)
  await assert.rejects(manager.undo({ operationId: first.operationId }), (error) => error.code === 'OPERATION_NOT_FOUND')
})

test('refresh and undo preserve targets whose raw identities clean to the same display key', async () => {
  for (const [firstKey, secondKey] of [
    ['win32:task:Task Name', 'win32:task:Task  Name'],
    [`linux:desktop:${'x'.repeat(600)}:first`, `linux:desktop:${'x'.repeat(600)}:second`],
  ]) {
    const states = new Map([[firstKey, true], [secondKey, true]])
    let undoTarget = null
    const adapter = {
      async scan() {
        return {
          items: [...states].map(([rawKey, enabled], index) => item({
            key: rawKey,
            name: index === 0 ? 'First target' : 'Second target',
            enabled,
            internal: { rawKey },
          })),
          warnings: [],
        }
      },
      async applyEnabled(target, enabled) {
        const before = states.get(target.internal.rawKey)
        states.set(target.internal.rawKey, enabled)
        return { kind: 'fixture', enabled: before, state: { enabled, running: false } }
      },
      async undo(target, rollback) {
        undoTarget = target.internal.rawKey
        states.set(target.internal.rawKey, rollback.enabled)
      },
    }
    const manager = createManager({ platform: 'linux', adapter })
    const result = await manager.scan()
    const changed = await manager.setEnabled({ snapshotId: result.snapshotId, itemId: result.items[1].id, enabled: false })
    await manager.undo({ operationId: changed.operationId })
    assert.equal(undoTarget, secondKey)
    assert.equal(states.get(firstKey), true)
    assert.equal(states.get(secondKey), true)
  }
})

test('undo uses authoritative rescan to restore running state', async () => {
  let enabled = true
  const adapter = {
    async scan() { return { items: [item({ enabled, running: enabled })], warnings: [] } },
    async applyEnabled(target, next) { const before = enabled; enabled = next; return { enabled: before } },
    async undo(target, rollback) { enabled = rollback.enabled; return { state: { enabled, running: enabled } } },
  }
  const manager = createManager({ platform: 'linux', adapter })
  const scan = await manager.scan()
  const changed = await manager.setEnabled({ snapshotId: scan.snapshotId, itemId: scan.items[0].id, enabled: false })
  const restored = await manager.undo({ operationId: changed.operationId })
  assert.equal(restored.item.enabled, true)
  assert.equal(restored.item.running, true)
})

test('verified mutation keeps fallback state and undo journal when rescan fails', async () => {
  let scans = 0
  const adapter = {
    async scan() { scans += 1; if (scans > 1) throw new Error('temporary scan failure'); return { items: [item()], warnings: [] } },
    async applyEnabled() { return { enabled: true, state: { enabled: false, running: false } } },
    async undo() { return { state: { enabled: true, running: true } } },
  }
  const manager = createManager({ platform: 'linux', adapter })
  const scan = await manager.scan()
  const changed = await manager.setEnabled({ snapshotId: scan.snapshotId, itemId: scan.items[0].id, enabled: false })
  assert.equal(changed.item.enabled, false)
  assert.equal(changed.item.running, false)
  assert.equal(manager._state.operations.has(changed.operationId), true)
})

test('rollback journal survives a new manager session and reconciles undo', async () => {
  const storage = new Map()
  const journalStore = {
    async get(key) { return storage.get(key) || null },
    async set(key, value) { storage.set(key, value) },
    async remove(key) { storage.delete(key) },
  }
  const adapter = createAdapter()
  const first = createManager({ platform: 'linux', adapter, storage: journalStore, clock: () => 1_700_000_000_000 })
  const scan = await first.scan()
  const changed = await first.setEnabled({ snapshotId: scan.snapshotId, itemId: scan.items[0].id, enabled: false })
  assert.equal(storage.has('startup-rollback-v1'), true)

  const second = createManager({ platform: 'linux', adapter, storage: journalStore, clock: () => 1_700_000_000_000 })
  const resumed = await second.scan()
  assert.match(resumed.warnings.join(' '), /恢复.*撤销记录/)
  assert.equal(second._state.operations.has(changed.operationId), true)
  await second.undo({ operationId: changed.operationId })
  assert.equal(storage.has('startup-rollback-v1'), false)
})

test('shutdown rejects new startup writes while allowing the active call to drain', async () => {
  const adapter = createAdapter()
  const manager = createManager({ platform: 'linux', adapter })
  const scan = await manager.scan()
  await manager.shutdown()
  await assert.rejects(manager.setEnabled({ snapshotId: scan.snapshotId, itemId: scan.items[0].id, enabled: false }), (error) => error.code === 'SHUTTING_DOWN')
})
