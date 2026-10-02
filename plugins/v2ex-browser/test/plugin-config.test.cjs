const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('ZTools 仅注册 v2ex 和 v2 启动指令', () => {
  const plugin = JSON.parse(readFileSync(path.join(__dirname, '../src-ztools/plugin.json'), 'utf8'))

  assert.deepEqual(plugin.features[0].cmds, ['v2ex', 'v2'])
})
