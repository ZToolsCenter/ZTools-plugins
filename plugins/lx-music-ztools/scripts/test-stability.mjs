import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import audioFixture from '../tests/ztools/fixtures/audio-server.cjs'
const duration = Number(process.env.LX_STABILITY_MS || 1800000)
const cycles = Number(process.env.LX_STABILITY_CYCLES || 50)
if (!Number.isSafeInteger(duration) || duration < 1000 || !Number.isInteger(cycles) || cycles < 1) throw new Error('Invalid stability parameters')
const evidence = process.env.LX_STABILITY_OUTPUT || 'artifacts/stability'
mkdirSync(evidence, { recursive: true })
const directory = mkdtempSync(join(tmpdir(), 'lx-stability-'))
const original = join(directory, 'long.mp3')
const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(Math.ceil(duration / 1000) + 8), '-b:a', '32k', original], { windowsHide: true })
assert.equal(generated.status, 0, generated.stderr?.toString())
const bytes = readFileSync(original), samples = []
const tone = await audioFixture.startAudioServer('')
const server = createServer((req, res) => {
  if (req.url === '/cover.png') { res.setHeader('content-type', 'image/png'); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64')) }
  const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
  res.writeHead(offset ? 206 : 200, { etag: '"long-fixture"', 'content-type': 'audio/mpeg', 'content-length': bytes.length - offset,
    ...(offset ? { 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) })
  const start = Date.now(), transferDuration = duration + 5000
  let cursor = offset
  const timer = setInterval(() => {
    const end = Math.min(bytes.length, offset + Math.floor((bytes.length - offset) * (Date.now() - start) / transferDuration))
    if (end > cursor) { res.write(bytes.subarray(cursor, end)); cursor = end }
    if (cursor === bytes.length) { clearInterval(timer); res.end() }
  }, 250)
  res.on('close', () => clearInterval(timer))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let host
const report = { status: 'FAIL', durationRequestedMs: duration, cyclesRequested: cycles, evidence: 'Actual isolated ZTools, controlled repeating WAV playback and throttled complete MP3 download' }
async function pcm(file) {
  const process = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-'], { windowsHide: true })
  const sha = createHash('sha256'); let error = ''
  process.stdout.on('data', bytes => sha.update(bytes)); process.stderr.on('data', data => { error += data })
  const code = await new Promise((resolve, reject) => { process.on('error', reject); process.on('close', resolve) })
  assert.equal(code, 0, error); return sha.digest('hex')
}
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  await expect.poll(() => host.evaluate('typeof lxDownload'), { timeout: 20000 }).toBe('object')
  const script = `/**\n * @name Controlled stability fixture\n */
    lx.on(lx.EVENT_NAMES.request,({info})=>Promise.resolve(info.musicInfo.songmid==='stability-download'?${JSON.stringify(base + '/long.mp3')}:${JSON.stringify(tone.base + '/audio.wav')}));
    lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`
  const { apiInfo } = await invoke('winMain_import_user_api', script)
  const downloadPath = await host.evaluate('ztools.getPath("pluginData")')
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.apiSource': apiInfo.id, 'player.volume': 0.01,
    'player.togglePlayMethod': 'listLoop', 'download.savePath': downloadPath, 'download.isEmbedPic': false, 'download.isEmbedLyric': false, 'download.isDownloadLrc': false, 'download.isSavePathGroupByListName': false })
  await invoke('winMain_set_user_api', apiInfo.id)
  const track = id => ({ id: `kw_${id}`, source: 'kw', name: id, singer: '合成测试', interval: '00:12', meta: { songId: id, picUrl: base + '/cover.png', qualitys: [{ type: '128k' }], _qualitys: { '128k': {} }, albumName: '稳定性' } })
  await invoke('winMain_save_lyric_raw', { id: 'kw_stability-player', lyrics: { lyric: '[00:00.00]稳定性受控歌词', tlyric: '', lxlyric: '', rlyric: '' } })
  await invoke('player_list_music_add', { id: 'default', musicInfos: [track('stability-player')], addMusicLocationType: 'bottom' })
  await host.evaluate(`{ const Original=window.Audio; window.__stability={extraAudio:0,played:0,wraps:0,last:0};window.Audio=new Proxy(Original,{construct(target,args,newTarget){__stability.extraAudio++;return Reflect.construct(target,args,newTarget)}});
    lxPlayer.subscribe(state=>{const previous=__stability.last;if(state.progress>=previous)__stability.played+=state.progress-previous;else if(previous-state.progress>1)__stability.wraps++;__stability.last=state.progress}); undefined; }`)
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:0})`)
  // The original LX engine creates one muted next-track preloader on first play.
  // Warm that original auxiliary element before measuring lifecycle growth.
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 15000 }).toBeGreaterThan(3.5)
  await host.evaluate('__stability.extraAudio=0;__stability.played=0;undefined')
  const baseline = await host.evaluate('services.diagnose()')
  const identity = await host.evaluate('services.startLifecycleProbe()')
  await host.evaluate(`lxDownload.create([${JSON.stringify(track('stability-download'))}],'128k','default')`)
  const started = Date.now()
  for (let i = 0; i < cycles; i++) {
    await host.evaluate('ztools.outPlugin(false)')
    await host.page.locator('.search-input').fill('lxmusic')
    await host.page.locator('.app-item').filter({ hasText: /lxmusic|洛雪音乐|LX Music/i }).first().click()
    assert.equal((await host.evaluate('services.getLifecycleProbe()')).id, identity.id)
  }
  const detached = await host.page.evaluate(() => window.ztools.detachPlugin())
  assert.equal(detached.success, true)
  await host.evaluate('ztools.outPlugin(false)')
  while (Date.now() - started < duration) {
    const state = await host.evaluate('({player:lxPlayer.getState(),counters:{...__stability},services:services.diagnose(),probe:services.getLifecycleProbe()})')
    assert.equal(state.probe.id, identity.id)
    assert.equal(state.counters.extraAudio, 0)
    assert.notEqual(state.player.status, 'error')
    const metrics = await host.app.evaluate(({ app }) => app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu: cpu.percentCPUUsage, workingSetKB: memory.workingSetSize })))
    samples.push({ elapsedMs: Date.now() - started, state, metrics })
    writeFileSync(join(evidence, 'progress.json'), JSON.stringify({ duration, cycles, samples }, null, 2))
    console.log(`stability elapsed=${Math.round((Date.now() - started) / 1000)}s played=${Math.round(state.counters.played)}s listeners=${state.services.runtime.bridge.listeners}`)
    await new Promise(resolve => setTimeout(resolve, Math.min(15000, duration - (Date.now() - started))))
  }
  await expect.poll(async () => (await host.evaluate('lxDownload.getState()'))[0]?.status, { timeout: 30000 }).toBe('completed')
  const task = (await host.evaluate('lxDownload.getState()'))[0]
  report.originalPCM = await pcm(original); report.downloadedPCM = await pcm(task.metadata.filePath)
  assert.equal(report.originalPCM, report.downloadedPCM)
  const final = await host.evaluate('({counters:{...__stability},services:services.diagnose(),probe:services.getLifecycleProbe()})')
  assert.ok(final.counters.played >= duration / 1000 * 0.75, 'Background audio time must keep advancing')
  assert.equal(final.counters.extraAudio, 0)
  assert.equal(final.services.runtime.source.sessions, 1)
  assert.equal(final.services.runtime.source.pending, 0)
  assert.equal(final.services.runtime.bridge.listeners, baseline.runtime.bridge.listeners)
  report.status = 'PASS'; report.elapsedMs = Date.now() - started; report.cycles = cycles; report.detached = detached; report.baseline = baseline; report.final = final; report.samples = samples
  console.log('PASS sustained background playback/download, lifecycle identity/listeners/Audio constructor, decoded PCM')
} catch (error) { report.error = String(error.stack || error); report.logs = await host?.logs(); report.samples = samples; process.exitCode = 1 }
finally { writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2)); await host?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tone.close() }
