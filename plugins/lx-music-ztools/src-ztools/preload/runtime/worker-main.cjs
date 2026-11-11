const common = require('../upstream/renderer/worker/main/common.cjs')
const list = require('../upstream/renderer/worker/main/list.cjs')
const music = require('../upstream/renderer/worker/main/music.cjs')
const methods = { ...common, ...list, ...music }
const { exportLists } = require('./export-lists.cjs')

/** Run original main-Worker business methods with native file operations scoped. */
function callMainWorker(files, method, args) {
  if (!Object.hasOwn(methods, method) || typeof methods[method] !== 'function') throw new Error(`Unknown main worker method: ${method}`)
  const values = [...args]
  if (method === 'exportPlayListToText' || method === 'exportPlayListToCSV') return exportLists(files, values[0], values[1], method === 'exportPlayListToText' ? 'txt' : 'csv', values[2], values[3])
  if (['getMusicFilePic', 'getMusicFileLyric', 'exportPlayListToText', 'exportPlayListToCSV', 'saveLxConfigFile', 'readLxConfigFile', 'saveStrToFile'].includes(method)) values[0] = files.scope.authorize(values[0])
  if (method === 'createLocalMusicInfos') values[0] = values[0].map(file => files.scope.authorize(file))
  if (['saveLxConfigFile', 'readLxConfigFile', 'saveStrToFile'].includes(method)) return files.call(method, values)
  return methods[method](...values)
}
module.exports = { callMainWorker }
