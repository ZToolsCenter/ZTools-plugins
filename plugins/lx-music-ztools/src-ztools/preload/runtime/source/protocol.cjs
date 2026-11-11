const SOURCE_IDS = ['kw', 'kg', 'tx', 'wy', 'mg', 'local']
const QUALITYS = ['128k', '320k', 'flac', 'flac24bit']
// Structured clone does not preserve Buffer identity. Describe only existing
// in-memory Buffer locations; typed arrays and user field names stay untouched.
function collectRequestBuffers(options, isBuffer) {
  const paths = [], seen = new WeakSet()
  const visit = (value, path) => {
    if (isBuffer(value)) { paths.push(path); return }
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || seen.has(value)) return
    seen.add(value)
    for (const key of Object.keys(value)) visit(value[key], [...path, key])
  }
  for (const key of ['body', 'form', 'formData']) visit(options[key], [key])
  return paths
}
function normalizeSources(input) {
  if (!input || typeof input !== 'object') throw new Error('Missing required parameter init info')
  const result = {}
  for (const source of SOURCE_IDS) {
    const info = input[source]
    if (!info || info.type !== 'music') continue
    if (!Array.isArray(info.actions) || !Array.isArray(info.qualitys)) throw new Error('音源能力格式错误')
    result[source] = { type: 'music', actions: (source === 'local' ? ['musicUrl', 'lyric', 'pic'] : ['musicUrl']).filter(action => info.actions.includes(action)),
      qualitys: (source === 'local' ? [] : QUALITYS).filter(quality => info.qualitys.includes(quality)) }
  }
  return result
}
function validateRequest(sources, data) {
  const source = sources?.[data?.source]
  if (!source?.actions.includes(data?.action)) throw new Error('音源不支持此操作')
  if (data.action === 'musicUrl' && data.source !== 'local' && !source.qualitys.includes(data.info?.type)) throw new Error('不支持的音质 quality')
}
function validateURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:/.test(value)) throw new Error('音源返回无效 URL')
  if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error('音源返回无效 URL')
  return value
}
function normalizeResult(input, response) {
  let data
  if (input.action === 'musicUrl') data = { type: input.info.type, url: validateURL(response) }
  else if (input.action === 'pic') data = validateURL(response)
  else if (input.action === 'lyric') {
    if (!response || typeof response.lyric !== 'string' || response.lyric.length > 51200) throw new Error('音源歌词格式错误')
    data = { lyric: response.lyric }
    for (const [key, limit] of [['tlyric', 5120], ['rlyric', 5120], ['lxlyric', 8192]]) data[key] = typeof response[key] === 'string' && response[key].length < limit ? response[key] : null
  } else throw new Error('音源返回未知操作')
  return { source: input.source, action: input.action, data }
}
module.exports = { normalizeSources, validateRequest, normalizeResult, validateURL, collectRequestBuffers }
