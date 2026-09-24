import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createWorkspaceStore } = require('../../public/workspace-store.js')

/**
 * 创建使用内存键值存储和临时根目录的工作区服务。
 * @param {string} rootDirectory 工作区临时根目录。
 * @returns {{store: ReturnType<typeof createWorkspaceStore>, values: Map<string, unknown>}} 工作区服务和底层存储。
 */
function createTestStore(rootDirectory) {
  const values = new Map()
  const store = createWorkspaceStore({
    rootDirectory,
    storageKey: 'workspaces',
    read: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    write: (key, value) => { values.set(key, structuredClone(value)); return true },
  })
  return { store, values }
}

test('创建托管工作区只创建空目录并为同名目录递增后缀', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-workspace-unit-'))
  try {
    const { store } = createTestStore(temporaryRoot)
    const first = store.create('示例项目')
    const second = store.create('示例项目')

    assert.equal(path.dirname(first.path), temporaryRoot)
    assert.equal(path.basename(second.path), '示例项目-2')
    assert.deepEqual(fs.readdirSync(first.path), [])
    assert.equal(fs.existsSync(path.join(first.path, 'plugin.json')), false)
    assert.equal(first.source, 'managed')
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('登记本地文件夹不会修改内容并复用相同路径记录', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-workspace-unit-'))
  try {
    const localDirectory = path.join(temporaryRoot, 'existing')
    fs.mkdirSync(localDirectory)
    fs.writeFileSync(path.join(localDirectory, 'keep.txt'), '保留内容')
    const { store } = createTestStore(path.join(temporaryRoot, 'managed'))

    const first = store.register(localDirectory)
    const second = store.register(localDirectory)

    assert.equal(first.id, second.id)
    assert.equal(first.source, 'local')
    assert.equal(fs.readFileSync(path.join(localDirectory, 'keep.txt'), 'utf8'), '保留内容')
    assert.deepEqual(fs.readdirSync(localDirectory), ['keep.txt'])
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
