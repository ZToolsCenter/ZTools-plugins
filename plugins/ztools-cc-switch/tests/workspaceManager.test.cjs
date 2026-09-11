'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createWorkspaceManager } = require('../preload/workspaceManager')

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-workspace-'))
  return { root, manager: createWorkspaceManager({ homeDir: root, dataDir: path.join(root, 'data') }) }
}

test('Workspace 文件使用严格白名单并进行原子备份写入', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  assert.throws(() => manager.readWorkspaceFile('../.zshrc'), /不允许/)
  await manager.writeWorkspaceFile('AGENTS.md', '# first')
  await manager.writeWorkspaceFile('AGENTS.md', '# second')
  assert.equal(await manager.readWorkspaceFile('AGENTS.md'), '# second')
  assert.equal(await fs.readFile(path.join(root, '.openclaw/workspace/AGENTS.md.bak'), 'utf8'), '# first')
  const files = await manager.listWorkspaceFiles()
  assert.equal(files.find((item) => item.filename === 'AGENTS.md').exists, true)
})

test('Daily Memory 校验真实日期、搜索 Unicode 并按日期倒序', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  await assert.rejects(manager.writeDailyMemoryFile('../../escape.md', 'x'), /YYYY-MM-DD/)
  await assert.rejects(manager.writeDailyMemoryFile('2026-02-30.md', 'x'), /日期无效/)
  await manager.writeDailyMemoryFile('2026-07-21.md', '今天完成了路由测试和日志检查。')
  await manager.writeDailyMemoryFile('2026-07-22.md', '修复了 OAuth 路由与中文搜索。')
  assert.deepEqual((await manager.listDailyMemoryFiles()).map((item) => item.filename), ['2026-07-22.md', '2026-07-21.md'])
  const result = await manager.searchDailyMemoryFiles('路由')
  assert.equal(result.length, 2)
  assert.equal(result[0].matchCount, 1)
  assert.match(result[0].snippet, /OAuth/)
})

test('Daily Memory 删除进入回收站且可恢复', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  await manager.writeDailyMemoryFile('2026-07-22.md', 'recover me')
  const deleted = await manager.deleteDailyMemoryFile('2026-07-22.md')
  assert.equal(deleted.deleted, true)
  assert.equal(await manager.readDailyMemoryFile('2026-07-22.md'), null)
  assert.equal((await manager.listTrash()).length, 1)
  await manager.restoreTrash(deleted.trashId)
  assert.equal(await manager.readDailyMemoryFile('2026-07-22.md'), 'recover me')
})

test('拒绝符号链接和超大内容', async (t) => {
  const { root, manager } = await fixture(); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const workspace = path.join(root, '.openclaw/workspace')
  await fs.mkdir(workspace, { recursive: true })
  await fs.symlink(path.join(root, '.zshrc'), path.join(workspace, 'SOUL.md'))
  await assert.rejects(manager.readWorkspaceFile('SOUL.md'), /符号链接/)
  await assert.rejects(manager.writeWorkspaceFile('USER.md', 'x'.repeat(2 * 1024 * 1024 + 1)), /2 MB/)
})
