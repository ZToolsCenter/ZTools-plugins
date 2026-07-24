const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { getKillCommand } = require('./utils')

describe('getKillCommand', () => {
  it('returns taskkill with /f and /t for any pid', () => {
    const { cmd, args } = getKillCommand(1234)
    assert.equal(cmd, 'taskkill')
    assert.deepEqual(args, ['/pid', '1234', '/f', '/t'])
  })

  it('stringifies pid', () => {
    const { args } = getKillCommand(98765)
    assert.equal(args[1], '98765')
    assert.equal(typeof args[1], 'string')
  })

  it('includes /t flag for process tree termination', () => {
    const { args } = getKillCommand(42)
    assert.ok(args.includes('/t'), 'should include /t flag')
  })

  it('includes /f flag for force termination', () => {
    const { args } = getKillCommand(42)
    assert.ok(args.includes('/f'), 'should include /f flag')
  })
})
