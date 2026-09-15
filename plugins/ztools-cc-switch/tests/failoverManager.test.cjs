'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createFailoverManager } = require('../preload/failoverManager')

function fixture(overrides = {}) {
  const calls = []; let queue = overrides.queue || []
  const configManager = {
    getFailoverQueue: async () => queue,
    getActiveProvider: async () => overrides.active === null ? null : { id: 'current' },
    addToFailoverQueue: async (_client, id) => { calls.push(['add', id]); queue = [{ providerId: id, priority: 1 }]; return queue },
    removeFromFailoverQueue: async (_client, id) => { calls.push(['remove', id]); queue = []; return queue },
    activateProvider: async (_client, id) => { calls.push(['activate', id]); return { id } }
  }
  const routerManager = {
    status: async () => ({ running: overrides.running !== false, config: { routes: { claude: overrides.routed !== false }, failover: { enabled: { claude: false } } } }),
    saveConfig: async (patch) => { calls.push(['save', patch.failover.enabled.claude]); if (overrides.saveError) throw new Error('save failed'); return { routes: { claude: true }, failover: patch.failover } }
  }
  return { manager: createFailoverManager({ configManager, routerManager }), calls, getQueue: () => queue }
}

test('requires a running taken-over route before enabling failover', async () => {
  await assert.rejects(() => fixture({ running: false }).manager.setEnabled('claude', true), /启动本地路由/)
  await assert.rejects(() => fixture({ routed: false }).manager.setEnabled('claude', true), /路由接管/)
})

test('auto-adds current Provider as P1, activates it and persists the switch', async () => {
  const ctx = fixture()
  const result = await ctx.manager.setEnabled('claude', true)
  assert.equal(result.enabled, true)
  assert.deepEqual(ctx.calls, [['add', 'current'], ['activate', 'current'], ['save', true]])
})

test('rolls back an auto-added queue item when enabling cannot be saved', async () => {
  const ctx = fixture({ saveError: true })
  await assert.rejects(() => ctx.manager.setEnabled('claude', true), /save failed/)
  assert.deepEqual(ctx.calls, [['add', 'current'], ['activate', 'current'], ['save', true], ['remove', 'current']])
  assert.deepEqual(ctx.getQueue(), [])
})

test('disabling preserves the explicit queue', async () => {
  const queue = [{ providerId: 'p1', priority: 1 }]
  const ctx = fixture({ queue })
  const result = await ctx.manager.setEnabled('claude', false)
  assert.equal(result.enabled, false)
  assert.deepEqual(ctx.getQueue(), queue)
  assert.deepEqual(ctx.calls, [['save', false]])
})
