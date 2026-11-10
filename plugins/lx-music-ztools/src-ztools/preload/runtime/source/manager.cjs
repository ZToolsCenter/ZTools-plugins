const { createHash, randomUUID } = require('node:crypto')
const { createKV } = require('../kv.cjs')
const { SourceSession } = require('./session.cjs')

const INFO_LIMITS = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 }
function parseInfo(script) {
  if (typeof script !== 'string' || script.length > 9_000_000) throw new Error('音源脚本超过 9_000_000 字符限制')
  const header = /^\/\*[\s\S]+?\*\//.exec(script)
  if (!header) throw new Error('无效的自定义源文件')
  const info = { name: '', description: '', author: '', homepage: '', version: '' }
  for (const line of header[0].split(/\r?\n/)) {
    const match = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line)
    if (!match || !Object.hasOwn(INFO_LIMITS, match[1])) continue
    info[match[1]] = match[2].trim().slice(0, INFO_LIMITS[match[1]])
  }
  info.name ||= 'LX 自定义音源'
  return info
}
/** Keep source data private and reject stale sessions when switching or removing scripts. */
function createSources({ database, network, onStatus, onAlert }) {
  const store = createKV(database, 'sources')
  let entries = store.get('entries', []), selected, session, activation, generation = 0
  let status = { status: false, message: '' }
  const list = () => entries.map(({ script, hash, ...info }) => ({ ...info }))
  const commit = next => { store.set('entries', next); entries = next }
  const publish = (next, notify = true) => { status = next; if (notify) onStatus?.(structuredClone(next)) }
  return {
    list,
    importScript(script) {
      const info = parseInfo(script)
      const hash = createHash('sha256').update(script).digest('hex')
      if (entries.some(entry => entry.hash === hash)) throw new Error('导入失败，脚本内容与已有音源相同')
      const apiInfo = { id: `user_api_${randomUUID()}`, ...info, allowShowUpdateAlert: true }
      commit([...entries, { ...apiInfo, script, hash }])
      return { apiInfo, apiList: list() }
    },
    activate(id) {
      if (selected === id && activation) return activation
      selected = id
      const current = ++generation
      activation = (async () => {
        await session?.close()
        if (current !== generation) throw new Error('source changed')
        const entry = entries.find(item => item.id === id)
        if (!entry) { session = null; publish({ status: false, message: '' }); return }
        const { script, hash, ...apiInfo } = entry
        // LX resolves its initialization promise on false+apiInfo; emit only terminal results.
        publish({ status: false, message: 'initing', apiInfo }, false)
        const next = session = new SourceSession({ info: { ...apiInfo, script }, network,
          onAlert: alert => { if (current === generation && entries.find(item => item.id === id)?.allowShowUpdateAlert) onAlert?.({ name: entry.name, ...alert }) } })
        try {
          const sources = await next.start()
          if (current !== generation) throw new Error('source changed')
          publish({ status: true, message: '', apiInfo: { ...apiInfo, sources } })
        } catch (error) {
          if (current === generation) { activation = null; publish({ status: false, message: error.message, apiInfo }) }
          throw error
        }
      })()
      return activation
    },
    getStatus: () => structuredClone(status),
    request: input => session ? session.request(input) : Promise.reject(new Error('没有可用的音源')),
    cancel: key => session?.cancel(key),
    async remove(ids) {
      commit(entries.filter(entry => !ids.includes(entry.id)))
      if (ids.includes(selected)) { ++generation; await session?.close(); session = null; activation = null; selected = null; publish({ status: false, message: '' }) }
    },
    setAllowUpdate(id, enable) { if (entries.some(item => item.id === id)) commit(entries.map(entry => entry.id === id ? { ...entry, allowShowUpdateAlert: Boolean(enable) } : entry)) },
    async dispose() { ++generation; await session?.close(); session = null },
  }
}
module.exports = { createSources, parseInfo }
