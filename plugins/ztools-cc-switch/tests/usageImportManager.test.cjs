'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')
const execFile = promisify(execFileCallback)
const { createActivityStore } = require('../preload/activityStore')
const { createUsageImportManager, parseClaude, parseCodex, parseGemini, parseOpenCodeMessage } = require('../preload/usageImportManager')

test('四类上游会话格式转换为统一用量记录', () => {
  const claude = parseClaude([
    { type: 'assistant', sessionId: 'c1', timestamp: '2026-07-20T10:00:00Z', message: { id: 'msg1', model: 'claude-sonnet', usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 4 } } },
    { type: 'assistant', sessionId: 'c1', timestamp: '2026-07-20T10:00:01Z', message: { id: 'msg1', model: 'claude-sonnet', stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 4 } } }
  ])
  assert.equal(claude.length, 1); assert.equal(claude[0].outputTokens, 20); assert.equal(claude[0].dataSource, 'session_log')

  const codex = parseCodex([
    { type: 'session_meta', payload: { id: 'x1' } }, { type: 'turn_context', payload: { model: 'gpt-5.2' } },
    { type: 'event_msg', timestamp: '2026-07-20T10:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 } } } },
    { type: 'event_msg', timestamp: '2026-07-20T10:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 160, cached_input_tokens: 70, output_tokens: 25 } } } }
  ])
  assert.equal(codex.length, 2); assert.deepEqual([codex[1].inputTokens, codex[1].cacheReadTokens, codex[1].outputTokens], [60, 20, 15])

  const gemini = parseGemini({ sessionId: 'g1', messages: [{ id: 'm1', type: 'gemini', timestamp: '2026-07-20T10:00:00Z', model: 'gemini-2.5-pro', tokens: { input: 100, output: 20, thoughts: 5, cached: 30 } }] })
  assert.equal(gemini[0].outputTokens, 25); assert.equal(gemini[0].cacheReadTokens, 30)

  const opencode = parseOpenCodeMessage({ role: 'assistant', modelID: 'anthropic/claude', time: { created: 1000, completed: 2000 }, tokens: { input: 7, output: 8, reasoning: 2, cache: { read: 3, write: 4 } }, cost: 0.01 }, 'om1', 'os1')
  assert.equal(opencode.outputTokens, 10); assert.equal(opencode.cacheCreationTokens, 4); assert.equal(opencode.totalCostUsd, 0.01)
})

