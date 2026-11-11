const { test } = require('node:test')
const assert = require('node:assert/strict')
const context = require('../../src-ztools/preload/runtime/context.cjs')
const main = require('../../src-ztools/preload/runtime/win-main.cjs')
test('simultaneous list/dislike conflicts queue without overwriting another request', () => {
  const events = [], results = []
  context.bridge = { emit: (_name, data) => events.push(data) }
  main.sendSelectMode('device1', 'list', mode => results.push(['list', mode]))
  main.sendSelectMode('device2', 'dislike', mode => results.push(['dislike', mode]))
  assert.equal(events.length, 1)
  assert.throws(() => main.chooseSyncMode('merge_local_remote', 'dislike'), /类型/)
  main.chooseSyncMode('merge_local_remote', 'list')
  assert.deepEqual(results, [['list', 'merge_local_remote']])
  assert.equal(events.at(-1).data.type, 'dislike')
  main.removeSelectModeListener()
  assert.deepEqual(results, [['list', 'merge_local_remote'], ['dislike', null]])
  assert.equal(events.at(-1).action, 'close_select_mode')
  context.bridge = null
})
test('original selected callback cleanup preserves the next queued conflict', () => {
  const results = [], events = []
  context.bridge = { emit: (_name, data) => events.push(data) }
  main.sendSelectMode('one', 'list', mode => { results.push(mode); main.removeSelectModeListener() })
  main.sendSelectMode('two', 'dislike', mode => results.push(mode))
  main.chooseSyncMode('merge_local_remote', 'list')
  assert.deepEqual(results, ['merge_local_remote'])
  assert.equal(events.at(-1).data.type, 'dislike')
  main.chooseSyncMode('local', 'dislike')
  assert.deepEqual(results, ['merge_local_remote', 'local'])
  context.bridge = null
})
