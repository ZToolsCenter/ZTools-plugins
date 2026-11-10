const backend = require('./database.cjs')
const path = require('node:path')
const namespaces = ['list', 'download', 'dislike_list', 'lyric', 'music_url', 'music_other_source']

/** Preserve the upstream list/cache contracts and invalidate memory after SQL failures. */
function createDataService(directory) {
  backend.init(directory)
  const modules = new Map()
  const file = namespace => path.join(__dirname, '../upstream/main/worker/dbService/modules', namespace, 'index.cjs')
  const invalidate = () => { for (const namespace of namespaces) delete require.cache[file(namespace)]; modules.clear() }
  invalidate()
  return {
    call(namespace, method, args = []) {
      if (!namespaces.includes(namespace)) throw new Error(`Unknown data namespace: ${namespace}`)
      let module = modules.get(namespace)
      if (!module) { module = require(file(namespace)); modules.set(namespace, module) }
      if (!Object.hasOwn(module, method) || typeof module[method] !== 'function') throw new Error(`Unknown data method: ${namespace}.${method}`)
      try { return structuredClone(module[method](...structuredClone(args))) }
      catch (error) { invalidate(); throw error }
    },
    transaction(fn) { try { return backend.getDB().transaction(fn)() } catch (error) { invalidate(); throw error } },
    getDatabase: backend.getDB,
    close() { invalidate(); backend.close() },
  }
}
module.exports = { createDataService }
