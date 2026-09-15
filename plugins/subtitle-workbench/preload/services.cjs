'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const core = require('./subtitle-core.cjs')
const MAX_SUBTITLE_BYTES = 15 * 1024 * 1024
const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024
const MAX_GRANTS = 20
const MAX_MCP_INLINE_BYTES = 512 * 1024
const MAX_MCP_RESPONSE_BYTES = 512 * 1024
const MAX_MCP_FINDINGS = 200
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt'])
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.mp3', '.wav'])
const grants = new Map()
const entryQueue = []
const audioJobs = new Map()
const audioCleanupFailures = new Map()
const TOOL_NAMES = Object.freeze({ analyze: 'analyze', transform: 'transform', analyzeApprovedFile: 'analyze_approved_file' })
const registeredHosts = new WeakSet()
let activeSubtitleGrantId = null
let audioPromotionIo = null
let audioCleanupIo = null
let fileValidationIo = null
let sessionEpoch = 0
const AUDIO_ERROR_MESSAGES = Object.freeze({
  AUDIO_OUTPUT_SYMLINK: '不能覆盖符号链接。',
  AUDIO_OUTPUT_NOT_FILE: '音轨输出位置必须是普通文件，不能覆盖目录或特殊文件。',
  AUDIO_OUTPUT_CHECK_FAILED: '无法安全检查音轨输出位置。',
  AUDIO_TEMPORARY_CHECK_FAILED: '无法安全准备音轨临时文件。',
  AUDIO_EXTRACT_START_FAILED: '无法启动音轨提取。',
  AUDIO_PROMOTE_FAILED: '新音轨写入失败，原文件已恢复。',
  AUDIO_BACKUP_RESTORE_FAILED: '新音轨写入失败，原文件也未能自动恢复。',
  AUDIO_TEMP_CLEANUP_FAILED: '音轨临时文件未能清理，请重试。',
  AUDIO_EXTRACT_FAILED: '音轨提取或写入失败。',
  AUDIO_CANCELED: '音轨提取已取消。'
})
function host() { return typeof window !== 'undefined' && window.ztools ? window.ztools : {} }
function makeId() { return crypto.randomBytes(12).toString('hex') }
function byteLength(value) { return Buffer.byteLength(String(value || ''), 'utf8') }
function dialogPath(result) { return Array.isArray(result) ? result[0] : typeof result === 'string' ? result : result && Array.isArray(result.filePaths) ? result.filePaths[0] : null }
function extension(value) { return path.extname(String(value || '')).toLowerCase() }
function revokeGrant(id) { grants.delete(id); if (activeSubtitleGrantId === id) activeSubtitleGrantId = null }
function sameFileIdentity(left, right) { return ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((key) => left[key] === right[key]) }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function safeBaseName(value) { return String(value || '音轨.wav').split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '_').slice(0, 180) }
function stableAudioError(code, file) { const error = new Error(AUDIO_ERROR_MESSAGES[code] || AUDIO_ERROR_MESSAGES.AUDIO_EXTRACT_FAILED); error.code = code; error.fileName = safeBaseName(file); return error }
function sessionExpired() { const error = new Error('当前插件会话已结束，请重新打开文件。'); error.code = 'SESSION_EXPIRED'; return error }
function assertSessionEpoch(epoch) { if (epoch !== sessionEpoch) throw sessionExpired() }
function assertReplaceableAudioOutput(entry, output) {
  if (entry.isSymbolicLink()) throw stableAudioError('AUDIO_OUTPUT_SYMLINK', output)
  if (!entry.isFile()) throw stableAudioError('AUDIO_OUTPUT_NOT_FILE', output)
}
function audioFailureDetails(failure, output, canceled) {
  const requested = canceled ? 'AUDIO_CANCELED' : failure && failure.code
  const code = Object.hasOwn(AUDIO_ERROR_MESSAGES, requested) ? requested : 'AUDIO_EXTRACT_FAILED'
  return { code, message: AUDIO_ERROR_MESSAGES[code], fileName: safeBaseName(failure && failure.fileName || output) }
}
async function readHandleBounded(handle, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_SUBTITLE_BYTES) throw new RangeError('输入超过大小限制')
  const buffer = Buffer.allocUnsafe(limit + 1)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > limit) throw new RangeError('输入超过大小限制')
  return buffer.subarray(0, offset)
}
async function cleanupTemporary(jobId, record) {
  const temporary = record && record.temporary
  if (!temporary) { audioCleanupFailures.delete(jobId); return { ok: true } }
  if (record.cleanupPromise) return record.cleanupPromise
  const disk = audioCleanupIo || fs
  const pending = (async () => {
    try {
      await disk.rm(temporary, { force: true })
      if (record.temporary === temporary) record.temporary = null
      audioCleanupFailures.delete(jobId)
      if (record.warning?.code === 'AUDIO_TEMP_CLEANUP_FAILED') record.warning = null
      return { ok: true, fileName: safeBaseName(temporary) }
    } catch {
      const warning = { code: 'AUDIO_TEMP_CLEANUP_FAILED', fileName: safeBaseName(temporary) }
      record.warning = warning
      audioCleanupFailures.set(jobId, record)
      return { ok: false, ...warning }
    }
  })()
  record.cleanupPromise = pending
  try { return await pending }
  finally { if (record.cleanupPromise === pending) record.cleanupPromise = null }
}
function clearSession() {
  sessionEpoch += 1
  grants.clear(); entryQueue.length = 0; activeSubtitleGrantId = null
  const cleanupRecords = new Map([...audioCleanupFailures, ...audioJobs])
  for (const [jobId, record] of cleanupRecords) {
    record.state = 'canceling'
    try { if (record.job && typeof record.job.quit === 'function') record.job.quit(); else if (record.job && typeof record.job.kill === 'function') record.job.kill() } catch {}
    if (record.temporary) void cleanupTemporary(jobId, record)
  }
  audioJobs.clear()
  audioPromotionIo = null
  audioCleanupIo = null
  fileValidationIo = null
}
async function validateFile(candidate, expectedType) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('输入文件必须使用绝对路径')
  const disk = fileValidationIo || fs
  const first = await disk.lstat(candidate); if (!first.isFile() || first.isSymbolicLink()) throw new Error('输入必须是普通文件，不能是符号链接')
  const real = await disk.realpath(candidate); const entry = await disk.lstat(real); if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('解析后的输入必须是普通文件')
  const ext = extension(real); const type = SUBTITLE_EXTENSIONS.has(ext) ? 'subtitle' : MEDIA_EXTENSIONS.has(ext) ? 'media' : null
  if (!type || expectedType && type !== expectedType) throw new Error('当前操作不支持此文件扩展名')
  if (entry.size > (type === 'subtitle' ? MAX_SUBTITLE_BYTES : MAX_MEDIA_BYTES)) throw new RangeError('输入超过大小限制')
  return { path: real, type, ext, size: entry.size, dev: entry.dev, ino: entry.ino, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs }
}
async function snapshotSubtitleDigest(checked) {
  let handle
  try {
    handle = await fs.open(checked.path, 'r')
    const before = await handle.stat(); if (!sameFileIdentity(before, checked)) throw new Error('字幕在授权前已发生变化')
    const bytes = await readHandleBounded(handle, checked.size)
    const after = await handle.stat(); if (!sameFileIdentity(after, checked) || bytes.length !== checked.size) throw new Error('字幕在授权过程中发生变化')
    return sha256(bytes)
  } finally { if (handle) await handle.close() }
}
async function grantFile(candidate, epoch = sessionEpoch) {
  assertSessionEpoch(epoch)
  const checked = await validateFile(candidate)
  assertSessionEpoch(epoch)
  const digest = checked.type === 'subtitle' ? await snapshotSubtitleDigest(checked) : null
  assertSessionEpoch(epoch)
  if (grants.size >= MAX_GRANTS) revokeGrant(grants.keys().next().value)
  const id = makeId(); grants.set(id, { ...checked, digest, expiresAt: Date.now() + 30 * 60 * 1000 })
  if (checked.type === 'subtitle') activeSubtitleGrantId = id
  return { grantId: id, type: checked.type, name: path.basename(checked.path), size: checked.size, extension: checked.ext }
}
async function getGrant(id, expected) {
  const grant = grants.get(id); if (!grant || grant.expiresAt < Date.now()) { revokeGrant(id); throw new Error('文件授权已过期') }
  try {
    const checked = await validateFile(grant.path, expected)
    if (checked.path !== grant.path || checked.type !== grant.type || !sameFileIdentity(checked, grant)) throw new Error('已授权文件在选择后发生变化')
    return grant
  } catch (error) { revokeGrant(id); throw error }
}
async function getGrantForSession(id, expected, epoch) {
  assertSessionEpoch(epoch)
  try {
    const grant = await getGrant(id, expected)
    assertSessionEpoch(epoch)
    return grant
  } catch (error) {
    if (epoch !== sessionEpoch) throw sessionExpired()
    throw error
  }
}
async function chooseInput() {
  const epoch = sessionEpoch
  const api = host(); if (typeof api.showOpenDialog !== 'function') return { ok: false, code: 'DIALOG_UNAVAILABLE' }
  const selected = dialogPath(await api.showOpenDialog({ title: '选择一个字幕或媒体文件', properties: ['openFile'], filters: [{ name: '字幕或媒体', extensions: ['srt', 'vtt', 'mp4', 'mov', 'mkv', 'mp3', 'wav'] }] }))
  if (epoch !== sessionEpoch) return { ok: false, code: 'SESSION_EXPIRED' }
  if (!selected) return { ok: false, code: 'CANCELED' }
  try { return { ok: true, file: await grantFile(selected, epoch) } }
  catch (error) { if (error?.code === 'SESSION_EXPIRED') return { ok: false, code: error.code }; throw error }
}
async function queueEntry(payload) {
  const epoch = sessionEpoch
  const api = host(); const file = Array.isArray(payload) ? payload[0] : null
  if (!file || typeof api.getPathForFile !== 'function') return
  try {
    const nativePath = await api.getPathForFile(file)
    assertSessionEpoch(epoch)
    const granted = await grantFile(nativePath, epoch)
    assertSessionEpoch(epoch)
    entryQueue.push({ ok: true, file: granted })
  }
  catch (error) { if (epoch === sessionEpoch && error?.code !== 'SESSION_EXPIRED') entryQueue.push({ ok: false, code: 'ENTRY_REJECTED', message: String(error.message || error).slice(0, 160) }) }
}
function consumeEntry() { return entryQueue.shift() || { ok: false, code: 'NO_ENTRY' } }
async function readGrantedSubtitle(id, epoch = sessionEpoch) {
  let grant, handle
  try {
    assertSessionEpoch(epoch)
    grant = await getGrant(id, 'subtitle'); handle = await fs.open(grant.path, 'r')
    assertSessionEpoch(epoch)
    const before = await handle.stat(); if (!sameFileIdentity(before, grant)) throw new Error('已授权文件在读取前发生变化')
    const bytes = await readHandleBounded(handle, grant.size)
    const after = await handle.stat(); if (!sameFileIdentity(after, grant)) throw new Error('已授权文件在读取过程中发生变化')
    if (bytes.length !== grant.size || sha256(bytes) !== grant.digest) throw new Error('已授权文件内容在选择后发生变化')
    assertSessionEpoch(epoch)
    const content = bytes.toString('utf8')
    if (byteLength(content) > MAX_SUBTITLE_BYTES) throw new RangeError('输入超过文本大小限制')
    return { name: path.basename(grant.path), format: grant.ext.slice(1), content }
  } catch (error) { revokeGrant(id); throw error }
  finally { if (handle) await handle.close() }
}
function analyze(content, format, options) {
  if (byteLength(content) > MAX_SUBTITLE_BYTES) throw new RangeError('字幕文本超过大小限制')
  const normalized = format === 'vtt' ? 'vtt' : 'srt'; const cues = core.parse(content, normalized)
  return { cues, findings: core.qualityCheck(cues, options || {}) }
}
function transform(content, format, operation) {
  const input = operation && typeof operation === 'object' ? operation : {}; const result = analyze(content, format)
  let cues = result.cues
  if (input.type === 'shift') cues = core.shift(cues, Number(input.milliseconds))
  else if (input.type === 'speed') cues = core.scale(cues, Number(input.speed))
  else if (input.type === 'fps') { const source = Number(input.sourceFps); const target = Number(input.targetFps); if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0 || source > 240 || target > 240) throw new RangeError('帧率无效'); cues = core.scale(cues, target / source) }
  else if (input.type !== 'convert') throw new Error('未知的字幕转换操作')
  const outputFormat = input.format || format
  return outputFormat === 'vtt' ? core.toVtt(cues) : core.toSrt(cues)
}
function assertReplaceableSubtitleOutput(entry) {
  if (entry.isSymbolicLink()) throw new Error('不能覆盖符号链接')
  if (!entry.isFile()) throw new Error('字幕输出位置必须是普通文件，不能覆盖目录或特殊文件')
}
const SAFE_SUBTITLE_SAVE_MESSAGES = new Set([
  '不能覆盖符号链接',
  '字幕输出位置必须是普通文件，不能覆盖目录或特殊文件',
  '字幕输出位置在保存过程中发生变化'
])
function stableSubtitleSaveError(error) {
  if (error?.code === 'SESSION_EXPIRED' || error?.code === 'SUBTITLE_SAVE_ROLLBACK_FAILED') return error
  if (SAFE_SUBTITLE_SAVE_MESSAGES.has(error?.message)) return error
  const failure = new Error('字幕保存失败；请检查目标位置是否可写且未被占用。')
  failure.code = 'SUBTITLE_SAVE_FAILED'
  return failure
}
async function subtitleOutputIdentity(destination) {
  try {
    const entry = await fs.lstat(destination)
    assertReplaceableSubtitleOutput(entry)
    return { dev: entry.dev, ino: entry.ino, size: entry.size, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
async function assertSubtitleOutputUnchanged(destination, approved) {
  const current = await subtitleOutputIdentity(destination)
  if (!approved && !current) return
  if (!approved || !current || !sameFileIdentity(approved, current)) throw new Error('字幕输出位置在保存过程中发生变化')
}
async function writeAtomically(destination, content, approvedDestination, epoch = sessionEpoch) {
  const nonce = crypto.randomBytes(6).toString('hex')
  const temporary = destination + '.ztools-' + nonce + '.tmp'
  const backup = destination + '.ztools-' + nonce + '.backup'
  let movedOriginal = false
  let installedFinal = false
  let rollbackFailed = false
  try {
    assertSessionEpoch(epoch)
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    assertSessionEpoch(epoch)
    await assertSubtitleOutputUnchanged(destination, approvedDestination)
    assertSessionEpoch(epoch)
    if (approvedDestination) {
      await fs.rename(destination, backup)
      movedOriginal = true
      assertSessionEpoch(epoch)
    }
    assertSessionEpoch(epoch)
    await fs.rename(temporary, destination)
    installedFinal = true
    assertSessionEpoch(epoch)
    if (movedOriginal) {
      // The final rename plus the epoch check above is the commit point. Once
      // backup cleanup starts, a later plugin-out must not turn a completed
      // save into a rejected promise after the original has been removed.
      await fs.rm(backup, { force: true })
      movedOriginal = false
    }
  }
  catch (error) {
    try {
      if (installedFinal) await fs.rm(destination, { force: true })
      if (movedOriginal) {
        await fs.rename(backup, destination)
        movedOriginal = false
      }
    } catch {
      rollbackFailed = true
    }
    if (rollbackFailed) {
      const failure = new Error('字幕保存已取消，但原文件恢复失败；请检查同目录的恢复副本。')
      failure.code = 'SUBTITLE_SAVE_ROLLBACK_FAILED'
      throw failure
    }
    throw error
  }
  finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
    if (!rollbackFailed && movedOriginal) await fs.rm(backup, { force: true }).catch(() => {})
  }
}
async function saveSubtitle(content, format, name) {
  if (byteLength(content) > MAX_SUBTITLE_BYTES) throw new RangeError('字幕文本超过大小限制')
  const epoch = sessionEpoch
  assertSessionEpoch(epoch)
  const kind = format === 'vtt' ? 'vtt' : 'srt'; const api = host(); if (typeof api.showSaveDialog !== 'function') throw new Error('保存对话框不可用')
  const fallback = String(name || '字幕').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.(?:srt|vtt)$/i, '') + '.' + kind
  try {
    const chosen = await api.showSaveDialog({ title: '保存字幕', defaultPath: fallback, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] })
    assertSessionEpoch(epoch)
    const destination = typeof chosen === 'string' ? chosen : chosen && !chosen.canceled ? chosen.filePath : null
    if (!destination || !path.isAbsolute(destination)) return { canceled: true }
    const prior = await subtitleOutputIdentity(destination)
    assertSessionEpoch(epoch)
    await writeAtomically(destination, content, prior, epoch)
    return { canceled: false, fileName: path.basename(destination) }
  } catch (error) {
    throw stableSubtitleSaveError(error)
  }
}
function getCapabilities() {
  const api = host()
  return { ffmpeg: typeof api.runFFmpeg === 'function', ffmpegCancel: false, whisper: { verified: false, runnable: false }, transcription: 'v0.1 不探测 PATH，也不运行转写二进制；后续版本需通过明确适配器配置。' }
}
async function promoteAudio(temporary, output, io) {
  const disk = io || fs
  let backup = null
  try {
    const existing = await disk.lstat(output)
    assertReplaceableAudioOutput(existing, output)
    backup = output + '.ztools-backup-' + makeId()
    await disk.rename(output, backup)
  } catch (error) { if (error && error.code !== 'ENOENT') throw error }
  try {
    await disk.rename(temporary, output)
  }
  catch (error) {
    if (backup) {
      try { await disk.rename(backup, output) }
      catch { throw stableAudioError('AUDIO_BACKUP_RESTORE_FAILED', backup) }
    }
    throw stableAudioError('AUDIO_PROMOTE_FAILED', output)
  }
  if (!backup) return { warning: null }
  try { await disk.rm(backup, { force: true }); return { warning: null } }
  catch { return { warning: { code: 'AUDIO_BACKUP_CLEANUP_FAILED', fileName: safeBaseName(backup) } } }
}
async function startAudioExtract(id) {
  const epoch = sessionEpoch
  let grant = await getGrantForSession(id, 'media', epoch); const api = host(); if (typeof api.runFFmpeg !== 'function') return { ok: false, code: 'FFMPEG_UNAVAILABLE' }
  if (typeof api.showSaveDialog !== 'function') throw new Error('保存对话框不可用')
  const chosen = await api.showSaveDialog({ title: '导出音轨', defaultPath: path.basename(grant.path, grant.ext) + '.wav', filters: [{ name: 'WAV', extensions: ['wav'] }] })
  assertSessionEpoch(epoch)
  const output = typeof chosen === 'string' ? chosen : chosen && !chosen.canceled ? chosen.filePath : null
  if (!output || !path.isAbsolute(output)) return { ok: false, code: 'CANCELED' }
  try { const prior = await fs.lstat(output); assertReplaceableAudioOutput(prior, output) }
  catch (error) { if (error && error.code !== 'ENOENT') { if (Object.hasOwn(AUDIO_ERROR_MESSAGES, error.code)) throw error; throw stableAudioError('AUDIO_OUTPUT_CHECK_FAILED', output) } }
  assertSessionEpoch(epoch)
  grant = await getGrantForSession(id, 'media', epoch)
  if (path.resolve(output) === path.resolve(grant.path)) throw new Error('音轨输出文件不能与输入文件相同')
  if (new Set([...audioJobs.keys(), ...audioCleanupFailures.keys()]).size >= MAX_GRANTS) {
    for (const [key, value] of audioJobs) if (value.state !== 'running' && value.state !== 'canceling' && !audioCleanupFailures.has(key)) audioJobs.delete(key)
    if (new Set([...audioJobs.keys(), ...audioCleanupFailures.keys()]).size >= MAX_GRANTS) throw new Error('保留的音轨任务过多，请先清理临时音轨')
  }
  const suffix = path.extname(output) || '.wav'; const temporary = path.join(path.dirname(output), '.' + path.basename(output, suffix) + '.ztools-' + makeId() + suffix)
  try { await fs.lstat(temporary); throw stableAudioError('AUDIO_TEMPORARY_CHECK_FAILED', temporary) }
  catch (error) { if (error && error.code !== 'ENOENT') { if (Object.hasOwn(AUDIO_ERROR_MESSAGES, error.code)) throw error; throw stableAudioError('AUDIO_TEMPORARY_CHECK_FAILED', temporary) } }
  assertSessionEpoch(epoch)
  const idValue = makeId(); let job
  try { job = api.runFFmpeg(['-n', '-i', grant.path, '-vn', '-acodec', 'pcm_s16le', temporary], undefined) }
  catch { throw stableAudioError('AUDIO_EXTRACT_START_FAILED', output) }
  const record = { job, temporary, output, state: 'running', code: null, message: '', warning: null, fileName: safeBaseName(output), cleanupPromise: null }; audioJobs.set(idValue, record)
  const finish = async (error) => {
    try {
      if (error || record.state === 'canceling') throw error || new Error('音轨提取已取消')
      const promoted = await promoteAudio(temporary, output, audioPromotionIo || undefined); record.state = 'completed'; record.warning = promoted && promoted.warning || null
    } catch (failure) { const canceled = record.state === 'canceling'; const detail = audioFailureDetails(failure, output, canceled); record.state = canceled ? 'canceled' : 'failed'; record.code = detail.code; record.message = detail.message; record.fileName = detail.fileName; await cleanupTemporary(idValue, record) }
    const cleanupTimer = setTimeout(() => audioJobs.delete(idValue), 5 * 60 * 1000); if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref()
  }
  Promise.resolve(job).then(() => finish(), error => finish(error))
  return { ok: true, jobId: idValue, cancelSupported: Boolean(job && (typeof job.quit === 'function' || typeof job.kill === 'function')) }
}
function audioJobStatus(jobId) { const record = audioJobs.get(jobId); if (!record) return { state: 'unknown' }; return { state: record.state, code: record.code, message: record.message, warning: record.warning ? { code: record.warning.code, fileName: record.warning.fileName } : null, fileName: record.fileName } }
function pendingAudioCleanups() {
  return [...audioCleanupFailures].slice(0, MAX_GRANTS).map(([jobId, record]) => ({ jobId, code: 'AUDIO_TEMP_CLEANUP_FAILED', fileName: safeBaseName(record.temporary) }))
}
async function retryAudioCleanup(jobId) {
  const id = typeof jobId === 'string' ? jobId : ''
  const record = audioCleanupFailures.get(id)
  if (!record) return { ok: false, code: 'AUDIO_CLEANUP_NOT_PENDING' }
  return cleanupTemporary(id, record)
}
async function cancelAudio(jobId) {
  const record = audioJobs.get(jobId)
  if (!record) throw new Error('未知的音轨任务')
  const cancel = record.job && (typeof record.job.quit === 'function' ? record.job.quit : typeof record.job.kill === 'function' ? record.job.kill : null)
  if (!cancel) return { ok: false, code: 'CANCEL_UNAVAILABLE' }
  if (record.state === 'canceled' || record.state === 'completed' || record.state === 'failed') return { ok: false, code: 'CANCEL_UNAVAILABLE' }
  record.state = 'canceling'
  await cancel.call(record.job)
  return { ok: true }
}
async function startTranscription() { return { ok: false, code: 'TRANSCRIPTION_UNSUPPORTED', message: 'v0.1 不探测 PATH，也不执行 Python whisper 或 whisper.cpp。' } }
function invalidTool(message) { const error = new Error(message); error.code = 'INVALID_TOOL_INPUT'; throw error }
function validatePlainObject(input, allowed, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidTool(label + '必须是对象。')
  let prototype, keys
  try { prototype = Object.getPrototypeOf(input); keys = Reflect.ownKeys(input) } catch { invalidTool(label + '结构无效。') }
  if (prototype !== Object.prototype && prototype !== null) invalidTool(label + '原型无效。')
  const values = Object.create(null)
  for (const key of keys) {
    if (typeof key !== 'string' || key === '__proto__' || key === 'prototype' || key === 'constructor' || !allowed.has(key)) invalidTool(label + '包含未允许字段。')
    let descriptor
    try { descriptor = Object.getOwnPropertyDescriptor(input, key) } catch { invalidTool(label + '字段无效。') }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalidTool(label + '只允许数据字段。')
    values[key] = descriptor.value
  }
  return values
}
function validateFormat(value) { if (!['srt', 'vtt'].includes(value)) invalidTool('format 必须是 srt 或 vtt。'); return value }
function validatePage(input) {
  const offset = input.offset === undefined ? 0 : input.offset
  const limit = input.limit === undefined ? 100 : input.limit
  if (!Number.isSafeInteger(offset) || offset < 0) invalidTool('offset 必须是非负安全整数。')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MCP_FINDINGS) invalidTool('limit 必须是 1—200 的安全整数。')
  return { offset, limit }
}
function validateThresholds(value) {
  if (value === undefined) return {}
  value = validatePlainObject(value, new Set(['minDuration', 'maxDuration', 'maxCharsPerSecond']), 'thresholds')
  const output = {}
  if (value.minDuration !== undefined) {
    if (!Number.isSafeInteger(value.minDuration) || value.minDuration < 0 || value.minDuration > 60000) invalidTool('minDuration 必须是 0—60000 的整数。')
    output.minDuration = value.minDuration
  }
  if (value.maxDuration !== undefined) {
    if (!Number.isSafeInteger(value.maxDuration) || value.maxDuration < 1 || value.maxDuration > 600000) invalidTool('maxDuration 必须是 1—600000 的整数。')
    output.maxDuration = value.maxDuration
  }
  if (value.maxCharsPerSecond !== undefined) {
    if (!Number.isFinite(value.maxCharsPerSecond) || value.maxCharsPerSecond <= 0 || value.maxCharsPerSecond > 1000) invalidTool('maxCharsPerSecond 必须大于 0 且不超过 1000。')
    output.maxCharsPerSecond = value.maxCharsPerSecond
  }
  const min = output.minDuration === undefined ? 500 : output.minDuration
  const max = output.maxDuration === undefined ? 8000 : output.maxDuration
  if (max < min) invalidTool('maxDuration 不能小于 minDuration。')
  return output
}
function validateInlineContent(value) {
  if (typeof value !== 'string') invalidTool('content 必须是字符串。')
  if (byteLength(value) > MAX_MCP_INLINE_BYTES) invalidTool('内联字幕不得超过 512 KiB UTF-8。')
  return value
}
function summarizeAnalysis(result, page) {
  let startMs = 0
  let endMs = 0
  if (result.cues.length) {
    startMs = result.cues[0].start
    endMs = result.cues[0].end
    for (let index = 1; index < result.cues.length; index += 1) {
      const cue = result.cues[index]
      if (cue.start < startMs) startMs = cue.start
      if (cue.end > endMs) endMs = cue.end
    }
  }
  const byCode = Object.create(null)
  for (const finding of result.findings) byCode[finding.code] = (byCode[finding.code] || 0) + 1
  const findings = result.findings.slice(page.offset, page.offset + page.limit).map((item) => ({ index: item.index, code: item.code }))
  const hasMore = page.offset + findings.length < result.findings.length
  return {
    cueCount: result.cues.length,
    duration: { startMs, endMs, spanMs: Math.max(0, endMs - startMs) },
    findings,
    summary: { totalFindings: result.findings.length, byCode, offset: page.offset, limit: page.limit, returned: findings.length, hasMore, nextOffset: hasMore ? page.offset + findings.length : null, truncated: hasMore }
  }
}
function validateAnalyzeToolInput(input, inline) {
  const allowed = new Set(inline ? ['content', 'format', 'thresholds', 'offset', 'limit'] : ['thresholds', 'offset', 'limit'])
  input = validatePlainObject(input, allowed, '分析参数')
  return { ...(inline ? { content: validateInlineContent(input.content), format: validateFormat(input.format) } : {}), thresholds: validateThresholds(input.thresholds), ...validatePage(input) }
}
function validateTransformToolInput(input) {
  input = validatePlainObject(input, new Set(['content', 'format', 'operation', 'milliseconds', 'speed', 'sourceFps', 'targetFps', 'outputFormat']), '转换参数')
  const value = { content: validateInlineContent(input.content), format: validateFormat(input.format), operation: input.operation, outputFormat: input.outputFormat === undefined ? input.format : validateFormat(input.outputFormat) }
  if (!['shift', 'speed', 'fps', 'convert'].includes(value.operation)) invalidTool('operation 无效。')
  const allowedForOperation = {
    shift: new Set(['content', 'format', 'operation', 'milliseconds', 'outputFormat']),
    speed: new Set(['content', 'format', 'operation', 'speed', 'outputFormat']),
    fps: new Set(['content', 'format', 'operation', 'sourceFps', 'targetFps', 'outputFormat']),
    convert: new Set(['content', 'format', 'operation', 'outputFormat'])
  }[value.operation]
  if (Object.keys(input).some((key) => !allowedForOperation.has(key))) invalidTool('operation 包含不适用字段。')
  if (value.operation === 'convert' && input.outputFormat === undefined) invalidTool('convert 必须显式提供 outputFormat。')
  if (value.operation === 'shift') {
    if (!Number.isSafeInteger(input.milliseconds) || Math.abs(input.milliseconds) > 86400000) invalidTool('milliseconds 必须是 ±86400000 内的整数。')
    value.milliseconds = input.milliseconds
  } else if (value.operation === 'speed') {
    if (!Number.isFinite(input.speed) || input.speed < 0.1 || input.speed > 10) invalidTool('speed 必须在 0.1—10。')
    value.speed = input.speed
  } else if (value.operation === 'fps') {
    if (!Number.isFinite(input.sourceFps) || input.sourceFps < 1 || input.sourceFps > 240 || !Number.isFinite(input.targetFps) || input.targetFps < 1 || input.targetFps > 240) invalidTool('帧率必须在 1—240。')
    value.sourceFps = input.sourceFps; value.targetFps = input.targetFps
  }
  return value
}
function stableToolError(code, message) { const error = new Error(message); error.code = code; return error }
function boundedToolResponse(value) {
  let size
  try { size = Buffer.byteLength(JSON.stringify(value), 'utf8') } catch { size = Infinity }
  if (size > MAX_MCP_RESPONSE_BYTES) throw stableToolError('MCP_RESPONSE_TOO_LARGE', 'MCP 响应超过 512 KiB，请缩小分页或改用界面处理。')
  return value
}
function createToolHandlers() {
  return Object.freeze({
    analyze(input) {
      const value = validateAnalyzeToolInput(input, true)
      try { return boundedToolResponse(summarizeAnalysis(analyze(value.content, value.format, value.thresholds), value)) }
      catch (error) { if (error?.code === 'INVALID_TOOL_INPUT' || error?.code === 'MCP_RESPONSE_TOO_LARGE') throw error; throw stableToolError('SUBTITLE_ANALYSIS_FAILED', '字幕解析或分析失败，请检查格式与安全限制。') }
    },
    transform(input) {
      const value = validateTransformToolInput(input)
      try {
        const before = analyze(value.content, value.format)
        const content = transform(value.content, value.format, { type: value.operation, milliseconds: value.milliseconds, speed: value.speed, sourceFps: value.sourceFps, targetFps: value.targetFps, format: value.outputFormat })
        if (byteLength(content) > MAX_MCP_INLINE_BYTES) invalidTool('转换结果超过 512 KiB UTF-8，请改用界面处理。')
        const warnings = []
        if (value.format === 'vtt' && value.outputFormat === 'srt') warnings.push('VTT STYLE、REGION、NOTE 与 cue 设置不会写入 SRT。')
        return boundedToolResponse({ outputFormat: value.outputFormat, content, cueCount: before.cues.length, warnings })
      } catch (error) { if (error?.code === 'INVALID_TOOL_INPUT' || error?.code === 'MCP_RESPONSE_TOO_LARGE') throw error; throw stableToolError('SUBTITLE_TRANSFORM_FAILED', '字幕解析或转换失败，请检查格式与安全限制。') }
    },
    async analyzeApprovedFile(input) {
      const value = validateAnalyzeToolInput(input, false)
      if (!activeSubtitleGrantId) { const error = new Error('请先在插件界面选择一个字幕文件。'); error.code = 'UI_APPROVAL_REQUIRED'; throw error }
      const epoch = sessionEpoch
      const id = activeSubtitleGrantId
      try {
        const loaded = await readGrantedSubtitle(id, epoch)
        const response = boundedToolResponse(summarizeAnalysis(analyze(loaded.content, loaded.format, value.thresholds), value))
        assertSessionEpoch(epoch)
        if (activeSubtitleGrantId !== id) throw sessionExpired()
        return response
      } catch (error) {
        revokeGrant(id)
        if (error?.code === 'MCP_RESPONSE_TOO_LARGE') throw error
        throw stableToolError('APPROVED_SUBTITLE_FAILED', '已授权字幕不可用或分析失败，请在插件界面重新选择。')
      }
    }
  })
}
function registerTools(api, handlers) {
  if (!api || typeof api.registerTool !== 'function') return false
  if (registeredHosts.has(api)) return false
  let registered = 0
  for (const [name, handler] of [
    [TOOL_NAMES.analyze, (input) => handlers.analyze(input)],
    [TOOL_NAMES.transform, (input) => handlers.transform(input)],
    [TOOL_NAMES.analyzeApprovedFile, (input) => handlers.analyzeApprovedFile(input)]
  ]) {
    try { api.registerTool.call(api, name, handler); registered += 1 } catch {}
  }
  registeredHosts.add(api)
  return registered > 0
}
function registerLifecycle() {
  const api = host()
  if (typeof api.onPluginEnter === 'function') api.onPluginEnter(({ type, payload } = {}) => { if (type === 'files') void queueEntry(payload) })
  if (typeof api.onPluginOut === 'function') api.onPluginOut(clearSession)
}
registerLifecycle()
const toolHandlers = createToolHandlers()
registerTools(host(), toolHandlers)
window.subtitleWorkbench = Object.freeze({ consumeEntry, chooseInput, readGrantedSubtitle, analyze, transform, saveSubtitle, getCapabilities, startAudioExtract, audioJobStatus, pendingAudioCleanups, retryAudioCleanup, cancelAudio, startTranscription })
module.exports = Object.freeze({ TOOL_NAMES, MAX_MCP_RESPONSE_BYTES, validateAnalyzeToolInput, validateTransformToolInput, createToolHandlers, registerTools, __test: { readHandleBounded, summarizeAnalysis, promoteAudio, assertReplaceableSubtitleOutput, clearSession, activeSubtitleGrantId: () => activeSubtitleGrantId, sessionEpoch: () => sessionEpoch, audioJobCount: () => audioJobs.size, pendingAudioCleanups, setAudioPromotionIo: (value) => { audioPromotionIo = value || null }, setAudioCleanupIo: (value) => { audioCleanupIo = value || null }, setFileValidationIo: (value) => { fileValidationIo = value || null } } })
