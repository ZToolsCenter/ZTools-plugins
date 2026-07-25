const test = require('node:test')
const assert = require('node:assert/strict')

test('拖到目标卡片时占据目标原来的排序位置', async () => {
  const { moveProviderToTarget } = await import('../src/providerOrder.js')

  assert.deepEqual(moveProviderToTarget(['one', 'two', 'three'], 'one', 'two'), ['two', 'one', 'three'])
  assert.deepEqual(moveProviderToTarget(['one', 'two', 'three'], 'two', 'one'), ['two', 'one', 'three'])
  assert.deepEqual(moveProviderToTarget(['one', 'two', 'three'], 'one', 'three'), ['two', 'three', 'one'])
  assert.deepEqual(moveProviderToTarget(['one', 'two', 'three'], 'three', 'one'), ['three', 'one', 'two'])
})

test('无效或相同卡片拖拽保持顺序不变', async () => {
  const { moveProviderToTarget } = await import('../src/providerOrder.js')
  const original = ['one', 'two']

  assert.deepEqual(moveProviderToTarget(original, 'one', 'one'), original)
  assert.deepEqual(moveProviderToTarget(original, 'missing', 'two'), original)
  assert.deepEqual(moveProviderToTarget(original, 'one', 'missing'), original)
  assert.deepEqual(original, ['one', 'two'])
})
