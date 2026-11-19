const path = require('node:path')
const { execFile } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const categories = require('./categories.cjs')
const { applyFilters, resolveDirectories } = require('./filters.cjs')
const { escapeRegex, PAGE_SIZES, SEARCH_WINDOW } = require('./search.cjs')
const { checkAbort, aborted } = require('./latest.cjs')

const literal = value => escapeRegex(value).replace(/&/g, '\\x26').replace(/"/g, '\\x22')
function sizeTerm(value) {
  // Everything 1.4 对带单位的范围及 >= / <= 解释不一致。统一使用整数字节。
  const bytes = text => {
    const [, number, unit = 'b'] = /^([\d.]+)(b|kb|mb|gb|tb)?$/i.exec(text)
    const result = Number(number) * 1024 ** ['b', 'kb', 'mb', 'gb', 'tb'].indexOf(unit.toLowerCase())
    if (!Number.isFinite(result) || result >= Number.MAX_SAFE_INTEGER) throw new Error('文件大小超出可检索范围')
    return result
  }
  if (value.includes('..')) {
    const [min, max] = value.split('..').map(bytes)
    const low = Math.ceil(min), high = Math.floor(max)
    return low <= high ? `size:"${low}..${high}"` : null
  }
  const [, op, text] = /^([<>]=?)?(.*)$/.exec(value)
  const size = bytes(text)
  if (op === '>=') return size === 0 ? 'file:' : `size:">${Math.ceil(size) - 1}"`
  if (op === '>') return `size:">${Math.floor(size)}"`
  if (op === '<=') return `size:"<${Math.floor(size) + 1}"`
  if (op === '<') return `size:"<${Math.ceil(size)}"`
  return Number.isInteger(size) ? `size:${size}` : null
}
function directoryTerm(value, exclude = false) {
  const directory = path.win32.normalize(value).replace(/\\+$/, '')
  return `path:nocase:regex:"^${literal(directory)}${exclude ? '(?:\\\\|$)' : '\\\\'}"`
}

function compile(options, limit) {
  const { query, field = 'name', mode = 'literal', category = 'all', caseSensitive = false, pageSize = 50, offset = 0 } = options
  if (typeof query !== 'string' || /[\x00-\x1f]/.test(query) || query.length > 1024) throw new Error('请输入不超过 1024 字的单行关键词')
  if (!['name', 'path'].includes(field) || !['literal', 'fuzzy', 'regex'].includes(mode) || options.file || options.git || options.boost) throw new Error('此搜索条件在 Everything 中不可用')
  if (typeof caseSensitive !== 'boolean' || !PAGE_SIZES.includes(pageSize) || !Number.isSafeInteger(offset) || offset < 0 || offset >= SEARCH_WINDOW) throw new Error('无效的搜索或分页设置')
  const categoryInfo = categories.find(item => item.id === category)
  if (!categoryInfo) throw new Error('未知的文件分类')
  const filter = { q: '', kind: categoryInfo.kind }
  if (!applyFilters(filter, { ...options, exclude: '' }, categoryInfo, false)) return null

  // Everything 也可索引含相对路径的 EFU 文件列表；它们不能直接打开。
  const terms = ['path:nocase:regex:"^(?:[a-z]:\\\\|\\\\\\\\)"']
  const recent = !query.trim() && !options.browse
  if (filter.kind === 'file' || (recent && filter.kind !== 'dir')) terms.push('file:')
  if (filter.kind === 'dir') terms.push('folder:')
  if (filter.ext) terms.push('ext:' + filter.ext.split(',').join(';'))
  if (filter.size) {
    const term = sizeTerm(filter.size)
    if (!term) return null
    terms.push('file:', term)
  }
  if (filter.mtime === '>1y') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 365)
    const date = [cutoff.getFullYear(), cutoff.getMonth() + 1, cutoff.getDate()].map(n => String(n).padStart(2, '0')).join('-')
    terms.push(`dm:"<${date}"`)
  } else if (filter.mtime) terms.push(`dm:past${Number(filter.mtime.slice(1, -1)) * 24}hours`)
  if (filter.in) terms.push(directoryTerm(filter.in))
  for (const dir of (options.exclude || '').split('\n').map(value => value.trim()).filter(Boolean)) terms.push('!' + directoryTerm(dir, true))
  if (query.trim()) {
    let expression = mode === 'regex' ? query : literal(query.trim())
    if (mode === 'fuzzy') expression = Array.from(query.trim()).filter(character => !/\s/u.test(character)).map(literal).join('.*')
    if (mode === 'regex') {
      // 避免引号关闭 Everything 搜索项；用正则转义写法表示双引号。
      if (query.includes('"')) throw new Error('正则中的双引号请写作 \\x22')
      try { new RegExp(query) } catch (error) { throw new Error('正则表达式无效：' + error.message) }
    }
    terms.push(`${field === 'path' ? 'path:' : ''}${caseSensitive ? 'case' : 'nocase'}:regex:"${expression}"`)
  }
  const sort = recent ? 'date-modified-descending' : 'path-ascending'
  const search = terms.join(' ')
  return { search, sort, recent, offset, limit: Math.min(limit || pageSize, SEARCH_WINDOW - offset) }
}

