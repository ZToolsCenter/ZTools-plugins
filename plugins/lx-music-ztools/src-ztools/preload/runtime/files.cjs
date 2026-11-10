const fs = require('node:fs')
const path = require('node:path')
const { createKV } = require('./kv.cjs')

/** Resolve existing ancestors so path traversal and symlinks cannot escape a grant. */
function canonical(target) {
  let current = path.resolve(target)
  const suffix = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) throw new Error('Cannot resolve file path')
    suffix.unshift(path.basename(current)); current = parent
  }
  return path.join(fs.realpathSync.native(current), ...suffix)
}
function createFileScope(roots, grants = [], onChange) {
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
  const entries = [...roots.map(value => ({ path: canonical(value), directory: true })), ...grants]
  return {
    grant(target, directory = false) {
      const value = { path: canonical(target), directory }
      if (!entries.some(entry => normalize(entry.path) === normalize(value.path) && entry.directory === directory)) { entries.push(value); onChange?.(entries.slice(roots.length)) }
    },
    authorize(target) {
      if (typeof target !== 'string' || !target || target.includes('\0')) throw new TypeError('无效文件路径')
      const value = canonical(target), key = normalize(value)
      if (!entries.some(entry => key === normalize(entry.path) || entry.directory && key.startsWith(normalize(entry.path.endsWith(path.sep) ? entry.path : entry.path + path.sep)))) throw Object.assign(new Error('尚未授权此文件或目录，请重新选择'), { code: 'PATH_NOT_GRANTED' })
      return value
    },
  }
}
function createFileService(database, directory) {
  const store = createKV(database, 'files')
  const scope = createFileScope([directory], store.get('grants', []), grants => store.set('grants', grants))
  const helpers = require('../upstream/common/utils/nodejs.cjs')
  const paths = new Set(['checkPath', 'checkAndCreateDir', 'getFileStats', 'createDir', 'removeFile', 'readFile', 'saveLxConfigFile', 'readLxConfigFile', 'saveStrToFile', 'copyFile', 'moveFile'])
  const pure = new Set(['gzipData', 'gunzipData'])
  return {
    scope,
    async call(method, args) {
      if (!paths.has(method) && !pure.has(method)) throw new Error(`Unknown file operation: ${method}`)
      const values = [...args]
      if (paths.has(method)) {
        try { values[0] = scope.authorize(values[0]) }
        catch (error) { if (method === 'checkPath') return false; throw error }
        if (method === 'copyFile' || method === 'moveFile') values[1] = scope.authorize(values[1])
      }
      if (method === 'readFile' && /\.js$/i.test(values[0]) && (await fs.promises.stat(values[0])).size > 32 * 1024 * 1024) throw new Error('音源脚本文件过大')
      if (method === 'saveLxConfigFile') {
        const target = values[0].endsWith('.lxmc') ? values[0] : values[0] + '.lxmc'
        const content = await helpers.gzipData(JSON.stringify(values[1]))
        await fs.promises.writeFile(target, content)
        return
      }
      const result = await helpers[method](...values)
      if (method === 'getFileStats' && result) return { size: result.size, mtimeMs: result.mtimeMs, ctimeMs: result.ctimeMs, mtime: result.mtime, ctime: result.ctime, isFile: result.isFile(), isDirectory: result.isDirectory() }
      return result
    },
  }
}
module.exports = { createFileScope, createFileService }
