'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { MAX_MUTABLE_FILE_BYTES, readBoundedFile } = require('../public/preload/core/bounded-file.cjs')

function fileInfo(size = 1) {
  return { dev: 1, ino: 2, mtimeMs: 3, size, isFile: () => true, isSymbolicLink: () => false }
}

test('bounded startup metadata rejects oversized files before open or read', async () => {
  let opened = 0
  let reads = 0
  const fileSystem = {
    lstat: async () => fileInfo(MAX_MUTABLE_FILE_BYTES + 1),
    open: async () => { opened += 1 },
    readFile: async () => { reads += 1 },
  }
  await assert.rejects(readBoundedFile('/home/user/.config/autostart/huge.desktop', fileSystem), (error) => error?.code === 'UNSAFE_FILE')
  assert.equal(opened, 0)
  assert.equal(reads, 0)
})

test('bounded startup metadata detects growth through the opened file handle', async () => {
  const info = fileInfo(1)
  let stats = 0
  let closed = false
  const handle = {
    stat: async () => { stats += 1; return info },
    read: async (buffer) => { buffer.write('ab'); return { bytesRead: 2 } },
    close: async () => { closed = true },
  }
  const fileSystem = { lstat: async () => info, open: async () => handle }
  await assert.rejects(readBoundedFile('/home/user/.config/autostart/growing.desktop', fileSystem), (error) => error?.code === 'UNSAFE_FILE')
  assert.equal(stats, 2)
  assert.equal(closed, true)
})
