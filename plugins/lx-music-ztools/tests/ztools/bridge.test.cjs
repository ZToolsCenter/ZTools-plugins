const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')

test('subscriptions remove the same callback and once fires once', async () => {
  const bridge = createBridge({ double: value => value * 2 })
  let seen = 0
  const listener = value => { seen += value }
  bridge.on('change', listener); bridge.once('change', listener)
  bridge.emit('change', 1); bridge.emit('change', 1)
  bridge.off('change', listener); bridge.emit('change', 5)
  assert.equal(seen, 3)
  assert.equal(await bridge.invoke('double', 6), 12)
  await assert.rejects(bridge.invoke('__proto__'), { code: 'UNKNOWN_CHANNEL' })
  assert.throws(() => bridge.readSnapshot('unready'), { code: 'SNAPSHOT_UNREADY' })
  bridge.setSnapshot('setting', { volume: 0.5 })
  const setting = bridge.readSnapshot('setting'); setting.volume = 0
  assert.equal(bridge.readSnapshot('setting').volume, 0.5)
})

test('dispose clears subscriptions and prevents new work', async () => {
  const bridge = createBridge({ ping: () => 'pong' })
  await bridge.dispose()
  await assert.rejects(bridge.invoke('ping'), { code: 'DISPOSED' })
})
