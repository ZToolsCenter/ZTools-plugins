// Keep vendor immutable; adapt only the original download finalization/lifecycle boundaries.
function adaptDownloadAction(source) {
  source = source.replace(/\r\n/g, '\n')
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('LX download contract changed: ' + before.slice(0, 70))
    source = source.replace(before, after)
  }
  replace('  downloadTasksUpdate,', '  downloadTasksUpdate as persistDownloadTasks,')
  replace('const waitingUpdateTasks =', `// Serialize already issued SQL writes per task so pause/remove can form a durable barrier.
const downloadWrites = new Map<string, Promise<void>>()
const downloadTasksUpdate = async(list: LX.Download.ListItem[]) => {
  const snapshots = list.map(info => JSON.parse(JSON.stringify(toRaw(info))))
  if (!snapshots.length) return
  const pending = [...new Set(list.map(info => downloadWrites.get(info.id)).filter((previous): previous is Promise<void> => !!previous))]
  const writing = Promise.all(pending.map(previous => previous.catch(() => {})))
    .then(() => persistDownloadTasks(snapshots))
  for (const info of list) downloadWrites.set(info.id, writing)
  void writing.finally(() => {
    for (const info of list) if (downloadWrites.get(info.id) === writing) downloadWrites.delete(info.id)
  }).catch(() => {})
  await writing
}
const waitingUpdateTasks =`)
  replace('    void downloadTasksUpdate(Array.from(waitingUpdateTasks.values()))', '    void downloadTasksUpdate(Array.from(waitingUpdateTasks.values())).catch(console.error)')
  replace('const saveMeta = (downloadInfo: LX.Download.ListItem) => {', 'const saveMeta = (downloadInfo: LX.Download.ListItem, isCurrent: () => boolean) => {')
  replace('const downloadLyric = (downloadInfo: LX.Download.ListItem) => {', 'const downloadLyric = (downloadInfo: LX.Download.ListItem, isCurrent: () => boolean) => {')
  replace('  void Promise.all(tasks).then(([imgUrl, lyrics]) => {', '  return Promise.all(tasks).then(([imgUrl, lyrics]) => {')
  replace('    void window.lx.worker.download.writeMeta(', '    if (!isCurrent()) return\n    return window.lx.worker.download.writeMeta(')
  replace('  void getLyricInfo({', '  return getLyricInfo({')
  replace('      void window.lx.worker.download.saveLrc(lrcs, info)', '      if (!isCurrent()) return\n      return window.lx.worker.download.saveLrc(lrcs, info)')
  replace('proxyCallback((event: LX.Download.DownloadTaskActions)', 'proxyCallback(async(event: LX.Download.DownloadTaskActions)')
  replace('const runingTask = new Map<string, LX.Download.ListItem>()', `const runingTask = new Map<string, LX.Download.ListItem>()
const downloadEpochs = new Map<string, number>()
// Only ACK/SQL/backend cleanup belongs here, never remote picture/lyric resolution.
const downloadCommits = new Map<string, Promise<void>>()
const stoppingDownloads = new Map<string, number>()
const beginDownloadStop = (id: string) => stoppingDownloads.set(id, (stoppingDownloads.get(id) || 0) + 1)
const endDownloadStop = (id: string) => {
  const count = (stoppingDownloads.get(id) || 1) - 1
  if (count) stoppingDownloads.set(id, count)
  else stoppingDownloads.delete(id)
}`)
  replace('const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {', `const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {
  const epoch = downloadEpochs.get(downloadInfo.id)
  const isCurrent = () => downloadEpochs.get(downloadInfo.id) === epoch && downloadList.includes(downloadInfo)`)
  replace('    const url = await getUrl(downloadInfo)\n    if (!url)', '    const url = await getUrl(downloadInfo)\n    if (!isCurrent()) return\n    if (!url)')
  replace('    if (downloadInfo.status != DOWNLOAD_STATUS.RUN) return', '    if (!isCurrent() || downloadInfo.status != DOWNLOAD_STATUS.RUN) return')
  replace('    setUrl(downloadInfo, url)\n    if (!isCurrent()', '    if (!isCurrent()) return\n    setUrl(downloadInfo, url)\n    if (!isCurrent()')
  replace('const handleRefreshUrl = (downloadInfo: LX.Download.ListItem) => {', 'const handleRefreshUrl = (downloadInfo: LX.Download.ListItem, isCurrent: () => boolean) => {')
  replace('      setUrl(downloadInfo, url)', '      if (!isCurrent()) return\n      setUrl(downloadInfo, url)')
  replace('      console.log(err)\n      handleError(downloadInfo, err.message)', '      if (!isCurrent()) return\n      console.log(err)\n      handleError(downloadInfo, err.message)')
  replace('        handleRefreshUrl(downloadInfo)', '        handleRefreshUrl(downloadInfo, isCurrent)')
  replace('      void window.lx.worker.download.updateUrl(downloadInfo.id, url)', '      return window.lx.worker.download.updateUrl(downloadInfo.id, url)')
  replace(`const handleError = (downloadInfo: LX.Download.ListItem, message?: string) => {
  setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, message)
  void window.lx.worker.download.removeTask(downloadInfo.id)
  runingTask.delete(downloadInfo.id)
  void checkStartTask()
}`, `const handleError = async(downloadInfo: LX.Download.ListItem, message?: string) => {
  const id = downloadInfo.id
  beginDownloadStop(id)
  setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, message)
  runingTask.delete(id)
  void checkStartTask()
  try { await window.lx.worker.download.removeTask(id) }
  catch (error) { console.error(error) }
  finally { endDownloadStop(id); void checkStartTask() }
}`)
  replace('const startTask = async(downloadInfo: LX.Download.ListItem) => {', `const startTask = async(downloadInfo: LX.Download.ListItem) => {
  if (stoppingDownloads.has(downloadInfo.id)) return
  downloadEpochs.set(downloadInfo.id, (downloadEpochs.get(downloadInfo.id) || 0) + 1)`)
  replace('  void handleStartTask(downloadInfo)', `  const epoch = downloadEpochs.get(downloadInfo.id)
  void handleStartTask(downloadInfo).catch(error => {
    if (downloadEpochs.get(downloadInfo.id) !== epoch || !downloadList.includes(downloadInfo)) return
    return handleError(downloadInfo, error?.message || String(error))
  })`)
  replace('  const waitList = list.filter(item => {', '  const waitList = list.filter(item => {\n    if (stoppingDownloads.has(item.id)) return false')
  replace('    switch (event.action) {', '    if (!isCurrent()) return\n    switch (event.action) {')
  const start = source.indexOf("      case 'complete':")
  const end = source.indexOf("      case 'refreshUrl':", start)
  if (start < 0 || end < 0) throw new Error('LX download completion contract changed')
  source = source.slice(0, start) + `      case 'complete':
        if (!isCurrent()) break
        try {
          downloadInfo.progress = 99.99
          setStatusText(downloadInfo, '正在写入标签与歌词')
          await saveMeta(downloadInfo, isCurrent)
          if (!isCurrent()) break
          await downloadLyric(downloadInfo, isCurrent)
          if (!isCurrent()) break
          const committing = (async () => {
            if (!isCurrent()) return
            await window.lx.worker.download.finalizeTask(downloadInfo.id)
            if (!isCurrent()) return
            const completed = { ...toRaw(downloadInfo), progress: 100, isComplate: true,
              status: DOWNLOAD_STATUS.COMPLETED, statusText: window.i18n.t('download___status_completed') }
            await downloadTasksUpdate([completed])
            if (!isCurrent()) return
            Object.assign(downloadInfo, completed)
            if (!isCurrent()) return
            await window.lx.worker.download.removeTask(downloadInfo.id).catch(console.error)
          })()
          downloadCommits.set(downloadInfo.id, committing)
          try { await committing }
          finally { if (downloadCommits.get(downloadInfo.id) === committing) downloadCommits.delete(downloadInfo.id) }
        } catch (error) {
          if (!isCurrent()) break
          await window.lx.worker.download.finalizeTask(downloadInfo.id, String(error.message || error)).catch(console.error)
          if (!isCurrent()) break
          downloadInfo.isComplate = false
          setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, String(error.message || error))
        } finally {
          if (isCurrent()) {
            runingTask.delete(downloadInfo.id)
            void checkStartTask()
          }
        }
        break
` + source.slice(end)
  const pauseStart = source.indexOf('export const pauseDownloadTasks = async(')
  const pauseEnd = source.indexOf('/**', pauseStart)
  if (pauseStart < 0 || pauseEnd < 0) throw new Error('LX download pause contract changed')
  source = source.slice(0, pauseStart) + `export const pauseDownloadTasks = async(list: LX.Download.ListItem[]) => {
  const stopping = list.filter(info => info.status === DOWNLOAD_STATUS.RUN || info.status === DOWNLOAD_STATUS.WAITING || info.status === DOWNLOAD_STATUS.ERROR).map(downloadInfo => {
    const id = downloadInfo.id
    beginDownloadStop(id)
    const epoch = (downloadEpochs.get(id) || 0) + 1
    downloadEpochs.set(id, epoch)
    return { downloadInfo, id, epoch }
  })
  await Promise.all(stopping.map(async({ downloadInfo, id, epoch }) => {
    try {
      await window.lx.worker.download.pauseTask(id)
      await downloadCommits.get(id)?.catch(console.error)
      await downloadWrites.get(id)?.catch(console.error)
      if (downloadEpochs.get(id) !== epoch || !downloadList.includes(downloadInfo)) return
      runingTask.delete(id)
      downloadInfo.isComplate = false
      setStatus(downloadInfo, DOWNLOAD_STATUS.PAUSE)
      waitingUpdateTasks.delete(id)
      // A previously issued completed SQL write must settle before this final pause write.
      await downloadTasksUpdate([downloadInfo])
    } finally { endDownloadStop(id) }
  }))
  void checkStartTask()
}

` + source.slice(pauseEnd)
  replace('  await downloadTasksRemove(ids)\n\n  const idsSet', '  const idsSet')
  const filter = source.indexOf('  const newList = downloadList.filter(task => {')
  const splice = source.indexOf('  downloadList.splice', filter)
  if (filter < 0 || splice < 0) throw new Error('LX download remove contract changed')
  source = source.slice(0, filter) + `  for (const id of idsSet) downloadEpochs.set(id, (downloadEpochs.get(id) || 0) + 1)
  for (const id of idsSet) beginDownloadStop(id)
  try {
    await Promise.all([...idsSet].map(id => window.lx.worker.download.removeTask(id)))
    await Promise.all([...idsSet].map(id => downloadCommits.get(id)?.catch(console.error)))
    await Promise.all([...idsSet].map(id => downloadWrites.get(id)?.catch(console.error)))
    for (const id of idsSet) waitingUpdateTasks.delete(id)
    await downloadTasksRemove([...idsSet])
    for (const id of idsSet) runingTask.delete(id)
  } finally { for (const id of idsSet) endDownloadStop(id) }
  const newList = downloadList.filter(task => !idsSet.has(task.id))
` + source.slice(splice)
  return source
}
module.exports = adaptDownloadAction
