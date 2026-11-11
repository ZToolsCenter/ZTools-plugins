import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
mkdirSync('artifacts/download', { recursive: true })
const bytes = readFileSync('tests/ztools/fixtures/download/tone.mp3')
const template = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8')
const ranges = []
let base, host
const report = { evidence: 'Actual installed ZTools, original LX download actions, local synthetic MP3' }
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.url.startsWith('/resolve')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ url: base + '/audio.mp3' })) }
  if (req.url === '/audio.mp3') {
    const start = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
    ranges.push(start)
    res.writeHead(start ? 206 : 200, { etag: '"tone-v1"', 'content-length': bytes.length - start,
      ...(start ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}) })
    let offset = start
    const timer = setInterval(() => { const end = Math.min(offset + 256, bytes.length); res.write(bytes.subarray(offset, end)); offset = end; if (offset === bytes.length) { clearInterval(timer); res.end() } }, 150)
    res.on('close', () => clearInterval(timer))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
base = `http://127.0.0.1:${server.address().port}`
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
  await expect.poll(() => host.evaluate('typeof lxDownload'), { timeout: 20000 }).toBe('object')
  await host.evaluate(`{ const invoke = lxHost.invoke; lxHost.invoke = async (channel, params) => {
    try { return await invoke(channel, params) } catch (error) { console.error(String(error.stack || error)); throw error }
  }; undefined; }`)
  const directory = await host.evaluate('ztools.getPath("pluginData")')
  const source = await invoke('winMain_import_user_api', template.replaceAll('__BASE_URL__', base))
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false,
    'common.apiSource': source.apiInfo.id, 'download.savePath': directory, 'download.fileName': '歌名 - 歌手',
    'download.isEmbedPic': false, 'download.isEmbedLyric': true, 'download.isDownloadLrc': true,
    'download.isSavePathGroupByListName': false, 'download.isUseOtherSource': false })
  await invoke('winMain_set_user_api', source.apiInfo.id)
  await expect.poll(async () => (await invoke('winMain_get_user_api_status')).status).toBe(true)
  const track = { id: 'kw_download', source: 'kw', name: '下载验证', singer: '本地合成', interval: '00:01',
    meta: { musicId: 'download', qualitys: [{ type: '128k', size: '3KB' }], _qualitys: { '128k': {} }, albumName: '测试专辑' } }
  await invoke('winMain_save_lyric_raw', { id: track.id, lyrics: { lyric: '[00:00.00]本地歌词', tlyric: '', lxlyric: '', rlyric: '' } })
  await host.evaluate(`lxDownload.create([${JSON.stringify(track)}], '128k', 'default')`)
  await expect.poll(async () => (await host.evaluate('lxDownload.getState()'))[0]?.downloaded, { timeout: 15000 }).toBeGreaterThan(256)
  const id = (await host.evaluate('lxDownload.getState()'))[0].id
  await host.evaluate(`lxDownload.pause([${JSON.stringify(id)}])`)
  await expect.poll(async () => (await host.evaluate('lxDownload.getState()'))[0]?.status).toBe('pause')
  await host.evaluate(`lxDownload.start([${JSON.stringify(id)}])`)
  await host.evaluate('ztools.outPlugin(false)')
  await expect.poll(async () => (await host.evaluate('lxDownload.getState()'))[0]?.status, { timeout: 30000 }).toBe('completed')
  const task = (await host.evaluate('lxDownload.getState()'))[0]
  assert.equal(task.isComplate, true)
  const metadata = await invoke('metadata:parseFile', [task.metadata.filePath])
  assert.equal(metadata.common.title, track.name)
  assert.equal(metadata.common.album, track.meta.albumName)
  assert.ok(JSON.stringify(metadata.native).includes('本地歌词'))
  assert.ok(readFileSync(task.metadata.filePath.replace(/\.mp3$/, '.lrc'), 'utf8').includes('本地歌词'))
  assert.ok(ranges.some(offset => offset > 0), 'resume must send Range')
  const persisted = await invoke('winMain_download_list_get')
  assert.equal(persisted[0].status, 'completed')
  report.status = 'PASS'; report.ranges = ranges; report.task = task; report.metadata = metadata.common
  console.log('PASS original download actions: source URL, pause/Range resume, background, tags, lyrics, completed DB')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.tasks = await host?.evaluate('lxDownload.getState()').catch(() => null); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/download/report.json', JSON.stringify(report, null, 2)); await host?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