test('同步临时 Home 中四类来源，增量重复运行不重复计数', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-usage-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const roots = { claude: path.join(root, 'claude'), codex: [path.join(root, 'codex'), path.join(root, 'codex-archive')], gemini: path.join(root, 'gemini'), opencodeStorage: path.join(root, 'opencode-storage'), opencodeDb: path.join(root, 'opencode.db') }
  await Promise.all([roots.claude, roots.codex[0], roots.gemini, path.join(roots.opencodeStorage, 'message', 'ses_1')].map((dir) => fs.mkdir(dir, { recursive: true })))
  await fs.writeFile(path.join(roots.claude, 'c.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'c1', timestamp: '2026-07-20T10:00:00Z', message: { id: 'cm1', model: 'claude-sonnet', stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 4 } } }) + '\n')
  await fs.writeFile(path.join(roots.codex[0], 'x.jsonl'), [
    { type: 'session_meta', payload: { id: 'x1' } }, { type: 'turn_context', payload: { model: 'gpt-5' } },
    { type: 'event_msg', timestamp: '2026-07-20T10:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 2 } } } }
  ].map(JSON.stringify).join('\n') + '\n')
  await fs.writeFile(path.join(roots.gemini, 'session-g.json'), JSON.stringify({ sessionId: 'g1', messages: [{ id: 'gm1', type: 'gemini', timestamp: '2026-07-20T10:02:00Z', model: 'gemini-pro', tokens: { input: 8, output: 3 } }] }))
  await fs.writeFile(path.join(roots.opencodeStorage, 'message', 'ses_1', 'om1.json'), JSON.stringify({ id: 'om1', role: 'assistant', modelID: 'openai/gpt', time: { created: 1784541780000, completed: 1784541781000 }, tokens: { input: 6, output: 2 } }))

  const store = createActivityStore({ dataDir: path.join(root, 'data') })
  const manager = createUsageImportManager({ homeDir: root, dataDir: path.join(root, 'data'), activityStore: store, roots })
  const first = await manager.sync()
  assert.equal(first.imported, 4); assert.equal(first.filesChanged, 4); assert.equal(first.errors.length, 0)
  const second = await manager.sync()
  assert.equal(second.imported, 0); assert.equal(second.filesChanged, 0)
  assert.deepEqual((await store.dataSources()).map((item) => item.dataSource).sort(), ['codex_session', 'gemini_session', 'opencode_session', 'session_log'])

  await fs.appendFile(path.join(roots.codex[0], 'x.jsonl'), JSON.stringify({ type: 'event_msg', timestamp: '2026-07-20T10:03:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 7 } } } }) + '\n')
  const third = await manager.sync()
  assert.equal(third.imported, 1); assert.equal(third.filesChanged, 1)
})

test('OpenCode SQLite 完成态 assistant 用量可导入', async (t) => {
  try { await execFile('sqlite3', ['-version']) } catch { t.skip('系统没有 sqlite3'); return }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-usage-sqlite-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const db = path.join(root, 'opencode.db')
  await execFile('sqlite3', [db, "CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO message VALUES('m1','s1',1,'{\"role\":\"assistant\",\"modelID\":\"gpt\",\"time\":{\"created\":1000,\"completed\":2000},\"tokens\":{\"input\":5,\"output\":2}}');"])
  const roots = { claude: path.join(root, 'none-c'), codex: [path.join(root, 'none-x')], gemini: path.join(root, 'none-g'), opencodeStorage: path.join(root, 'none-o'), opencodeDb: db }
  const store = createActivityStore({ dataDir: path.join(root, 'data') })
  const manager = createUsageImportManager({ homeDir: root, dataDir: path.join(root, 'data'), activityStore: store, roots })
  const result = await manager.sync()
  assert.equal(result.imported, 1); assert.equal(result.errors.length, 0)
  assert.equal((await store.query({}))[0].dataSource, 'opencode_session')
})

test('Codex 重建只替换 Codex 会话用量并保留其他来源与游标', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-switch-usage-rebuild-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const roots = {
    claude: path.join(root, 'claude'),
    codex: [path.join(root, 'codex-sessions'), path.join(root, 'codex-archive')],
    gemini: path.join(root, 'gemini'),
    opencodeStorage: path.join(root, 'opencode-storage'),
    opencodeDb: path.join(root, 'opencode.db')
  }
  await Promise.all([dataDir, roots.claude, roots.codex[0], roots.codex[1], roots.gemini].map((dir) => fs.mkdir(dir, { recursive: true })))
  const codexFile = path.join(roots.codex[0], 'session.jsonl')
  await fs.writeFile(codexFile, [
    { type: 'session_meta', payload: { id: 'rebuilt-session' } },
    { type: 'turn_context', payload: { model: 'gpt-5.4' } },
    { type: 'event_msg', timestamp: '2026-07-23T08:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 40, cached_input_tokens: 10, output_tokens: 8 } } } }
  ].map(JSON.stringify).join('\n') + '\n')

  const store = createActivityStore({ dataDir })
  await store.append({ id: 'proxy:kept', createdAt: 1, client: 'codex', inputTokens: 7, outputTokens: 1, statusCode: 200, dataSource: 'proxy' })
  await store.importMany([
    { id: 'claude:kept', createdAt: 2, client: 'claude', inputTokens: 5, outputTokens: 2, statusCode: 200, dataSource: 'session_log' },
    { id: 'codex:stale', createdAt: 3, client: 'codex', inputTokens: 999, outputTokens: 99, statusCode: 200, dataSource: 'codex_session' }
  ])
  const otherCursor = path.join(roots.claude, 'keep.jsonl')
  const staleCodexCursor = path.join(roots.codex[1], 'stale.jsonl')
  const statePath = path.join(dataDir, 'usage-import-state.json')
  await fs.writeFile(statePath, JSON.stringify({ version: 1, files: { [otherCursor]: '11:22', [staleCodexCursor]: '33:44', 'sqlite:/tmp/opencode.db': '55:66' }, lastSyncAt: 123 }, null, 2))

  const manager = createUsageImportManager({ homeDir: root, dataDir, activityStore: store, roots })
  const first = await manager.rebuildCodex()
  assert.equal(first.removed, 1)
  assert.equal(first.imported, 1)
  assert.equal(first.filesScanned, 1)
  assert.equal(first.recordsParsed, 1)
  assert.equal(first.errors.length, 0)
  assert.ok(first.backupPath)
  assert.ok(first.stateBackupPath)
  await Promise.all([fs.access(first.backupPath), fs.access(first.stateBackupPath)])

  const rows = await store.query({ limit: 20 })
  assert.equal(rows.some((row) => row.id === 'codex:stale'), false)
  assert.equal(rows.some((row) => row.id === 'proxy:kept'), true)
  assert.equal(rows.some((row) => row.id === 'claude:kept'), true)
  const rebuilt = rows.find((row) => row.dataSource === 'codex_session')
  assert.ok(rebuilt)
  assert.equal(rebuilt.sessionId, 'rebuilt-session')
  assert.deepEqual([rebuilt.inputTokens, rebuilt.cacheReadTokens, rebuilt.outputTokens], [40, 10, 8])

  const nextState = JSON.parse(await fs.readFile(statePath, 'utf8'))
  assert.equal(nextState.files[otherCursor], '11:22')
  assert.equal(nextState.files['sqlite:/tmp/opencode.db'], '55:66')
  assert.equal(staleCodexCursor in nextState.files, false)
  assert.match(nextState.files[codexFile], /^\d+:/)

  const second = await manager.rebuildCodex()
  assert.equal(second.removed, 1)
  assert.equal(second.imported, 1)
  const afterSecond = await store.query({ limit: 20 })
  assert.equal(afterSecond.filter((row) => row.dataSource === 'codex_session').length, 1)
  assert.equal(afterSecond.filter((row) => ['proxy:kept', 'claude:kept'].includes(row.id)).length, 2)
})
