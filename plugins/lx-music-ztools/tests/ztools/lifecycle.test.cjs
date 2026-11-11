const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createLifecycle } = require('../../src-ztools/preload/runtime/lifecycle.cjs')

test('enter initializes once and hide keeps services alive until kill', async () => {
  let initialized = 0, disposed = 0
  const life = createLifecycle({ initialize: async () => { initialized++ }, dispose: async () => { disposed++ } })
  await Promise.all([life.enter({ code: 'music' }), life.enter({ code: 'music' })])
  await life.out(false); await life.detach()
  assert.equal(initialized, 1); assert.equal(disposed, 0)
  await life.out(true); await life.dispose()
  assert.equal(disposed, 1)
  await assert.rejects(life.enter({ code: 'music' }), { code: 'DISPOSED' })
})
