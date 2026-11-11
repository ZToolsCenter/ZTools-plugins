const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createNativeJobs } = require('../../src-ztools/preload/runtime/native-jobs.cjs')
test('native metadata jobs use a hidden public host window and always close it', async () => {
  const calls = []
  const jobs = createNativeJobs({ ztools: { createBrowserWindow(url, options) {
    calls.push({ url, options })
    return { destroy() { calls.push('closed') }, webContents: { executeJavaScript: async code => { assert.ok(code.includes('lxNativeJobs')); return { title: '中文' } } } }
  } }, files: { scope: { authorize: value => value } } })
  assert.deepEqual(await jobs.run({ filePath: '/selected/.lx-meta-test.mp3', ext: '.mp3' }), { title: '中文' })
  assert.equal(calls[0].options.show, false)
  assert.equal(calls[0].options.webPreferences.preload, 'preload/native-jobs.cjs')
  assert.equal(calls[1], 'closed')
  await jobs.dispose()
  await assert.rejects(jobs.run({ filePath: '/selected/.lx-meta-test.mp3' }), /关闭/)
})
test('disposing rejects an active native job and destroys its child window', async () => {
  let destroyed = false
  const jobs = createNativeJobs({ ztools: { createBrowserWindow: () => ({ destroy() { destroyed = true }, webContents: { executeJavaScript: () => new Promise(() => {}) } }) }, files: { scope: { authorize: value => value } } })
  const pending = jobs.run({ filePath: '/selected/.lx-meta-test.mp3' })
  const rejected = assert.rejects(pending, /关闭/)
  await jobs.dispose(); await rejected
  assert.equal(destroyed, true)
})
