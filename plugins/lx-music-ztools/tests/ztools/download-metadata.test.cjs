const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { createFileScope } = require('../../src-ztools/preload/runtime/files.cjs')
const preload = path.resolve(__dirname, '../../src-ztools/preload')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64')
const lyrics = { lyric: '[00:01.000]原词\n[00:02.000]下一句', tlyric: '[00:01.000]Translation', rlyric: '[00:01.000]yuan ci', lxlyric: '[00:01.000]<0,100>原词' }
async function setup(t, cover = png) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-download-meta-'))
  let audioRequests = 0
  const audio = await fs.readFile(path.join(__dirname, 'fixtures/download/tone.mp3'))
  const server = http.createServer((req, res) => { const body = req.url === '/audio.mp3' ? (audioRequests++, audio) : cover; res.writeHead(200, { 'content-length': body.length }); res.end(body) })
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) })
  return { root, files: { scope: createFileScope([root]) }, coverURL: `http://127.0.0.1:${server.address().port}/cover.png`, audioURL: `http://127.0.0.1:${server.address().port}/audio.mp3`, audioRequests: () => audioRequests }
}
function pcm(filePath) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', filePath, '-map', '0:a:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-'], { maxBuffer: 10 * 1024 * 1024, windowsHide: true })
  assert.equal(result.status, 0, result.stderr?.toString())
  return createHash('sha256').update(result.stdout).digest('hex')
}
for (const ext of ['mp3', 'flac']) test(`${ext}: await metadata preserves decoded PCM and exposes Chinese tags, lyrics, embedded cover`, async t => {
  const { root, files, coverURL } = await setup(t)
  const filePath = path.join(root, `audio.${ext}`)
  await fs.copyFile(path.join(__dirname, `fixtures/download/tone.${ext}`), filePath)
  await fs.writeFile(path.join(root, 'audio.png'), 'user existing cover')
  const beforePCM = pcm(filePath)
  const { writeMeta } = require('../../src-ztools/preload/runtime/download/metadata.cjs')
  await writeMeta(files, { filePath, title: '中文歌名', artist: '歌手甲;歌手乙', album: '测试专辑', APIC: coverURL, isEmbedLyricLx: true, isEmbedLyricT: true, isEmbedLyricR: true }, lyrics)
  const { parseFile } = await import(pathToFileURL(require.resolve('music-metadata', { paths: [preload] })).href)
  const meta = await parseFile(filePath)
  assert.equal(meta.common.title, '中文歌名'); assert.equal(meta.common.album, '测试专辑')
  assert.ok(JSON.stringify(meta.common.lyrics).includes('原词'))
  // music-metadata normalizes FLAC LRC into synchronized text, dropping LX extension labels.
  assert.ok(JSON.stringify(meta.native).includes('[awlrc:'))
  assert.equal(meta.common.picture[0].format, 'image/png'); assert.deepEqual(meta.common.picture[0].data, new Uint8Array(png))
  assert.equal(pcm(filePath), beforePCM)
  assert.equal(await fs.readFile(path.join(root, 'audio.png'), 'utf8'), 'user existing cover')
  assert.deepEqual((await fs.readdir(root)).sort(), [`audio.${ext}`, 'audio.png'].sort())
})
test('invalid cover fails metadata atomically and preserves original audio', async t => {
  const { root, files, coverURL } = await setup(t, Buffer.from('broken image'))
  const filePath = path.join(root, 'audio.flac')
  const original = await fs.readFile(path.join(__dirname, 'fixtures/download/tone.flac')); await fs.writeFile(filePath, original)
  const { writeMeta } = require('../../src-ztools/preload/runtime/download/metadata.cjs')
  await assert.rejects(writeMeta(files, { filePath, title: 'new', APIC: coverURL }, lyrics))
  assert.deepEqual(await fs.readFile(filePath), original)
  assert.deepEqual(await fs.readdir(root), ['audio.flac'])
})
test('saveLrc awaits atomic UTF8 BOM/GBK bytes and preserves matching multilingual time labels', async t => {
  const { root, files } = await setup(t)
  const { saveLrc } = require('../../src-ztools/preload/runtime/download/metadata.cjs')
  for (const format of ['utf8', 'gbk']) {
    const filePath = path.join(root, `${format}.lrc`)
    await saveLrc(files, lyrics, { filePath, format, downloadLxlrc: true, downloadTlrc: true, downloadRlrc: true })
    const bytes = await fs.readFile(filePath)
    const iconv = require(require.resolve('iconv-lite', { paths: [preload] }))
    assert.ok(iconv.decode(bytes, format).includes('原词')); assert.ok(iconv.decode(bytes, format).includes('Translation')); assert.ok(iconv.decode(bytes, format).includes('[awlrc:'))
    if (format === 'utf8') assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf')
    else assert.equal(bytes.subarray(0, 3).toString('hex'), '5b3030')
  }
  await assert.rejects(saveLrc(files, lyrics, { filePath: path.join(root, '..', 'outside.lrc') }), { code: 'PATH_NOT_GRANTED' })
})
test('finalization records the tagged version and can retry lyrics failure without network', async t => {
  const { root, files, coverURL, audioURL, audioRequests } = await setup(t)
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ files, directory: root }); t.after(() => service.dispose())
  const item = { id: 'metadata-stage', metadata: { url: audioURL, fileName: 'staged.mp3', ext: 'mp3', quality: '128k', musicInfo: { id: 'metadata-stage' } } }
  async function start() {
    let complete
    const result = new Promise((resolve, reject) => { complete = action => { if (action.action === 'complete') resolve(); else if (action.action === 'error') reject(new Error(action.data.message)) } })
    await service.call('startTask', [item, root, true, complete]); await result
  }
  await start()
  const filePath = path.join(root, 'staged.mp3')
  await service.call('writeMeta', [{ filePath, title: '最终化', artist: '歌手', album: '专辑', APIC: coverURL, isEmbedLyricLx: true }, lyrics])
  await service.call('finalizeTask', [item.id, '模拟歌词保存失败'])
  await start()
  await service.call('saveLrc', [lyrics, { filePath: path.join(root, 'staged.lrc'), format: 'utf8', downloadLxlrc: true }])
  await service.call('finalizeTask', [item.id])
  assert.equal(audioRequests(), 1)
  assert.ok((await fs.readFile(path.join(root, 'staged.lrc'), 'utf8')).includes('原词'))
})
for (const operation of ['pauseTask', 'removeTask']) test(`${operation} awaits the active metadata worker before releasing a same-target queued download`, async t => {
  const { root, files, coverURL, audioURL } = await setup(t)
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  const service = createDownloadService({ files, directory: root }); t.after(() => service.dispose())
  const order = []
  const original = { id: 'old-tag-task', metadata: { url: audioURL, fileName: 'locked.mp3', ext: 'mp3', quality: '128k', musicInfo: { id: 'old-tag-task' } } }
  let ready
  const downloaded = new Promise(resolve => { ready = resolve })
  await service.call('startTask', [original, root, false, action => { if (action.action === 'complete') ready() }]); await downloaded
  const filePath = path.join(root, 'locked.mp3')
  let settled = false
  const writing = service.call('writeMeta', [{ filePath, title: 'old-tag', artist: '歌手', album: '专辑', APIC: coverURL }, lyrics]).then(() => { settled = true; order.push('old-tag-finished') })
  // The private copy is created immediately before starting the real Node writer worker.
  const end = Date.now() + 5000
  while (!(await fs.readdir(root)).some(name => name.startsWith('.lx-meta-'))) { assert.ok(Date.now() < end); await new Promise(resolve => setTimeout(resolve, 1)) }
  assert.equal(settled, false)
  const stopping = service.call(operation, [original.id]).then(() => order.push('stopped'))
  const next = { ...original, id: 'new-tag-task' }
  let nextReady
  const nextDone = new Promise(resolve => { nextReady = resolve })
  await service.call('startTask', [next, root, false, action => { if (action.action === 'start') order.push('next-started'); if (action.action === 'complete') nextReady() }])
  await Promise.all([writing, stopping, nextDone])
  assert.ok(order.indexOf('old-tag-finished') < order.indexOf('next-started'))
  const sourceBytes = await fs.readFile(path.join(__dirname, 'fixtures/download/tone.mp3'))
  assert.deepEqual(await fs.readFile(filePath), sourceBytes)
})
test('service uses its injected metadata executor and preserves original audio when that executor fails', async t => {
  const { root, files } = await setup(t)
  const filePath = path.join(root, 'injected.mp3')
  const original = await fs.readFile(path.join(__dirname, 'fixtures/download/tone.mp3'))
  await fs.writeFile(filePath, original)
  const { createDownloadService } = require('../../src-ztools/preload/runtime/download/index.cjs')
  let calls = 0
  const service = createDownloadService({ files, directory: root, runWriter: async data => {
    calls++
    assert.equal(data.ext, '.mp3'); assert.equal(data.meta.title, '注入标签')
    assert.notEqual(data.filePath, filePath)
    assert.deepEqual(await fs.readFile(data.filePath), original)
    await fs.writeFile(data.filePath, 'executor partially modified its private copy')
    throw new Error('isolated browser executor failed')
  } }); t.after(() => service.dispose())
  await assert.rejects(service.call('writeMeta', [{ filePath, title: '注入标签', artist: '歌手', album: '专辑' }, lyrics]), /isolated browser executor failed/)
  assert.equal(calls, 1)
  assert.deepEqual(await fs.readFile(filePath), original)
  assert.deepEqual(await fs.readdir(root), ['injected.mp3'])
})
for (const tags of [{ title: '合法无专辑', album: '' }, { title: '', album: '仅有专辑' }, { title: '', album: '' }]) test(`MP3 empty fields normalize after tag parsing: ${JSON.stringify(tags)}`, async t => {
  const { root, files } = await setup(t)
  const filePath = path.join(root, 'empty-fields.mp3')
  await fs.copyFile(path.join(__dirname, 'fixtures/download/tone.mp3'), filePath)
  const beforePCM = pcm(filePath)
  const { writeMeta } = require('../../src-ztools/preload/runtime/download/metadata.cjs')
  const result = await writeMeta(files, { filePath, ...tags, artist: '歌手', APIC: null }, { lyric: '' })
  assert.equal(result.title, tags.title); assert.equal(result.album, tags.album)
  const { parseFile } = await import(pathToFileURL(require.resolve('music-metadata', { paths: [preload] })).href)
  const metadata = await parseFile(filePath)
  assert.equal(metadata.common.title ?? '', tags.title); assert.equal(metadata.common.album ?? '', tags.album)
  assert.equal(pcm(filePath), beforePCM)
})
