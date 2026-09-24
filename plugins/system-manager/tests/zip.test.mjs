import assert from 'node:assert/strict'
import { readFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { distRoot, releaseRoot } from '../scripts/config.mjs'
import { createZip, inspectZip, portableEntryKey, safeEntryName, sha256 } from '../scripts/zip.mjs'

test('safeEntryName accepts canonical relative names and rejects traversal/path ambiguity', () => {
  assert.equal(safeEntryName('modules/tool/index.html'), 'modules/tool/index.html')
  for (const value of ['', '/absolute', 'C:/absolute', '../escape', 'a/../b', './a', 'a//b', 'a\\b', `a\0b`, 'plugin.json.', 'file:ads', 'CON', 'aux.txt', 'trailing ', 'bad?/file']) {
    assert.throws(() => safeEntryName(value), /ZIP entry/)
  }
  assert.equal(portableEntryKey('Modules/CAFÉ.txt'), portableEntryKey('modules/cafe\u0301.TXT'))
})

test('createZip rejects duplicate entries and symlink inputs', async (context) => {
  const file = path.join(distRoot, 'index.html')
  const duplicateOutput = path.join(releaseRoot, '.duplicate-entry-test.tmp')
  await assert.rejects(createZip([file, file], distRoot, duplicateOutput), /重复/)
  await rm(duplicateOutput, { force: true })

  const link = path.join(distRoot, '.zip-symlink-test')
  try {
    await symlink(file, link)
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip(`symlink unavailable: ${error.code}`)
      return
    }
    throw error
  }
  try {
    await assert.rejects(createZip([link], distRoot, path.join(releaseRoot, '.symlink-entry-test.tmp')), /安全普通文件/)
  } finally {
    await rm(link, { force: true })
    await rm(path.join(releaseRoot, '.symlink-entry-test.tmp'), { force: true })
  }
})

test('inspectZip compares central method, CRC, sizes and local offset with local records', async () => {
  const original = await readFile(path.join(releaseRoot, 'system-manager-0.2.1.zip'))
  const endOffset = original.length - 22
  assert.equal(original.readUInt32LE(endOffset), 0x06054b50)
  const centralOffset = original.readUInt32LE(endOffset + 16)
  assert.equal(original.readUInt32LE(centralOffset), 0x02014b50)
  const inspected = inspectZip(original)
  const indexEntry = inspected.find((entry) => entry.name === 'index.html')
  assert.equal(indexEntry.sha256, sha256(await readFile(path.join(distRoot, 'index.html'))))
  assert.throws(() => inspectZip(original, { limitBytes: original.length + 1 }), /解压后体积/)

  for (const [fieldOffset, mutate] of [
    [10, (value) => value === 8 ? 0 : 8],
    [16, (value) => (value ^ 1) >>> 0],
    [20, (value) => (value + 1) >>> 0],
    [24, (value) => (value + 1) >>> 0],
    [42, (value) => (value + 1) >>> 0],
  ]) {
    const corrupted = Buffer.from(original)
    if ([10].includes(fieldOffset)) corrupted.writeUInt16LE(mutate(corrupted.readUInt16LE(centralOffset + fieldOffset)), centralOffset + fieldOffset)
    else corrupted.writeUInt32LE(mutate(corrupted.readUInt32LE(centralOffset + fieldOffset)), centralOffset + fieldOffset)
    assert.throws(() => inspectZip(corrupted), /local 与 central|校验失败/)
  }
})
