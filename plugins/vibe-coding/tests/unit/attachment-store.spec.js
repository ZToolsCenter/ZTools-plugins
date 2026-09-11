import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAttachmentStore } = require('../../public/attachment-store.js')

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('图片附件按 sha256 内容寻址保存且引用不包含 Base64', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-attachment-test-'))
  try {
    const store = createAttachmentStore(root)
    const reference = store.saveImage({ bytes: ONE_PIXEL_PNG, mediaType: 'image/png', name: 'pixel.png' })
    assert.equal(reference.mediaType, 'image/png')
    assert.equal(reference.width, 1)
    assert.equal(reference.height, 1)
    assert.match(reference.attachmentId, /^sha256:[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(reference).includes('iVBOR'), false)
    const read = store.readImage(reference.attachmentId)
    assert.deepEqual(read.bytes, ONE_PIXEL_PNG)
    assert.equal(store.getObjectPath(reference.attachmentId).includes(reference.attachmentId.slice(7)), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('图片附件拒绝 MIME 不匹配或超过 5 MB', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-attachment-test-'))
  try {
    const store = createAttachmentStore(root)
    assert.throws(() => store.saveImage({ bytes: ONE_PIXEL_PNG, mediaType: 'image/jpeg' }), /MIME/) 
    assert.throws(() => store.saveImage({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1), mediaType: 'image/png' }), /5 MB/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
