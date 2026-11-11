import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

mkdirSync('artifacts/recovery', { recursive: true })
const bytes = readFileSync('tests/ztools/fixtures/download/tone.mp3')
const ranges = []; let base, host
const report = { evidence: 'Actual isolated ZTools public kill/re-enter; original 10000-song library and paused-download recovery, no automatic audio' }
const server = createServer((req, res) => {
  if (req.url.startsWith('/resolve')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ url: base + '/audio.mp3' })) }
  if (req.url !== '/audio.mp3') { res.writeHead(404); return res.end() }
  const start = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
  ranges.push(start)
  res.writeHead(start ? 206 : 200, { etag: '"kill-recovery-v1"', 'content-length': bytes.length - start, ...(start ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}) })
  let offset = start
  const timer = setInterval(() => { const end = Math.min(bytes.length, offset + 256); res.write(bytes.subarray(offset, end)); offset = end; if (offset === bytes.length) { clearInterval(timer); res.end() } }, 250)
  res.on('close', () => clearInterval(timer))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`
const sha = value => createHash('sha256').update(value).digest('hex')
const music = id => ({ id: `kw_${id}`, name: id, singer: '合成测试', source: 'kw', interval: '00:01', meta: { songId: id, albumName: '恢复', qualitys: [{ type: '128k' }], _qualitys: { '128k': {} } } })
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  await expect.poll(() => host.evaluate('typeof lxDownload'), { timeout: 20000 }).toBe('object')
  const directory = await host.evaluate('ztools.getPath("pluginData")')
  const lists = Array.from({ length: 100 }, (_, i) => ({ id: `userlist_large_${i}`, name: `大列表${i}`, source: null, sourceListId: null, locationUpdateTime: null, list: Array.from({ length: 100 }, (_, j) => music(`${i}_${j}`)) }))
  await invoke('player_list_data_overwire', { defaultList: [], loveList: [], userList: lists })
  const digestLibrary = async () => {
    const stored = await invoke('player_list_get')
    assert.equal(stored.length, 100)
    let count = 0; const hash = createHash('sha256')
    for (const list of stored) { const songs = await invoke('player_list_music_get', list.id); count += songs.length; hash.update(JSON.stringify({ id: list.id, name: list.name, songs })) }
    assert.equal(count, 10000); return hash.digest('hex')
  }
  report.before = await digestLibrary()
  const imported = await invoke('winMain_import_user_api', readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8').replaceAll('__BASE_URL__', base))
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.apiSource': imported.apiInfo.id, 'player.volume': 0.01, 'download.savePath': directory,
    'download.isEmbedPic': false, 'download.isEmbedLyric': false, 'download.isDownloadLrc': false, 'download.isSavePathGroupByListName': false })
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  await host.evaluate(`lxDownload.create([${JSON.stringify(music('recovery'))}],'128k','default')`)
  await expect.poll(async () => (await host.evaluate('lxDownload.getState()'))[0]?.downloaded, { timeout: 15000 }).toBeGreaterThan(256)
  const old = (await host.evaluate('lxDownload.getState()'))[0]
  const oldPid = await host.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getURL().includes('/dist/lx.html')).getOSProcessId())
  await host.evaluate('ztools.outPlugin(true)')
  await expect.poll(() => host.app.evaluate(({ webContents }) => webContents.getAllWebContents().some(wc => wc.getURL().includes('/dist/lx.html')))).toBe(false)
  await host.page.locator('.search-input').fill('lxmusic')
  await host.page.locator('.app-item').filter({ hasText: /lxmusic|洛雪音乐|LX Music/i }).first().click()
  await expect.poll(() => host.evaluate('typeof lxDownload').catch(() => ''), { timeout: 20000 }).toBe('object')
  assert.equal(await host.evaluate('ztools.getPath("pluginData")'), directory)
  assert.equal((await invoke('winMain_get_user_api_list')).length, 1)
  report.after = await digestLibrary(); assert.equal(report.after, report.before)
  assert.notEqual(await host.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getURL().includes('/dist/lx.html')).getOSProcessId()), oldPid)
  assert.notEqual((await host.evaluate('lxPlayer.getState()')).status, 'playing')
  const recovered = (await host.evaluate('lxDownload.getState()'))[0]
  assert.equal(recovered.id, old.id); assert.notEqual(recovered.status, 'completed')
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  await host.evaluate(`lxDownload.start([${JSON.stringify(old.id)}])`)
  await expect.poll(async () => (await host.evaluate('lxDownload.getState()'))[0]?.status, { timeout: 30000 }).toBe('completed')
  const final = (await host.evaluate('lxDownload.getState()'))[0]
  assert.ok(ranges.some(offset => offset > 0))
  const pcm = file => { const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-'], { windowsHide: true }); assert.equal(result.status, 0, result.stderr?.toString()); return sha(result.stdout) }
  assert.equal(pcm(final.metadata.filePath), pcm('tests/ztools/fixtures/download/tone.mp3'))
  await expect.poll(() => host.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getURL().includes('/native-jobs.html')).length)).toBe(0)
  report.status = 'PASS'; report.ranges = ranges; report.recoveredStatus = recovered.status; report.count = { lists: 100, songs: 10000 }; report.pcm = pcm(final.metadata.filePath)
  console.log('PASS public kill/restart: 100 lists/10000 songs exact order, source persistence, no auto-play, download Range recovery and PCM')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/recovery/report.json', JSON.stringify(report, null, 2)); await host?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