function parseResults(stdout) {
  const json = stdout.replace(/^\uFEFF/, '').trim()
  if (!json) return []
  let rows
  try { rows = JSON.parse(json) } catch { throw new Error('Everything 返回的结果格式无效') }
  if (!Array.isArray(rows)) throw new Error('Everything 返回的结果格式无效')
  return rows.map(row => {
    if (!row || typeof row.filename !== 'string' || !path.win32.isAbsolute(row.filename) || !Number.isInteger(row.attributes)) throw new Error('Everything 返回的文件信息无效')
    const kind = row.attributes & 16 ? 'dir' : 'file'
    const target = path.win32.normalize(row.filename)
    return { path: target === path.win32.parse(target).root ? target : target.replace(/\\$/, ''), kind,
      size: kind === 'file' && Number.isFinite(row.size) && row.size >= 0 ? row.size : undefined,
      mtime: row.date_modified > 116444736000000000 ? Math.round((row.date_modified - 116444736000000000) / 10000000) : undefined }
  })
}

function createEverything({ run = execFile, env = process.env, arch = process.arch } = {}) {
  const root = /\.asar$/i.test(__dirname) ? __dirname + '.unpacked' : __dirname
  const binary = env.ZTOOLS_EVERYTHING_ES || path.join(root, 'vendor', 'es', arch, 'es.exe')
  const active = new Set()
  function execute(args, signal) {
    checkAbort(signal)
    const instance = env.ZTOOLS_EVERYTHING_INSTANCE
    if (instance && /["\x00-\x1f]/.test(instance)) throw new Error('Everything 实例名称无效')
    if (instance) args = ['-instance', `"${instance}"`, ...args]
    return new Promise((resolve, reject) => {
      const controller = new AbortController()
      const cancel = () => controller.abort()
      active.add(cancel); signal?.addEventListener('abort', cancel, { once: true })
      // -search* 后的查询是原样文本。没有 shell，也不会将查询重新解释为 ES 开关。
      run(binary, args, { windowsVerbatimArguments: true, windowsHide: true, signal: controller.signal, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        active.delete(cancel); signal?.removeEventListener('abort', cancel)
        if (controller.signal.aborted) return reject(aborted())
        if (!error || error.code === 9) return resolve(stdout)
        if (error.code === 'ENOENT') return reject(new Error('找不到 es.exe，请重新安装插件，或设置 ZTOOLS_EVERYTHING_ES 指向官方 es.exe'))
        if (error.code === 8 || error.code === 7) return reject(new Error('无法连接 Everything，请启动 Everything 客户端；使用命名实例时请设置 ZTOOLS_EVERYTHING_INSTANCE'))
        reject(new Error(error.killed ? 'Everything 响应超时，请稍后重试' : `Everything 查询失败（${error.code || error.message}）`))
      })
    })
  }
  async function search(options, { signal, queueMs = 0, isCurrent = () => true } = {}, limit) {
    const started = performance.now()
    compile(options, limit)
    const resolved = await resolveDirectories(options, { signal })
    const request = compile(resolved, limit)
    checkAbort(signal)
    if (!isCurrent()) throw aborted()
    if (!request) return { hits: [], offset: options.offset || 0, next: null, windowLimited: false }
    const validated = performance.now()
    const { search, sort, offset, limit: count, recent } = request
    // 多取一项来判断下一页，避免整页刚好填满时显示一个空白下一页。
    const stdout = await execute(['-json', '-columns', 'filename;attributes;size;date-modified', '-date-format', '2',
      '-no-match-path', '-no-case', '-no-whole-word', '-no-diacritics', '-no-pause', '-no-empty-search-help', '-no-hide-empty-search-results',
      '-no-ipc1', '-sort', sort, '-viewport-offset', String(offset), '-viewport-count', String(count + 1), '-search*', search], signal)
    checkAbort(signal)
    const rows = parseResults(stdout)
    const windowLimited = rows.length > count && offset + count >= SEARCH_WINDOW
    return { hits: rows.slice(0, count), offset, next: rows.length > count && !windowLimited ? offset + count : null,
      windowLimited, recent, timings: { queueMs, validationMs: validated - started, transportMs: performance.now() - validated } }
  }
  async function status({ signal } = {}) {
    const version = (await execute(['-get-everything-version'], signal)).trim()
    if (!/^\d+(?:\.\d+){2,3}$/.test(version)) throw new Error('无法读取 Everything 版本')
    return { version }
  }
  return {
    search,
    push: (options, context) => search(options, context, 5),
    status,
    async inspect(options) {
      try { return { usable: true, state: 'ready', status: await status(options) } }
      catch (error) {
        if (error.name === 'AbortError') throw error
        return { usable: false, state: 'connection', title: 'Everything 未就绪',
          message: '确认 Everything 客户端已启动，再点击“重新检测”。', detail: error.message }
      }
    },
    closeConnections() { for (const cancel of active) cancel() }
  }
}

module.exports = { createEverything }
