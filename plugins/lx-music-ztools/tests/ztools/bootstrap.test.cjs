const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
test('unsupported host bootstrap exposes the concrete preload failure to the product page', () => {
  const window = {}
  vm.runInNewContext(fs.readFileSync('src-ztools/preload/services.js', 'utf8'), {
    window, console: { error() {} }, require() { throw new Error('No such built-in module: node:sqlite') },
  })
  assert.match(window.lxBootstrapError, /node:sqlite/)
  assert.equal(window.lxHost, undefined)
})
