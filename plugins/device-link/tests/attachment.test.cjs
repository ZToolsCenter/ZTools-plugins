'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { saveAttachmentFile } = require('../public/preload/core/attachment')

function saveHost(downloadsPath, destination, capture = () => {}) {
  return {
    getPath(name) {
      assert.equal(name, 'downloads')
      return downloadsPath
    },
    showSaveDialog(options) {
      capture(options)
      return destination
    },
  }
}

test('attachment save reports missing and cancelled outcomes', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-attachment-state-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let dialogCalls = 0
  const host = saveHost(root, undefined, () => { dialogCalls += 1 })

  assert.deepEqual(await saveAttachmentFile(null, host), { status: 'missing' })
  assert.deepEqual(await saveAttachmentFile({ path: path.join(root, 'missing.bin'), name: 'missing.bin' }, host), { status: 'missing' })
  assert.equal(dialogCalls, 0)

  const source = path.join(root, 'source.bin')
  fs.writeFileSync(source, 'payload')
  assert.deepEqual(await saveAttachmentFile({ path: source, name: 'source.bin' }, host), { status: 'cancelled' })
  assert.equal(dialogCalls, 1)
})

test('attachment save copies the file and sanitizes the suggested filename', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-attachment-copy-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source.bin')
  const destination = path.join(root, 'saved.bin')
  fs.writeFileSync(source, Buffer.alloc(2 * 1024 * 1024, 7))
  let options

  const result = await saveAttachmentFile(
    { path: source, name: '../../phone:image?.bin' },
    saveHost(root, destination, (value) => { options = value }),
  )

  assert.deepEqual(result, { status: 'saved', name: 'saved.bin' })
  assert.equal(options.defaultPath, path.join(root, 'phone_image_.bin'))
  assert.equal(fs.statSync(destination).size, fs.statSync(source).size)
  assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source))
})

test('attachment save preserves a same-path source and surfaces copy failures', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-attachment-error-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source.bin')
  fs.writeFileSync(source, 'keep-me')

  assert.deepEqual(
    await saveAttachmentFile({ path: source, name: 'source.bin' }, saveHost(root, source)),
    { status: 'saved', name: 'source.bin' },
  )
  assert.equal(fs.readFileSync(source, 'utf8'), 'keep-me')

  const unavailable = path.join(root, 'missing-directory', 'saved.bin')
  await assert.rejects(
    saveAttachmentFile({ path: source, name: 'source.bin' }, saveHost(root, unavailable)),
    (error) => error.code === 'ENOENT',
  )
})
