const fs = require('node:fs')
const fsp = fs.promises
const http = require('node:http')
const https = require('node:https')
const { createHash, randomUUID } = require('node:crypto')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const tunnel = require('tunnel')

const failure = (message, code = 'DOWNLOAD_INVALID') => Object.assign(new Error(message), { code })
function authorize(files, target) { return files.scope.authorize(target) }
function statIdentity(stat) {
  return stat.isFile() && stat.ino > 0n ? { dev: stat.dev.toString(), ino: stat.ino.toString() } : null
}
function validIdentity(value) { return value && typeof value.dev === 'string' && /^\d+$/.test(value.dev) && typeof value.ino === 'string' && /^\d+$/.test(value.ino) && value.ino !== '0' }
function sameIdentity(left, right) { return !!validIdentity(left) && !!validIdentity(right) && left.dev === right.dev && left.ino === right.ino }
async function fileIdentity(target) { return statIdentity(await fsp.lstat(target, { bigint: true })) }
async function removeOwned(files, target, expected) {
  if (!expected) return false
  authorize(files, target)
  const current = await fileIdentity(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (!sameIdentity(expected, current)) return false
  await fsp.unlink(target)
  return true
}
async function atomicJSON(files, target, value, expectedIdentity) {
  const temp = authorize(files, target + `.${randomUUID()}.tmp`)
  let tempIdentity
  try {
    await fsp.writeFile(temp, JSON.stringify(value), { flag: 'wx' })
    tempIdentity = await fileIdentity(temp)
    if (expectedIdentity) {
      if (!sameIdentity(expectedIdentity, await fileIdentity(target))) throw failure('临时状态文件归属已变化', 'DOWNLOAD_OWNERSHIP')
      await fsp.rename(authorize(files, temp), authorize(files, target))
    } else await fsp.link(authorize(files, temp), authorize(files, target))
    return await fileIdentity(target)
  } finally { await removeOwned(files, temp, tempIdentity) }
}
function validator(headers) {
  if (typeof headers.etag === 'string' && /^"[^\r\n]*"$/.test(headers.etag)) return headers.etag
  const modified = headers['last-modified']
  return typeof modified === 'string' && Number.isFinite(Date.parse(modified)) ? modified : null
}
function openResponse(url, { headers = {}, signal, proxy, timeout = 30000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let address
    try { address = new URL(url); if (!['http:', 'https:'].includes(address.protocol)) throw failure('仅支持 HTTP/HTTPS 下载地址') } catch (error) { reject(error); return }
    let agent
    if (proxy?.host) {
      agent = (address.protocol === 'https:' ? tunnel.httpsOverHttp : tunnel.httpOverHttp)({ proxy: { host: proxy.host, port: proxy.port } })
    }
    const request = (address.protocol === 'https:' ? https : http).get(address, { headers: { 'accept-encoding': 'identity', ...headers }, signal, agent }, response => {
      response.on('error', () => {})
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (!response.headers.location || redirects === 0) return reject(failure('下载重定向过多或缺少地址'))
        let next
        try { next = new URL(response.headers.location, address).href } catch (error) { reject(error); return }
        openResponse(next, { headers, signal, proxy, timeout, redirects: redirects - 1 }).then(resolve, reject)
      } else { response.resourceURL = address.href; resolve(response) }
    })
    request.setTimeout(timeout, () => request.destroy(failure('下载请求超时', 'ETIMEDOUT')))
    request.on('error', reject)
  })
}
async function sha256(target) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(target)) hash.update(chunk)
  return hash.digest('hex')
}
/** A single network attempt. Only the caller may publish the verified private file. */
async function transfer({ files, url, partialPath, checkpointPath, identity, signal, proxy, onProgress, onOwnership, timeout }) {
  authorize(files, partialPath); authorize(files, checkpointPath)
  // Inspect the leaf itself before canonicalization; a symlink must never become an owned file.
  const initialPartialIdentity = await fileIdentity(partialPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  let checkpointIdentity = await fileIdentity(checkpointPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  partialPath = authorize(files, partialPath); checkpointPath = authorize(files, checkpointPath)
  signal?.throwIfAborted()
  let checkpoint, offset = 0
  try {
    checkpoint = JSON.parse(await fsp.readFile(checkpointPath, 'utf8'))
    const stats = await fsp.stat(partialPath)
    if (!sameIdentity(initialPartialIdentity, checkpoint.fileIdentity)) throw failure('临时音频文件归属已变化', 'DOWNLOAD_OWNERSHIP')
    if (checkpoint.version === 1 && checkpoint.identity === identity && checkpoint.url === url && typeof checkpoint.resourceURL === 'string' && checkpoint.validator && !checkpoint.validator.startsWith('W/') && stats.size === checkpoint.offset && stats.size > 0 && (!checkpoint.total || stats.size < checkpoint.total)) offset = stats.size
  } catch (error) { if (!['ENOENT', undefined].includes(error.code) && !(error instanceof SyntaxError)) throw error }
  if (initialPartialIdentity && (!checkpoint || !sameIdentity(initialPartialIdentity, checkpoint.fileIdentity))) throw failure('临时音频文件归属不明', 'DOWNLOAD_OWNERSHIP')
  const headers = offset ? { Range: `bytes=${offset}-`, 'If-Range': checkpoint.validator } : {}
  const response = await openResponse(url, { headers, signal, proxy, timeout })
  const rejectResponse = async error => { response.destroy(); throw error }
  if (![200, 206].includes(response.statusCode)) return rejectResponse(failure(`HTTP ${response.statusCode}`, [401, 403, 410].includes(response.statusCode) ? 'URL_EXPIRED' : 'HTTP_ERROR'))
  if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return rejectResponse(failure('不支持压缩的音频响应'))
  let total = 0, expected = null
  const length = response.headers['content-length']
  if (length !== undefined) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return rejectResponse(failure('无效 Content-Length'))
    expected = Number(length)
  }
  const currentValidator = validator(response.headers)
  if (response.statusCode === 206) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '')
    if (!match) return rejectResponse(failure('无效 Content-Range'))
    const [start, end, size] = match.slice(1).map(Number)
    if (offset && (currentValidator !== checkpoint.validator || response.resourceURL !== checkpoint.resourceURL)) {
      checkpointIdentity = await atomicJSON(files, checkpointPath, { ...checkpoint, offset: 0, validator: null }, checkpointIdentity)
      onOwnership?.({ partial: initialPartialIdentity, checkpoint: checkpointIdentity })
      return rejectResponse(failure('续传资源已变化', 'ENTITY_CHANGED'))
    }
    if (![start, end, size].every(Number.isSafeInteger) || start !== offset || end < start || end !== size - 1 || (expected !== null && expected !== end - start + 1) || (offset && checkpoint.total && size !== checkpoint.total)) return rejectResponse(failure('续传范围或长度不一致'))
    total = size; expected = end - start + 1
  } else { offset = 0; total = expected || 0 }
  const handle = await fsp.open(authorize(files, partialPath), initialPartialIdentity ? 'r+' : 'wx')
  let partialIdentity
  try {
    partialIdentity = statIdentity(await handle.stat({ bigint: true }))
    if (!partialIdentity || initialPartialIdentity && !sameIdentity(initialPartialIdentity, partialIdentity)) throw failure('临时音频文件归属已变化', 'DOWNLOAD_OWNERSHIP')
    onOwnership?.({ partial: partialIdentity, checkpoint: checkpointIdentity })
    // Retain the owned handle across truncation and streaming; never reopen a swapped pathname.
    if (!offset) await handle.truncate(0)
    checkpoint = { version: 1, identity, url, resourceURL: response.resourceURL, validator: currentValidator, offset, total, fileIdentity: partialIdentity }
    checkpointIdentity = await atomicJSON(files, checkpointPath, checkpoint, checkpointIdentity)
    onOwnership?.({ partial: partialIdentity, checkpoint: checkpointIdentity })
  } catch (error) { await handle.close(); response.destroy(); throw error }
  let received = 0
  const started = Date.now()
  const meter = new Transform({ transform(chunk, encoding, done) {
    received += chunk.length
    if (expected !== null && received > expected) return done(failure('响应超过声明长度'))
    onProgress?.({ downloaded: offset + received, total, progress: total ? Math.min(100, (offset + received) / total * 100) : 0, speed: `${((received / Math.max(1, Date.now() - started)) * 1000 / 1024).toFixed(1)} KB`, writeQueue: 0 })
    done(null, chunk)
  } })
  const writer = handle.createWriteStream({ start: offset, autoClose: true })
  const closed = new Promise(resolve => writer.once('close', resolve))
  try {
    await pipeline(response, meter, writer, { signal })
    await closed
    signal?.throwIfAborted()
    if (!response.complete || !received || expected !== null && received !== expected) throw failure('下载响应未完整结束')
    const stats = await fsp.stat(authorize(files, partialPath))
    if (stats.size !== offset + received || total && stats.size !== total) throw failure('落盘长度不一致')
    if (!sameIdentity(partialIdentity, await fileIdentity(partialPath))) throw failure('下载临时音频已被替换', 'DOWNLOAD_OWNERSHIP')
    const syncHandle = await fsp.open(authorize(files, partialPath), 'r+')
    try { await syncHandle.sync() } finally { await syncHandle.close() }
    return { size: stats.size, sha256: await sha256(authorize(files, partialPath)), fileIdentity: partialIdentity, validator: currentValidator, total: total || stats.size }
  } finally {
    // Abort may reject pipeline before a pending filesystem write/close completes.
    // Snapshot only after close; otherwise pause can persist an offset behind real bytes.
    await closed
    const stats = await fsp.stat(authorize(files, partialPath)).catch(() => null)
    if (stats && sameIdentity(partialIdentity, await fileIdentity(partialPath))) {
      checkpointIdentity = await atomicJSON(files, checkpointPath, { ...checkpoint, offset: stats.size }, checkpointIdentity)
      onOwnership?.({ partial: partialIdentity, checkpoint: checkpointIdentity })
    }
  }
}
module.exports = { transfer, openResponse, sha256, atomicJSON, authorize, failure, fileIdentity, sameIdentity, removeOwned }
