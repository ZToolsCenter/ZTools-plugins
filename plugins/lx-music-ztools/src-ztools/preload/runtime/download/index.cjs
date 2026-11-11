const { createQueue } = require('./queue.cjs')
const { createDownloadInfo } = require('../../upstream/renderer/worker/download/utils.cjs')
const metadata = require('./metadata.cjs')
function createDownloadService(options) {
  const queue = createQueue(options)
  let closed = false, disposal
  const metadataOperations = new Map()
  function track(target, operation) {
    let operations = metadataOperations.get(target)
    if (!operations) metadataOperations.set(target, operations = new Set())
    operations.add(operation)
    operation.finally(() => { operations.delete(operation); if (!operations.size) metadataOperations.delete(target) }).catch(() => {})
    return operation
  }
  async function drainTarget(target) {
    // Track through fingerprint persistence, not merely the worker's file rename.
    await Promise.allSettled([...(metadataOperations.get(target) || [])])
    await metadata.drainTarget(target)
  }
  const methods = {
    checkList: (list, musicInfo, quality, ext) => list.some(item => item.id === musicInfo.id && (item.metadata.quality === quality || item.metadata.ext === ext)),
    createDownloadTasks: (list, quality, format, qualityList, listId) => {
      return JSON.parse(JSON.stringify(list)).map(info => createDownloadInfo(info, quality, format, qualityList, listId))
    },
    startTask: (...args) => queue.start(...args),
    updateUrl: (...args) => queue.updateUrl(...args),
    pauseTask: async id => {
      const target = queue.getTarget(id)
      await queue.pause(id, true)
      if (target) await drainTarget(target)
      queue.releaseLock(id)
    },
    removeTask: async id => {
      const target = queue.getTarget(id)
      await queue.pause(id)
      if (target) await drainTarget(target)
      await queue.cancel(id)
    },
    finalizeTask: (id, error) => queue.finalize(id, error),
    writeMeta: (...args) => {
      const target = options.files.scope.authorize(args[0].filePath)
      return track(target, (async () => {
        const token = await queue.beforeMutation(target)
        const result = await metadata.writeMeta(options.files, args[0], args[1], args[2], options.runWriter)
        await queue.afterMutation(token, result?.fileIdentity)
        return result
      })())
    },
    saveLrc: (...args) => metadata.saveLrc(options.files, ...args),
  }
  return { async call(method, args = []) {
    if (closed) throw new Error('下载服务已关闭')
    if (!Object.hasOwn(methods, method)) throw new Error(`Unknown download operation: ${method}`)
    return methods[method](...args)
  }, restore: () => queue.restore(), dispose() {
    closed = true
    return disposal ||= (async () => {
      await queue.dispose()
      await Promise.allSettled([...metadataOperations.values()].flatMap(operations => [...operations]))
      await metadata.drain()
    })()
  } }
}
module.exports = { createDownloadService }
