const path = require('node:path')
const iconv = require('iconv-lite')
const { filterFileName } = require('../upstream/common/utils/common.cjs')
async function exportLists(files, savePath, lists, format, merge = true, header = '歌曲名,歌手,专辑\n') {
  if (!['txt', 'csv'].includes(format)) throw new Error('不支持的导出格式')
  const quote = value => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text }
  const lines = list => list.list.map(music => format === 'txt' ? `${music.name}  ${music.singer}  ${music.meta.albumName ?? ''}`
    : [music.name, music.singer, music.meta.albumName].map(quote).join(',')).join('\n')
  const write = (file, text) => files.call('saveStrToFile', [file, iconv.encode(text, 'utf8', { addBOM: true }), format])
  files.scope.authorize(savePath)
  if (merge) await write(savePath, (format === 'csv' ? header : '') + lists.map(lines).join(format === 'csv' ? '\n' : '\n\n'))
  else for (const list of lists) await write(path.join(savePath, `lx_list_${filterFileName(list.name)}.${format}`), (format === 'csv' ? header : '') + lines(list))
}
module.exports = { exportLists }
