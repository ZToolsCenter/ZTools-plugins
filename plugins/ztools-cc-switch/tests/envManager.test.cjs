'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createEnvManager } = require('../preload/envManager')

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-env-'))
  return {
    root,
    manager: createEnvManager({ homeDir: root, dataDir: path.join(root, 'data'), platform: 'darwin', environment: { ANTHROPIC_API_KEY: 'secret-process-value', PATH: '/bin' } })
  }
}

test('扫描进程与 Shell 冲突但不暴露完整密钥', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, '.zshrc'), '# keep\nexport ANTHROPIC_API_KEY="sk-ant-secret"\nOPENAI_API_KEY=nope\n')
  const result = await manager.scan('claude')
  assert.equal(result.length, 2)
  assert.equal(result.find((item) => item.sourceType === 'process').fixable, false)
  assert.equal(result.find((item) => item.sourceType === 'file').maskedValue.includes('secret'), false)
  assert.equal(JSON.stringify(result).includes('secret-process-value'), false)
})

test('修复前重新扫描，只删除选中的精确行，并可完整恢复', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const zshrc = path.join(root, '.zshrc')
  const original = '# keep\nexport ANTHROPIC_API_KEY="sk-ant-secret"\nexport OTHER_KEY=value\n'
  await fs.writeFile(zshrc, original)
  const conflict = (await manager.scan('claude')).find((item) => item.sourceType === 'file')
  const result = await manager.fix('claude', [conflict.id])
  assert.equal(result.fixed, 1)
  assert.equal(await fs.readFile(zshrc, 'utf8'), '# keep\nexport OTHER_KEY=value\n')
  assert.equal((await manager.listBackups()).length, 1)
  await manager.restore(result.backupId)
  assert.equal(await fs.readFile(zshrc, 'utf8'), original)
})

test('拒绝修复进程变量、过期选择和越界备份', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const processConflict = (await manager.scan('claude')).find((item) => item.sourceType === 'process')
  await assert.rejects(manager.fix('claude', [processConflict.id]), /不能由插件安全修复/)
  await assert.rejects(manager.fix('claude', ['file:.zshrc:99:ANTHROPIC_API_KEY']), /重新扫描/)
  await assert.rejects(manager.restore('../../escape.json'), /备份 ID 无效/)
})
