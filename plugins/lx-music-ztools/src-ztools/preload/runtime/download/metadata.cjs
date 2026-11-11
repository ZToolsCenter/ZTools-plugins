const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')
const { authorize, openResponse, failure, fileIdentity } = require('./transfer.cjs')
const { buildLyrics } = require('../../upstream/renderer/worker/download/lrcTool.cjs')
const imageSize = require('image-size')
const iconv = require('iconv-lite')
const operations = new Set()
const pathLocks = new Map()

function tracked(operation) { operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {}); return operation }
function serial(target, operation) {
  const previous = pathLocks.get(target) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  pathLocks.set(target, current)
  current.finally(() => { if (pathLocks.get(target) === current) pathLocks.delete(target) }).catch(() => {})
  return tracked(current)
}
async function coverBytes(url, proxy) {
  if (!url) return null
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw failure('无效封面地址')
  if (url.includes('music.126.net')) url += `${url.includes('?') ? '&' : '?'}param=500y500`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await openResponse(url, { proxy, signal: controller.signal })
    if (response.statusCode !== 200) { response.destroy(); throw failure(`封面请求失败 HTTP ${response.statusCode}`) }
    let size = 0; const chunks = []
    for await (const chunk of response) { size += chunk.length; if (size > 16 * 1024 * 1024) { response.destroy(); throw failure('封面文件过大') } chunks.push(chunk) }
    if (!response.complete || !size) throw failure('封面响应不完整')
    const data = Buffer.concat(chunks)
    const dimensions = imageSize(data)
    if (!['png', 'jpg'].includes(dimensions.type)) throw failure('封面须为 PNG/JPEG')
    return { data, width: dimensions.width, height: dimensions.height, mime: dimensions.type === 'jpg' ? 'image/jpeg' : 'image/png' }
  } finally { clearTimeout(timer) }
}
function runWriter(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'metadata-worker.cjs'), { workerData: data })
    let message
    worker.on('message', value => { message = value })
    worker.on('error', reject)
    worker.on('exit', code => { if (code || !message?.ok) reject(failure(message?.error || `标签写入线程退出 ${code}`)); else resolve(message.metadata) })
  })
}
async function writeMeta(files, info, lyric = { lyric: '' }, proxy, writer = runWriter) {
  const filePath = authorize(files, info.filePath)
  return serial(filePath, async () => {
    const ext = path.extname(filePath).toLowerCase()
    if (!['.mp3', '.flac'].includes(ext)) return
    const temp = authorize(files, path.join(path.dirname(filePath), `.lx-meta-${randomUUID()}${ext}`))
    const cover = await coverBytes(info.APIC, proxy)
    const meta = { title: info.title || '', artist: info.artist || '', album: info.album || '', lyrics: buildLyrics(lyric, info.isEmbedLyricLx, info.isEmbedLyricT, info.isEmbedLyricR) || '' }
    try {
      await fsp.copyFile(authorize(files, filePath), authorize(files, temp), fs.constants.COPYFILE_EXCL)
      const result = await writer({ filePath: authorize(files, temp), ext, meta, cover })
      const publishedIdentity = await fileIdentity(temp)
      if (!publishedIdentity) throw failure('标签副本缺少可靠文件身份')
      // Rename over the original only after the isolated writer and parser both finished.
      await fsp.rename(authorize(files, temp), authorize(files, filePath))
      return { ...result, fileIdentity: publishedIdentity }
    } finally { await fsp.rm(authorize(files, temp), { force: true }) }
  })
}
async function saveLrc(files, lyric, info) {
  const filePath = authorize(files, info.filePath)
  return serial(filePath, async () => {
    const temp = authorize(files, filePath + `.lx-${randomUUID()}.tmp`)
    const text = buildLyrics(lyric, info.downloadLxlrc, info.downloadTlrc, info.downloadRlrc) || ''
    const data = iconv.encode(text, info.format === 'gbk' ? 'gbk' : 'utf8', { addBOM: true })
    try {
      const handle = await fsp.open(authorize(files, temp), 'wx')
      try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
      await fsp.rename(authorize(files, temp), authorize(files, filePath))
    } finally { await fsp.rm(authorize(files, temp), { force: true }) }
  })
}
async function drain() { await Promise.allSettled([...operations]) }
async function drainTarget(target) { await pathLocks.get(target)?.catch(() => {}) }
module.exports = { writeMeta, saveLrc, drain, drainTarget }
