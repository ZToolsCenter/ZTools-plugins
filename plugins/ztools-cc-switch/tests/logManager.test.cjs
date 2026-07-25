'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createLogManager } = require('../preload/logManager')

test('日志配置规范化并只持久化允许级别', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-log-config-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const manager = createLogManager({ dataDir: root })
  assert.deepEqual(await manager.getConfig(), { enabled: true, level: 'info', retentionDays: 30, maxFileSizeMb: 20, maxRequestEntries: 50000 })
  const saved = await manager.saveConfig({ enabled: false, level: 'invalid', retentionDays: 999, maxFileSizeMb: 0, maxRequestEntries: 4 })
  assert.deepEqual(saved, { enabled: false, level: 'info', retentionDays: 365, maxFileSizeMb: 20, maxRequestEntries: 1000 })
})

test('宿主日志仅捕获插件消息并脱敏常见凭据', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-host-log-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const manager = createLogManager({ dataDir: root }); manager.install(); t.after(() => manager.uninstall())
  console.info('[cc-switch] request', 'Authorization: Bearer secret-token', 'apiKey=sk-abcdefghijk')
  console.info('unrelated frontend message')
  await manager.flush()
  const text = await fs.readFile(path.join(root, 'plugin.log.jsonl'), 'utf8')
  assert.match(text, /\[REDACTED\]/); assert.doesNotMatch(text, /secret-token|sk-abcdefghijk|unrelated frontend/)
})

test('请求日志按本地保留期与条目上限压缩并保留可恢复备份', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-log-retention-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const now = Date.now(); const rows = [{ id: 'old', createdAt: now - 3 * 86400000 }, ...Array.from({ length: 1100 }, (_, index) => ({ id: `new-${index}`, createdAt: now - 1000 + index }))]
  await fs.writeFile(path.join(root, 'request-logs.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`)
  const manager = createLogManager({ dataDir: root }); await manager.saveConfig({ retentionDays: 1, maxRequestEntries: 1000, maxFileSizeMb: 500 })
  const text = await fs.readFile(path.join(root, 'request-logs.jsonl'), 'utf8'); const kept = text.trim().split('\n').map(JSON.parse)
  assert.equal(kept.length, 1000); assert.equal(kept[0].id, 'new-100'); assert.equal(kept.some((row) => row.id === 'old'), false)
  assert.ok((await manager.listFiles()).some((item) => item.name.startsWith('request-logs.jsonl.') && item.name.endsWith('.bak')))
})

test('清理日志使用重命名备份而非直接删除', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-log-clear-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const name of ['plugin.log.jsonl', 'request-logs.jsonl', 'connectivity-check-logs.jsonl']) await fs.writeFile(path.join(root, name), '{}\n')
  const manager = createLogManager({ dataDir: root }); const result = await manager.clearLogs()
  assert.equal(result.cleared, 3); assert.equal(result.backups.length, 3); assert.equal((await manager.listFiles()).length, 3)
})
