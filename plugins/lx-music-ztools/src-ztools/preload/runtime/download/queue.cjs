const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { transfer, authorize, failure, sha256, fileIdentity, sameIdentity, removeOwned } = require('./transfer.cjs')
const { createKV } = require('../kv.cjs')
function validateFileName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw failure('无效下载文件名')
  return name
}
function createQueue({ files, database, maxConcurrent = 3, retryDelay = 100, refreshTimeout = 30000, getSourceGeneration = () => null, onUpdate } = {}) {
  const tasks = new Map(), locks = new Map()
  const store = database ? createKV(database, 'downloads') : null
  const records = new Map((store?.get('tasks', []) || []).map(record => [record.info.id, record]))
  let active = 0, disposed = false
  const persist = task => {
    if (task) records.set(task.info.id, { info: task.info, directory: task.directory, target: task.target, partialPath: task.partialPath, checkpointPath: task.checkpointPath, status: task.status, phase: task.phase, fingerprint: task.fingerprint, tempOwnership: task.tempOwnership })
    store?.set('tasks', [...records.values()])
    if (task) onUpdate?.(task.info, task.status)
  }
  const emit = (task, action) => { if (!disposed && !task.controller.signal.aborted && tasks.get(task.info.id) === task) { try { task.callback(action) } catch {} } }
  const identity = info => JSON.stringify([info.id, info.metadata.quality, info.metadata.ext, info.metadata.musicInfo?.source, info.metadata.musicInfo?.meta?.toggleMusicInfo?.source])
  const published = task => ['publishing', 'raw-published', 'finalizing'].includes(task.phase)
  async function verifyPublished(task) {
    authorize(files, task.target)
    const actualIdentity = await fileIdentity(task.target)
    const target = authorize(files, task.target)
    const stat = await fs.stat(target)
    if (!task.fingerprint || !sameIdentity(actualIdentity, task.fingerprint.fileIdentity) || stat.size !== task.fingerprint.size || await sha256(target) !== task.fingerprint.sha256) throw Object.assign(failure('下载文件已被外部修改或无可靠文件身份，归属验证失败；请保留现有文件'), { fatal: true })
  }
  async function run(task) {
    try {
      task.status = 'run'; persist(task)
      emit(task, { action: 'start' })
      if (published(task)) {
        await verifyPublished(task)
        task.controller.signal.throwIfAborted()
        task.phase = 'raw-published'; task.status = 'finalizing'; persist(task)
        emit(task, { action: 'complete' })
        return
      }
      if (task.skipExisting) {
        const exists = await fs.stat(authorize(files, task.target)).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false })
        if (exists) throw Object.assign(failure('文件已存在'), { languageKey: 'download_status_error_check_path_exist', fatal: true })
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        task.controller.signal.throwIfAborted()
        let transferred = false
        try {
          const result = await transfer({ files, url: task.info.metadata.url, partialPath: task.partialPath, checkpointPath: task.checkpointPath, identity: task.identity, signal: task.controller.signal, proxy: task.proxy, onOwnership: ownership => { task.tempOwnership = ownership; persist(task) }, onProgress: progress => {
            Object.assign(task.info, progress); emit(task, { action: 'progress', data: progress })
          } })
          transferred = true
          task.controller.signal.throwIfAborted()
          task.phase = 'publishing'; task.fingerprint = { size: result.size, sha256: result.sha256, fileIdentity: result.fileIdentity }
          // Persist intent before rename, so a kill between rename and the next DB write is recoverable.
          persist(task)
          // The paths are reauthorized at publication so grants/symlinks cannot be bypassed.
          if (task.skipExisting) {
            // link is an atomic no-clobber publication on the same volume.
            await fs.link(authorize(files, task.partialPath), authorize(files, task.target))
            task.phase = 'raw-published'
            await removeOwned(files, task.partialPath, task.tempOwnership?.partial)
          } else {
            await fs.rename(authorize(files, task.partialPath), authorize(files, task.target))
            task.phase = 'raw-published'
          }
          await removeOwned(files, task.checkpointPath, task.tempOwnership?.checkpoint)
          await verifyPublished(task)
          task.status = 'finalizing'; task.phase = 'raw-published'; task.result = result
          task.info.metadata.filePath = task.target
          persist(task)
          emit(task, { action: 'complete' })
          return
        } catch (error) {
          if (transferred) {
            // A failed publication is not proof that the target belongs to this task.
            if (task.phase === 'publishing') task.phase = 'downloading'
            error.fatal = true
          }
          if (task.controller.signal.aborted || error.fatal || attempt === 3 || ['PATH_NOT_GRANTED', 'EACCES', 'EPERM', 'EEXIST'].includes(error.code)) throw error
          if (error.code === 'URL_EXPIRED' || error.code === 'ENOTFOUND') {
            await new Promise((resolve, reject) => {
              const finish = error => { clearTimeout(timer); task.controller.signal.removeEventListener('abort', abort); task.refresh = null; error ? reject(error) : resolve() }
              const abort = () => finish(task.controller.signal.reason || failure('已暂停'))
              const timer = setTimeout(() => finish(failure('下载地址刷新超时')), refreshTimeout)
              task.refresh = { finish, sourceGeneration: getSourceGeneration() }
              task.controller.signal.addEventListener('abort', abort, { once: true })
              emit(task, { action: 'refreshUrl' })
            })
          } else {
            emit(task, { action: 'statusText', data: 'download_status_error_retrying' })
            await new Promise((resolve, reject) => {
              const abort = () => { clearTimeout(timer); reject(task.controller.signal.reason) }
              const timer = setTimeout(() => { task.controller.signal.removeEventListener('abort', abort); resolve() }, retryDelay * attempt)
              task.controller.signal.addEventListener('abort', abort, { once: true })
            })
          }
        }
      }
    } catch (error) {
      if (!task.controller.signal.aborted) { task.status = 'error'; persist(task); emit(task, { action: 'error', data: { ...(error.languageKey ? { error: error.languageKey } : {}), message: error.message } }) }
    } finally {
      active--
      if (task.status !== 'finalizing') locks.delete(task.target.toLowerCase())
      pump()
    }
  }
  function pump() {
    if (disposed) return
    const limit = Math.max(1, Number(typeof maxConcurrent === 'function' ? maxConcurrent() : maxConcurrent) || 3)
    for (const task of tasks.values()) {
      if (active >= limit) break
      if (task.status !== 'waiting' || task.controller.signal.aborted) continue
      const lock = task.target.toLowerCase()
      if (locks.has(lock) && locks.get(lock) !== task.info.id) continue
      locks.set(lock, task.info.id); active++
      task.promise = run(task)
    }
  }
  async function pause(id, reopenFinalized = false) {
    const task = tasks.get(id)
    if (!task) return
    task.controller.abort(failure('下载已暂停', 'ABORT_ERR'))
    await task.promise
    if (reopenFinalized && task.phase === 'finalized') {
      // The renderer may still be committing its completed SQL row after this ACK.
      task.phase = 'raw-published'; task.info.isComplate = false; task.info.status = 'pause'
    }
    task.status = task.phase === 'finalized' ? 'completed' : 'pause'; persist(task)
    tasks.delete(id)
  }
  async function start(info, directory, skipExisting, callback, proxy) {
    if (disposed) throw failure('下载服务已关闭')
    if (!info || typeof info.id !== 'string' || typeof callback !== 'function') throw failure('无效下载任务')
    validateFileName(info.metadata?.fileName)
    directory = authorize(files, directory)
    await fs.mkdir(authorize(files, directory), { recursive: true })
    await pause(info.id)
    const suffix = createHash('sha256').update(info.id).digest('hex').slice(0, 24)
    const targetCandidate = path.join(directory, info.metadata.fileName)
    const partialCandidate = path.join(directory, `.lx-download-${suffix}.part`)
    for (const candidate of [targetCandidate, partialCandidate, partialCandidate + '.json']) {
      const leaf = await fs.lstat(candidate).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
      if (leaf && !leaf.isFile()) throw failure('下载文件路径 ownership 冲突：不能认领链接或目录')
    }
    const target = authorize(files, targetCandidate)
    const partialPath = authorize(files, partialCandidate)
    const checkpointPath = authorize(files, partialCandidate + '.json')
    const previous = records.get(info.id)
    let tempOwnership
    const existingPartial = await fs.stat(partialPath).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false })
    const existingCheckpoint = await fs.stat(checkpointPath).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false })
    if (existingPartial || existingCheckpoint) {
      let owned
      try {
        const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'))
        const partial = existingPartial ? await fileIdentity(partialPath) : null
        const checkpointFile = await fileIdentity(checkpointPath)
        owned = checkpoint.version === 1 && checkpoint.identity === identity(info) && checkpointFile && (existingPartial ? sameIdentity(partial, checkpoint.fileIdentity) : sameIdentity(checkpointFile, previous?.tempOwnership?.checkpoint))
        if (owned) tempOwnership = { partial, checkpoint: checkpointFile }
      } catch {}
      if (!owned) throw failure('下载临时文件 ownership 冲突，请保留原文件并修改文件名')
    }
    // The bridge is a same-context call, so Vue proxies can still be present here.
    // Download records are JSON data by contract; serialize them before retaining state.
    const recovery = previous?.target === target && published(previous) ? { phase: previous.phase, fingerprint: previous.fingerprint } : { phase: 'downloading' }
    const task = { info: JSON.parse(JSON.stringify(info)), identity: identity(info), directory, target, partialPath, checkpointPath, tempOwnership, skipExisting, callback, proxy, status: 'waiting', controller: new AbortController(), sourceGeneration: getSourceGeneration(), ...recovery }
    task.info.metadata.filePath = target
    tasks.set(info.id, task); persist(task); pump()
  }
  async function cleanOwnedTemps(task) {
    if (task) {
      // Never follow persisted caller-selected paths: derive ownership from task id + directory.
      const suffix = createHash('sha256').update(task.info.id).digest('hex').slice(0, 24)
      const own = path.join(authorize(files, task.directory), `.lx-download-${suffix}.part`)
      await removeOwned(files, own, task.tempOwnership?.partial)
      await removeOwned(files, own + '.json', task.tempOwnership?.checkpoint)
    }
  }
  async function cancel(id) {
    const task = tasks.get(id) || records.get(id)
    await pause(id)
    await cleanOwnedTemps(task)
    if (task?.target && locks.get(task.target.toLowerCase()) === id) locks.delete(task.target.toLowerCase())
    records.delete(id); persist(); pump()
  }
  async function updateUrl(id, url) {
    const task = tasks.get(id)
    if (!task?.refresh || task.controller.signal.aborted || task.refresh.sourceGeneration !== getSourceGeneration()) throw failure('下载地址更新会话已失效 (stale)')
    const address = new URL(url)
    if (!['http:', 'https:'].includes(address.protocol)) throw failure('无效下载地址')
    task.info.metadata.url = address.href
    task.sourceGeneration = getSourceGeneration()
    task.refresh.finish()
  }
  async function finalize(id, error) {
    const task = tasks.get(id)
    const assertCurrent = () => {
      const awaitingFinalization = task && task.status === 'finalizing' && published(task)
      const revertingFailedUICommit = task && error && task.status === 'completed' && task.phase === 'finalized'
      if (!task || tasks.get(id) !== task || task.controller.signal.aborted || !awaitingFinalization && !revertingFailedUICommit) throw failure('下载最终化阶段已暂停、替换或失效')
    }
    assertCurrent()
    await verifyPublished(task)
    assertCurrent()
    if (!error) await cleanOwnedTemps(task)
    assertCurrent()
    task.phase = error ? 'raw-published' : 'finalized'
    task.status = error ? 'error' : 'completed'
    task.info.status = task.status; task.info.isComplate = !error
    if (error) task.info.statusText = typeof error === 'string' ? error : error.message || '下载最终化失败'
    persist(task)
    if (locks.get(task.target.toLowerCase()) === id) locks.delete(task.target.toLowerCase())
    pump()
  }
  async function beforeMutation(target) {
    target = authorize(files, target)
    const id = locks.get(target.toLowerCase())
    const task = id && (tasks.get(id) || records.get(id))
    if (!task || !published(task)) return null
    if (task.controller?.signal.aborted || task.status !== 'finalizing') throw failure('下载任务已暂停或已失效')
    await verifyPublished(task)
    if (tasks.get(id) !== task || task.controller?.signal.aborted || task.status !== 'finalizing') throw failure('下载标签阶段已暂停、替换或失效')
    task.phase = 'finalizing'; persist(task)
    return { id, task }
  }
  async function afterMutation(token, publishedIdentity) {
    if (!token) return
    const task = tasks.get(token.id) || records.get(token.id)
    if (task !== token.task && tasks.has(token.id)) throw failure('标签写入任务已替换')
    if (!task) return
    if (!publishedIdentity) {
      // WAV/APE intentionally have no tag writer, so their original fingerprint must stay exact.
      await verifyPublished(task)
      task.phase = 'raw-published'; persist(task)
      return
    }
    const target = authorize(files, task.target)
    if (!sameIdentity(publishedIdentity, await fileIdentity(task.target))) throw failure('标签发布后文件归属已变化，请保留现有文件', 'DOWNLOAD_OWNERSHIP')
    const stat = await fs.stat(target)
    task.fingerprint = { size: stat.size, sha256: await sha256(target), fileIdentity: publishedIdentity }
    task.phase = 'raw-published'; persist(task)
  }
  return { start, pause, cancel, updateUrl, finalize, beforeMutation, afterMutation,
    getTarget(id) { return (tasks.get(id) || records.get(id))?.target },
    releaseLock(id) { const target = (tasks.get(id) || records.get(id))?.target; if (target && locks.get(target.toLowerCase()) === id) locks.delete(target.toLowerCase()); pump() },
    async retry(id) { const record = records.get(id); if (!record) throw failure('未知下载任务'); await start(record.info, record.directory, false, () => {}) },
    async restore() {
      for (const record of records.values()) {
        if (record.phase === 'finalized' || record.status === 'completed' && !published(record)) continue
        try {
          const directory = authorize(files, record.directory)
          validateFileName(record.info.metadata.fileName)
          authorize(files, path.join(directory, record.info.metadata.fileName))
          if (published(record)) {
            try { await verifyPublished(record) }
            catch (error) {
              if (record.phase === 'publishing' && error.code === 'ENOENT') record.phase = 'downloading'
              else throw error
            }
            if (published(record)) locks.set(record.target.toLowerCase(), record.info.id)
          }
          record.status = 'pause'; record.info.status = 'pause'; record.info.isComplate = false
        } catch (error) { record.status = 'error'; record.info.status = 'error'; record.info.statusText = error.message }
        onUpdate?.(record.info, record.status)
      }
      persist()
      return [...records.values()].map(record => ({ ...record.info, status: record.status }))
    },
    async dispose() { disposed = true; await Promise.all([...tasks.keys()].map(pause)) },
  }
}
module.exports = { createQueue, validateFileName }
