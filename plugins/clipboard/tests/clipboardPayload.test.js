import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClipboardPayload } from '../src/utils/clipboardPayload.js'

test('joins selected text items in the provided selection order', () => {
  assert.deepEqual(
    buildClipboardPayload([
      { type: 'text', content: 'first' },
      { type: 'text', content: 'second\nline' }
    ]),
    { type: 'text', content: 'first\nsecond\nline' }
  )
})

test('keeps a single image as image content', () => {
  assert.deepEqual(
    buildClipboardPayload([{ type: 'image', imagePath: '/tmp/image.png' }]),
    { type: 'image', content: '/tmp/image.png' }
  )
})

test('converts multiple images into unique file paths', () => {
  assert.deepEqual(
    buildClipboardPayload([
      { type: 'image', imagePath: '/tmp/a.png' },
      { type: 'image', content: 'file:///tmp/b.png' },
      { type: 'image', imagePath: '/tmp/a.png' }
    ]),
    { type: 'file', content: ['/tmp/a.png', '/tmp/b.png'] }
  )
})

test('flattens file records and removes duplicate paths', () => {
  assert.deepEqual(
    buildClipboardPayload([
      { type: 'file', files: [{ path: '/tmp/a.txt' }, { path: '/tmp/b.txt' }] },
      { type: 'file', files: [{ path: '/tmp/b.txt' }, { path: '/tmp/c.txt' }] }
    ]),
    { type: 'file', content: ['/tmp/a.txt', '/tmp/b.txt', '/tmp/c.txt'] }
  )
})

test('rejects mixed or empty selections', () => {
  assert.equal(buildClipboardPayload([]), null)
  assert.equal(buildClipboardPayload([
    { type: 'text', content: 'text' },
    { type: 'image', imagePath: '/tmp/image.png' }
  ]), null)
})
