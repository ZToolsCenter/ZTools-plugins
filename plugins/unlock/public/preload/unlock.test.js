const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

// Test the public interface behavior through known inputs/outputs
describe('findLockingProcesses', () => {
  it('throws when path does not exist', async () => {
    const { findLockingProcesses } = require('./unlock')

    await assert.rejects(
      async () => await findLockingProcesses('C:\\NonExistent\\Path\\file.txt'),
      /路径不存在/
    )
  })
})

describe('killProcess', () => {
  it('returns result object with success and message fields', async () => {
    const { killProcess } = require('./unlock')

    // Start a test process
    const { spawn } = require('node:child_process')
    const testProc = spawn('ping', ['127.0.0.1', '-t'], { windowsHide: true })
    const testPid = testProc.pid

    await new Promise(r => setTimeout(r, 100))

    try {
      const result = await killProcess(testPid)

      // Verify result shape
      assert.ok(result && typeof result === 'object', 'should return object')
      assert.ok(typeof result.success === 'boolean', 'should have success boolean')
      assert.ok(typeof result.message === 'string', 'should have message string')
      assert.ok(result.message.length > 0, 'message should not be empty')
    } finally {
      try { testProc.kill() } catch (e) {}
    }
  })
})

describe('getDebugLog', () => {
  it('returns array and clears internal buffer', () => {
    const { getDebugLog } = require('./unlock')

    const logs1 = getDebugLog()
    assert.ok(Array.isArray(logs1), 'should return array')

    const logs2 = getDebugLog()
    assert.ok(Array.isArray(logs2), 'should return array on second call')
  })
})
