const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { createFileScope } = require('../../src-ztools/preload/runtime/files.cjs')
const hash = data => createHash('sha256').update(data).digest('hex')
const payload = Buffer.from('0123456789abcdef'.repeat(32768))
async function fixture(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-download-'))
  const files = { scope: createFileScope([directory]) }
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
  return { directory, files, url: `http://127.0.0.1:${server.address().port}/audio` }
}
async function seeded(options, data = payload, etag = '"fixture"') {
  const partialPath = path.join(options.directory, '.part'), checkpointPath = path.join(options.directory, '.json')
  const offset = 4096
  await fs.writeFile(partialPath, data.subarray(0, offset))
  const stats = await fs.stat(partialPath, { bigint: true })
  await fs.writeFile(checkpointPath, JSON.stringify({ version: 1, identity: 'song', url: options.url, resourceURL: options.url, fileIdentity: { dev: stats.dev.toString(), ino: stats.ino.toString() }, validator: etag, offset, total: data.length }))
  return { ...options, partialPath, checkpointPath, identity: 'song' }
}
test('download backend exports the original eight methods through an allowlisted service', async () => {
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ files: {}, directory: '' })
  assert.equal(await service.call('checkList', [[{ id: 'x', metadata: { quality: '128k', ext: 'mp3' } }], { id: 'x' }, '320k', 'mp3']), true)
  await assert.rejects(service.call('constructor', []), /Unknown/)
  await service.dispose()
})
for (const mode of ['range', 'ignore', 'changed', 'weak', 'chunked', 'redirect']) test(`download ${mode} verifies final SHA256`, async t => {
  let observed
  const options = await fixture(t, (req, res) => {
    observed = req.headers
    if (mode === 'redirect' && req.url === '/audio') { res.writeHead(307, { location: '/target' }); return res.end() }
    const start = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
    if (mode === 'chunked') { res.writeHead(200); res.write(payload.subarray(0, 123)); return res.end(payload.subarray(123)) }
    const range = ['range', 'changed', 'weak'].includes(mode) && start > 0
    res.writeHead(range ? 206 : 200, { etag: mode === 'changed' ? '"new"' : mode === 'weak' ? 'W/"weak"' : '"fixture"', 'content-length': range ? payload.length - start : payload.length, ...(range ? { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {}) })
    res.end(range ? payload.subarray(start) : payload)
  })
  const input = await seeded(options, payload, mode === 'weak' ? 'W/"weak"' : '"fixture"')
  const { transfer } = require('../../src-ztools/preload/runtime/download/transfer.cjs')
  if (mode === 'changed') { await assert.rejects(transfer(input), { code: 'ENTITY_CHANGED' }); await transfer(input) } else await transfer(input)
  assert.equal(hash(await fs.readFile(input.partialPath)), hash(payload))
  if (mode === 'range') { assert.equal(observed.range, 'bytes=4096-'); assert.equal(observed['if-range'], '"fixture"') }
  if (mode === 'weak') assert.equal(observed.range, undefined)
})
for (const mode of ['offset', 'total', 'truncated', 'empty', 'expired', 'chunked-break']) test(`download rejects ${mode} without publishing`, async t => {
  const options = await fixture(t, (req, res) => {
    if (mode === 'expired') { res.writeHead(403); return res.end() }
    if (mode === 'empty') { res.writeHead(200, { 'content-length': 0 }); return res.end() }
    if (mode === 'chunked-break') { res.writeHead(200); res.write(payload.subarray(0, 8192)); return setTimeout(() => res.destroy(), 10) }
    const start = 4096
    if (mode === 'truncated') { res.writeHead(200, { 'content-length': payload.length }); res.write(payload.subarray(0, 8192)); return setTimeout(() => res.destroy(), 10) }
    res.writeHead(206, { etag: '"fixture"', 'content-length': payload.length - start, 'content-range': `bytes ${mode === 'offset' ? start + 1 : start}-${payload.length - 1}/${mode === 'total' ? payload.length + 1 : payload.length}` }); res.end(payload.subarray(start))
  })
  const input = await seeded(options)
  const { transfer } = require('../../src-ztools/preload/runtime/download/transfer.cjs')
  await assert.rejects(transfer(input))
})
const task = (id, url, name = `${id}.mp3`) => ({ id, metadata: { url, fileName: name, ext: 'mp3', quality: '128k', musicInfo: { id } } })
async function until(predicate) { const end = Date.now() + 5000; while (!await predicate()) { if (Date.now() > end) throw new Error('wait timeout'); await new Promise(resolve => setTimeout(resolve, 10)) } }
test('pause survives a new service, cancel isolates owned files, and completion publishes verified bytes once', async t => {
  const ranges = []
  const options = await fixture(t, (req, res) => {
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0); ranges.push(offset)
    res.writeHead(offset ? 206 : 200, { etag: '"fixture"', 'content-length': payload.length - offset, ...(offset ? { 'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}) })
    let pos = offset
    const timer = setInterval(() => { res.write(payload.subarray(pos, pos += 8192)); if (pos >= payload.length) { clearInterval(timer); res.end() } }, 2)
    res.on('close', () => clearInterval(timer))
  })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  let service = createDownloadService(options)
  const actions = []; const item = task('resume', options.url)
  await service.call('startTask', [item, options.directory, true, action => actions.push(action)])
  await until(() => actions.some(action => action.action === 'progress' && action.data.downloaded > 16000))
  await until(async () => { const names = await fs.readdir(options.directory); const part = names.find(name => name.endsWith('.part')); return part && (await fs.stat(path.join(options.directory, part))).size > 8192 })
  await service.call('pauseTask', [item.id]); await service.dispose()
  assert.equal(actions.some(action => action.action === 'complete'), false)
  const names = await fs.readdir(options.directory)
  assert.ok(names.some(name => name.endsWith('.part'))); assert.ok(names.some(name => name.endsWith('.json')))
  service = createDownloadService(options); t.after(() => service.dispose())
  await service.call('startTask', [item, options.directory, true, action => actions.push(action)])
  await until(() => actions.some(action => action.action === 'complete'))
  assert.equal(hash(await fs.readFile(path.join(options.directory, 'resume.mp3'))), hash(payload))
  assert.ok(ranges[1] > 0)
  await service.call('removeTask', [item.id])
  assert.equal(hash(await fs.readFile(path.join(options.directory, 'resume.mp3'))), hash(payload))
})
test('expired URL refresh is bounded and rejects stale updates', async t => {
  let hits = 0
  const options = await fixture(t, (req, res) => { hits++; res.writeHead(403); res.end() })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('expired', options.url), options.directory, true, action => { events.push(action); if (action.action === 'refreshUrl') void service.call('updateUrl', ['expired', options.url]) }])
  await until(() => events.some(action => action.action === 'error'))
  assert.equal(hits, 3); assert.equal(events.filter(action => action.action === 'refreshUrl').length, 2)
  assert.equal(events.some(action => action.action === 'complete'), false)
  await assert.rejects(service.call('updateUrl', ['expired', options.url]), /失效|stale/)
})
test('concurrency, existing files, malicious filenames and cancel cannot corrupt other tasks', async t => {
  let active = 0, maximum = 0
  const options = await fixture(t, (_req, res) => { maximum = Math.max(maximum, ++active); res.on('close', () => active--); res.writeHead(200, { etag: '"fixture"', 'content-length': payload.length }); res.write(payload.subarray(0, 8192)); setTimeout(() => res.end(payload.subarray(8192)), 100) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, maxConcurrent: 1 }); t.after(() => service.dispose())
  await fs.writeFile(path.join(options.directory, 'user.mp3'), 'keep')
  await assert.rejects(service.call('startTask', [task('bad', options.url, '../escape.mp3'), options.directory, true, () => {}]), /文件名/)
  const skipped = []
  await service.call('startTask', [task('existing', options.url, 'user.mp3'), options.directory, true, action => skipped.push(action)])
  await until(() => skipped.some(action => action.action === 'error'))
  const events = []
  await service.call('startTask', [task('one', options.url), options.directory, true, action => events.push(['one', action.action])])
  await service.call('startTask', [task('two', options.url), options.directory, true, action => events.push(['two', action.action])])
  await until(() => events.some(([id, event]) => id === 'one' && event === 'progress'))
  await service.call('removeTask', ['one'])
  await until(() => events.some(([id, event]) => id === 'two' && event === 'complete'))
  assert.equal(maximum, 1); assert.equal(events.some(([id, event]) => id === 'one' && event === 'complete'), false)
  assert.equal(await fs.readFile(path.join(options.directory, 'user.mp3'), 'utf8'), 'keep')
})
test('reserved temporary-path collision cannot overwrite or delete a user file', async t => {
  const options = await fixture(t, (_req, res) => { res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const suffix = createHash('sha256').update('collision').digest('hex').slice(0, 24)
  const userFile = path.join(options.directory, `.lx-download-${suffix}.part`)
  await fs.writeFile(userFile, 'user owned bytes')
  await assert.rejects(service.call('startTask', [task('collision', options.url), options.directory, true, () => {}]), /冲突|ownership/)
  await service.call('removeTask', ['collision'])
  assert.equal(await fs.readFile(userFile, 'utf8'), 'user owned bytes')
})
test('task construction retains original quality downgrade, naming and list identity', async t => {
  const options = await fixture(t, (_req, res) => res.end())
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const [item] = await service.call('createDownloadTasks', [[{ id: 'song', name: '歌名/一', singer: '歌手', source: 'test', meta: { _qualitys: { '128k': {} } } }], 'flac', '歌名 - 歌手', { test: ['flac', '128k'] }, 'list-a'])
  assert.equal(item.id, 'song_128k_mp3'); assert.equal(item.metadata.fileName, '歌名一 - 歌手.mp3'); assert.equal(item.metadata.listId, 'list-a'); assert.equal(item.isComplate, false)
})
test('restore reconciles interrupted persisted tasks without starting network and keeps listId', async t => {
  let hits = 0
  const options = await fixture(t, (_req, res) => { hits++; res.end(payload) })
  const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
  const database = openDatabase(':memory:'); t.after(() => database.close())
  database.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const info = task('restored', options.url); info.metadata.listId = 'group-1'
  database.prepare('INSERT INTO plugin_kv VALUES (?,?,?)').run('downloads', 'tasks', JSON.stringify([{ info, status: 'run', directory: options.directory }]))
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const updates = []
  const service = createDownloadService({ ...options, database, onUpdate: (info, status) => updates.push([info.id, status]) })
  const [record] = await service.restore()
  assert.equal(record.status, 'pause'); assert.equal(record.metadata.listId, 'group-1'); assert.equal(hits, 0)
  assert.deepEqual(updates, [['restored', 'pause']])
  await service.dispose()
  await assert.rejects(service.call('writeMeta', [{ filePath: path.join(options.directory, 'late.mp3') }]), /关闭/)
})
test('source session changes reject a stale refresh and never complete', async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(403); res.end() })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  let sourceGeneration = 1
  const service = createDownloadService({ ...options, getSourceGeneration: () => sourceGeneration }); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('source-change', options.url), options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'refreshUrl'))
  sourceGeneration = 2
  await assert.rejects(service.call('updateUrl', ['source-change', options.url]), /失效/)
  await service.call('pauseTask', ['source-change'])
  assert.equal(events.some(action => action.action === 'complete'), false)
})
test('expired URL resolves a current valid address and publishes its SHA256', async t => {
  const options = await fixture(t, (req, res) => { if (req.url === '/audio') { res.writeHead(410); res.end() } else { res.writeHead(200, { 'content-length': payload.length }); res.end(payload) } })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('refreshed', options.url), options.directory, true, action => { events.push(action); if (action.action === 'refreshUrl') void service.call('updateUrl', ['refreshed', options.url.replace('/audio', '/valid')]) }])
  await until(() => events.some(action => action.action === 'complete'))
  assert.equal(events.filter(action => action.action === 'complete').length, 1)
  assert.equal(hash(await fs.readFile(path.join(options.directory, 'refreshed.mp3'))), hash(payload))
})
test('restore rejects revoked directories and does not silently treat them as resumable', async t => {
  const options = await fixture(t, (_req, res) => res.end())
  const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
  const database = openDatabase(':memory:'); t.after(() => database.close())
  database.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const info = task('revoked', options.url)
  database.prepare('INSERT INTO plugin_kv VALUES (?,?,?)').run('downloads', 'tasks', JSON.stringify([{ info, status: 'run', directory: path.dirname(options.directory) }]))
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, database }); t.after(() => service.dispose())
  const [record] = await service.restore()
  assert.equal(record.status, 'error'); assert.match(record.statusText, /授权/)
})
test('direct preload bridge accepts reactive-style task proxies without structuredClone failure', async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const info = new Proxy(task('proxy', options.url), {})
  const events = []
  await service.call('startTask', [info, options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'complete'))
  assert.equal(hash(await fs.readFile(path.join(options.directory, 'proxy.mp3'))), hash(payload))
})
test('redirect resource change cannot splice bytes even when two resources reuse the same ETag', async t => {
  const replacement = Buffer.from('fedcba9876543210'.repeat(32768))
  const options = await fixture(t, (req, res) => {
    if (req.url === '/audio') { res.writeHead(302, { location: '/different-resource' }); return res.end() }
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
    res.writeHead(offset ? 206 : 200, { etag: '"fixture"', 'content-length': replacement.length - offset, ...(offset ? { 'content-range': `bytes ${offset}-${replacement.length - 1}/${replacement.length}` } : {}) }); res.end(replacement.subarray(offset))
  })
  const input = await seeded(options)
  const { transfer } = require('../../src-ztools/preload/runtime/download/transfer.cjs')
  await assert.rejects(transfer(input), { code: 'ENTITY_CHANGED' })
  await transfer(input)
  assert.equal(hash(await fs.readFile(input.partialPath)), hash(replacement))
})
test('repeated interrupted bodies have a finite retry budget and never produce complete', async t => {
  let attempts = 0
  const options = await fixture(t, (_req, res) => { attempts++; res.writeHead(200, { 'content-length': payload.length }); res.write(payload.subarray(0, 8192)); setTimeout(() => res.destroy(), 5) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, retryDelay: 1 }); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('broken', options.url), options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'error'))
  assert.equal(attempts, 3); assert.equal(events.some(action => action.action === 'complete'), false)
  await assert.rejects(fs.stat(path.join(options.directory, 'broken.mp3')), { code: 'ENOENT' })
})
test('raw publication survives service restart and retries finalization without redownloading', async t => {
  let requests = 0
  const options = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
  const database = openDatabase(':memory:')
  database.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const info = task('finalize-recovery', options.url)
  let service = createDownloadService({ ...options, database })
  let complete = 0
  await service.call('startTask', [info, options.directory, true, action => { if (action.action === 'complete') complete++ }])
  await until(() => complete === 1)
  await service.dispose()
  service = createDownloadService({ ...options, database }); t.after(async () => { await service.dispose(); database.close() })
  const [restored] = await service.restore(); assert.equal(restored.status, 'pause')
  await service.call('startTask', [info, options.directory, true, action => { if (action.action === 'complete') complete++ }])
  await until(() => complete === 2)
  assert.equal(requests, 1)
  await service.call('finalizeTask', [info.id, '歌词写入失败'])
  await service.call('startTask', [info, options.directory, true, action => { if (action.action === 'complete') complete++ }])
  await until(() => complete === 3)
  await service.call('finalizeTask', [info.id])
  const [finalized] = await service.restore(); assert.equal(finalized.status, 'completed')
  assert.equal(requests, 1)
})
test('foreign changes to a raw published target are rejected without overwriting them', async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const info = task('foreign', options.url); let completed = false
  await service.call('startTask', [info, options.directory, true, action => { completed ||= action.action === 'complete' }])
  await until(() => completed)
  const target = path.join(options.directory, 'foreign.mp3')
  await fs.writeFile(target, 'user changed audio')
  await assert.rejects(service.call('finalizeTask', [info.id]), /修改|归属/)
  assert.equal(await fs.readFile(target, 'utf8'), 'user changed audio')
})
test('same-target queued work waits until finalization acknowledgment', async t => {
  let requests = 0
  const options = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('first', options.url, 'shared.mp3'), options.directory, false, action => events.push(['first', action.action])])
  await service.call('startTask', [task('second', options.url, 'shared.mp3'), options.directory, false, action => events.push(['second', action.action])])
  await until(() => events.some(([id, action]) => id === 'first' && action === 'complete'))
  assert.equal(requests, 1); assert.equal(events.some(([id]) => id === 'second'), false)
  await service.call('finalizeTask', ['first'])
  await until(() => events.some(([id, action]) => id === 'second' && action === 'complete'))
  assert.equal(requests, 2)
})
test('switching sources does not interrupt already valid HTTP transfer', async t => {
  let generation = 1
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-length': payload.length }); res.write(payload.subarray(0, 8192)); generation = 2; setTimeout(() => res.end(payload.subarray(8192)), 20) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, getSourceGeneration: () => generation }); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('valid-after-switch', options.url), options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'complete'))
  assert.equal(events.some(action => action.action === 'error'), false)
  await service.call('finalizeTask', ['valid-after-switch'])
})
test('restored raw publication retains its target lock until its owner acknowledges finalization', async t => {
  let requests = 0
  const options = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
  const database = openDatabase(':memory:')
  database.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  let service = createDownloadService({ ...options, database })
  const owner = task('owner', options.url, 'locked.mp3'); let ownerComplete = 0
  await service.call('startTask', [owner, options.directory, false, action => { if (action.action === 'complete') ownerComplete++ }])
  await until(() => ownerComplete === 1); await service.dispose()
  service = createDownloadService({ ...options, database }); t.after(async () => { await service.dispose(); database.close() })
  await service.restore()
  const blocked = []
  await service.call('startTask', [task('blocked', options.url, 'locked.mp3'), options.directory, false, action => blocked.push(action)])
  await service.call('startTask', [owner, options.directory, false, action => { if (action.action === 'complete') ownerComplete++ }])
  await until(() => ownerComplete === 2)
  assert.equal(requests, 1); assert.equal(blocked.length, 0)
  await service.call('finalizeTask', ['owner'])
  await until(() => blocked.some(action => action.action === 'complete'))
  assert.equal(requests, 2)
})
test('a failed no-clobber publication does not claim a racing user target even when bytes match', async t => {
  let directory
  const options = await fixture(t, async (_req, res) => { await fs.writeFile(path.join(directory, 'racing.mp3'), payload); res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  directory = options.directory
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = []
  await service.call('startTask', [task('racing', options.url), directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'error'))
  await assert.rejects(service.call('finalizeTask', ['racing']), /阶段/)
  assert.equal(events.some(action => action.action === 'complete'), false)
  await service.call('removeTask', ['racing'])
  assert.equal(hash(await fs.readFile(path.join(directory, 'racing.mp3'))), hash(payload))
})
test('cleaning up a finalized task cannot release a different task finalization lock', async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = []
  for (const id of ['first-owner', 'second-owner']) {
    await service.call('startTask', [task(id, options.url, 'same.mp3'), options.directory, false, action => events.push([id, action.action])])
    await until(() => events.some(([owner, action]) => owner === id && action === 'complete'))
    if (id === 'first-owner') await service.call('finalizeTask', [id])
  }
  await service.call('startTask', [task('third-owner', options.url, 'same.mp3'), options.directory, false, action => events.push(['third-owner', action.action])])
  await service.call('removeTask', ['first-owner'])
  assert.equal(events.some(([owner]) => owner === 'third-owner'), false)
  await service.call('finalizeTask', ['second-owner'])
  await until(() => events.some(([owner, action]) => owner === 'third-owner' && action === 'complete'))
})
test('concurrency getter follows the live setting at each pump', async t => {
  let hits = 0, limit = 1
  const options = await fixture(t, (_req, res) => { hits++; res.writeHead(200, { 'content-length': payload.length }); res.write(payload.subarray(0, 8192)) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, maxConcurrent: () => limit }); t.after(() => service.dispose())
  let starts = 0
  const callback = action => { if (action.action === 'start') starts++ }
  await service.call('startTask', [task('limit-a', options.url), options.directory, false, callback])
  await service.call('startTask', [task('limit-b', options.url), options.directory, false, callback])
  assert.equal(starts, 1)
  await until(() => hits > 0)
  assert.equal(hits, 1)
  limit = 2
  await service.call('startTask', [task('limit-c', options.url), options.directory, false, callback])
  assert.equal(starts, 2)
  await until(() => hits === 2)
  await service.dispose()
})
test('UI invocation does not resolve preload download modules after the realm boundary', async t => {
  const options = await fixture(t, (_req, res) => res.end())
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const Module = require('node:module')
  const originalRequire = Module.prototype.require
  const service = createDownloadService(options)
  Module.prototype.require = function(specifier) {
    if (this.filename.includes(`${path.sep}runtime${path.sep}download${path.sep}`) && !this.filename.endsWith('metadata-worker.cjs')) throw new Error(`late preload require: ${specifier}`)
    return originalRequire.call(this, specifier)
  }
  try {
    const list = await service.call('createDownloadTasks', [[{ id: 'realm', name: '跨域', singer: '歌手', source: 'test', meta: { _qualitys: { '128k': {} } } }], '128k', '歌名', { test: ['128k'] }])
    assert.equal(list[0].id, 'realm_128k_mp3')
    await service.call('saveLrc', [{ lyric: '[00:01.000]中文' }, { filePath: path.join(options.directory, 'realm.lrc'), format: 'utf8' }])
    await service.dispose()
  } finally { Module.prototype.require = originalRequire }
})
test('publishing intent cannot claim a different inode user target with identical bytes', async t => {
  const options = await fixture(t, (_req, res) => res.end(payload))
  const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
  const database = openDatabase(':memory:')
  database.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const info = task('intent-unpublished', options.url)
  const suffix = createHash('sha256').update(info.id).digest('hex').slice(0, 24)
  const partialPath = path.join(options.directory, `.lx-download-${suffix}.part`), checkpointPath = partialPath + '.json'
  const target = path.join(options.directory, info.metadata.fileName)
  await fs.writeFile(partialPath, payload); await fs.writeFile(target, payload)
  const stat = await fs.stat(partialPath, { bigint: true })
  const fileIdentity = { dev: stat.dev.toString(), ino: stat.ino.toString() }
  const identity = JSON.stringify([info.id, '128k', 'mp3', undefined, undefined])
  await fs.writeFile(checkpointPath, JSON.stringify({ version: 1, identity, url: options.url, resourceURL: options.url, fileIdentity, offset: payload.length, total: payload.length, validator: '"fixture"' }))
  database.prepare('INSERT INTO plugin_kv VALUES (?,?,?)').run('downloads', 'tasks', JSON.stringify([{ info, status: 'run', phase: 'publishing', target, directory: options.directory, partialPath, checkpointPath, fingerprint: { size: payload.length, sha256: hash(payload), fileIdentity } }]))
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, database }); t.after(async () => { await service.dispose(); database.close() })
  const [restored] = await service.restore(); assert.equal(restored.status, 'error')
  const events = []
  await service.call('startTask', [info, options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'error'))
  assert.equal(events.some(action => action.action === 'complete'), false)
  await assert.rejects(service.call('finalizeTask', [info.id]), /阶段|归属|修改/)
  assert.equal(hash(await fs.readFile(target)), hash(payload))
  assert.equal(hash(await fs.readFile(partialPath)), hash(payload))
})
test('an error record plus a rejected retry cannot delete later user-created temporary names', async t => {
  const options = await fixture(t, (_req, res) => res.end(payload))
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const info = task('stale-record', options.url)
  await fs.writeFile(path.join(options.directory, info.metadata.fileName), 'existing user audio')
  const events = []
  await service.call('startTask', [info, options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'error'))
  const suffix = createHash('sha256').update(info.id).digest('hex').slice(0, 24)
  const partialPath = path.join(options.directory, `.lx-download-${suffix}.part`)
  await fs.writeFile(partialPath, 'later user part'); await fs.writeFile(partialPath + '.json', 'later user sidecar')
  await assert.rejects(service.call('startTask', [info, options.directory, true, () => {}]), /冲突/)
  await service.call('removeTask', [info.id])
  assert.equal(await fs.readFile(partialPath, 'utf8'), 'later user part')
  assert.equal(await fs.readFile(partialPath + '.json', 'utf8'), 'later user sidecar')
  assert.equal(await fs.readFile(path.join(options.directory, info.metadata.fileName), 'utf8'), 'existing user audio')
})
test('cancellation deletes its actual owned partial and sidecar after awaiting stream close', async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { etag: '"fixture"', 'content-length': payload.length }); res.write(payload.subarray(0, 8192)) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = [], info = task('owned-cancel', options.url)
  await service.call('startTask', [info, options.directory, false, action => events.push(action)])
  await until(() => events.some(action => action.action === 'progress'))
  await service.call('removeTask', [info.id])
  assert.deepEqual(await fs.readdir(options.directory), [])
  assert.equal(events.some(action => action.action === 'complete'), false)
})
test('cancellation preserves user replacements of both previously owned temporary files', async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { etag: '"fixture"', 'content-length': payload.length }); res.write(payload.subarray(0, 8192)) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const events = [], info = task('replaced-cancel', options.url)
  await service.call('startTask', [info, options.directory, false, action => events.push(action)])
  await until(() => events.some(action => action.action === 'progress'))
  await service.call('pauseTask', [info.id])
  const part = (await fs.readdir(options.directory)).find(name => name.endsWith('.part'))
  const partialPath = path.join(options.directory, part), checkpointPath = partialPath + '.json'
  await fs.writeFile(path.join(options.directory, 'user-part'), 'replacement user audio')
  await fs.rename(path.join(options.directory, 'user-part'), partialPath)
  await fs.writeFile(path.join(options.directory, 'user-checkpoint'), 'replacement user checkpoint')
  await fs.rename(path.join(options.directory, 'user-checkpoint'), checkpointPath)
  await service.call('removeTask', [info.id])
  assert.equal(await fs.readFile(partialPath, 'utf8'), 'replacement user audio')
  assert.equal(await fs.readFile(checkpointPath, 'utf8'), 'replacement user checkpoint')
})
test('publishing intent recovers only its real same-inode hardlinked target and cleans owned leftovers', async t => {
  const options = await fixture(t, (_req, res) => res.end(payload))
  const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
  const database = openDatabase(':memory:')
  database.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const info = task('intent-linked', options.url)
  const suffix = createHash('sha256').update(info.id).digest('hex').slice(0, 24)
  const partialPath = path.join(options.directory, `.lx-download-${suffix}.part`), checkpointPath = partialPath + '.json'
  const target = path.join(options.directory, info.metadata.fileName)
  await fs.writeFile(partialPath, payload); await fs.link(partialPath, target)
  const stat = await fs.stat(partialPath, { bigint: true }), fileIdentity = { dev: stat.dev.toString(), ino: stat.ino.toString() }
  const identity = JSON.stringify([info.id, '128k', 'mp3', undefined, undefined])
  await fs.writeFile(checkpointPath, JSON.stringify({ version: 1, identity, url: options.url, resourceURL: options.url, fileIdentity, offset: payload.length, total: payload.length, validator: '"fixture"' }))
  database.prepare('INSERT INTO plugin_kv VALUES (?,?,?)').run('downloads', 'tasks', JSON.stringify([{ info, status: 'run', phase: 'publishing', target, directory: options.directory, partialPath, checkpointPath, fingerprint: { size: payload.length, sha256: hash(payload), fileIdentity } }]))
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ ...options, database }); t.after(async () => { await service.dispose(); database.close() })
  const [restored] = await service.restore(); assert.equal(restored.status, 'pause')
  const events = []
  await service.call('startTask', [info, options.directory, true, action => events.push(action)])
  await until(() => events.some(action => action.action === 'complete'))
  await service.call('finalizeTask', [info.id])
  assert.deepEqual(await fs.readdir(options.directory), [info.metadata.fileName])
  await service.call('removeTask', [info.id])
  assert.deepEqual(await fs.readdir(options.directory), [info.metadata.fileName])
  assert.equal(hash(await fs.readFile(target)), hash(payload))
})
for (const stop of ['pause', 'restart']) test(`a finalization ACK waiting for file verification cannot revive a task after ${stop}`, async t => {
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const info = task('ack-verification', options.url), events = []
  await service.call('startTask', [info, options.directory, false, action => events.push(action)])
  await until(() => events.some(action => action.action === 'complete'))
  const nativeFS = require('node:fs'), { Readable } = require('node:stream')
  const originalRead = nativeFS.createReadStream
  let release, entered, firstRead = true
  const gate = new Promise(resolve => { release = resolve }), reading = new Promise(resolve => { entered = resolve })
  const target = path.join(options.directory, info.metadata.fileName)
  nativeFS.createReadStream = function(file, ...args) {
    if (file === target && firstRead) { firstRead = false; entered(); return Readable.from((async function* () { await gate; yield payload })()) }
    return originalRead.call(this, file, ...args)
  }
  try {
    const ack = service.call('finalizeTask', [info.id])
    await reading
    await service.call('pauseTask', [info.id])
    if (stop === 'restart') {
      const events = []
      await service.call('startTask', [info, options.directory, false, action => events.push(action)])
      await until(() => events.some(action => action.action === 'complete'))
    }
    release()
    await assert.rejects(ack, /暂停|失效|替换/)
  } finally { nativeFS.createReadStream = originalRead; release() }
  if (stop === 'pause') {
    const [restored] = await service.restore()
    assert.equal(restored.status, 'pause'); assert.equal(restored.isComplate, false)
    const restarted = []
    await service.call('startTask', [info, options.directory, false, action => restarted.push(action)])
    await until(() => restarted.some(action => action.action === 'complete'))
  }
  await service.call('finalizeTask', [info.id])
})
test('explicit pause after backend ACK reopens pending finalization so UI SQL cancellation can resume without HTTP', async t => {
  let hits = 0
  const options = await fixture(t, (_req, res) => { hits++; res.writeHead(200, { 'content-length': payload.length }); res.end(payload) })
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService(options); t.after(() => service.dispose())
  const info = task('ack-before-ui-sql', options.url)
  async function start() {
    const events = []
    await service.call('startTask', [info, options.directory, true, action => events.push(action)])
    await until(() => events.some(action => action.action === 'complete'))
  }
  await start(); await service.call('finalizeTask', [info.id])
  await service.call('pauseTask', [info.id])
  const [record] = await service.restore(); assert.equal(record.status, 'pause'); assert.equal(record.isComplate, false)
  await start(); assert.equal(hits, 1)
  await service.call('finalizeTask', [info.id])
  await service.call('finalizeTask', [info.id, 'UI SQL commit failed'])
  await start(); assert.equal(hits, 1)
  await service.call('finalizeTask', [info.id])
})
