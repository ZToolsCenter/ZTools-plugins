const categories = require('./categories.cjs')
const { normalizeContent } = require('./content.cjs')
const { performance } = require('node:perf_hooks')
const { checkAbort, aborted } = require('./latest.cjs')
const { applyFilters, resolveDirectories } = require('./filters.cjs')

// 文件名/路径的分页检索窗口为 20,000；正文使用独立的候选游标，不受此窗口限制。
const SEARCH_WINDOW = 20000
const PAGE_SIZES = [25, 50, 100]

/** 将文本转成正则字面量，避免精确模式意外执行用户输入的元字符。 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将各匹配模式编译为引擎条件；所有范围、大小写和分类过滤先于分页执行。
 * @param {object} options 用户原文、模式、范围、Aa、分类、目录、页大小和游标
 * @returns {object} 可直接发送到 FSearch 的请求
 */
function buildRequest(options = {}) {
  const { query, mode = 'literal', field = 'name', caseSensitive = false, category = 'all', pageSize = 50, offset = 0 } = options
  const content = ['content', 'symbol'].includes(field)
  if (typeof query !== 'string') throw new Error('搜索内容必须是文本')
  if (!['literal', 'fuzzy', 'regex', 'native'].includes(mode)) throw new Error('未知的匹配模式')
  if (!['name', 'path', 'content', 'symbol', 'engine'].includes(field)) throw new Error('未知的搜索范围')
  if (typeof caseSensitive !== 'boolean') throw new Error('Aa 状态必须是布尔值')
  if (!PAGE_SIZES.includes(pageSize)) throw new Error('每页条数必须是 25、50 或 100')
  if (!Number.isSafeInteger(offset) || offset < 0 || (!content && offset >= SEARCH_WINDOW)) throw new Error('分页位置超出检索窗口，请缩小搜索条件')
  const filter = categories.find(item => item.id === category)
  if (!filter) throw new Error('未知的文件分类')

  if (field === 'symbol' && mode !== 'literal') throw new Error('定义搜索使用引擎的符号模式，不能同时指定其他匹配模式')
  if (content && ['fuzzy', 'native'].includes(mode)) throw new Error('文件内容支持文本包含和正则表达式，请切换匹配模式')
  if (content && !filter.contentSupported) throw new Error('该分类不支持纯文本内容搜索')

  if ((mode === 'native') !== (field === 'engine')) throw new Error('模糊查找使用名称及父目录范围')
  if (mode === 'native' && caseSensitive) throw new Error('模糊查找不支持区分大小写，请切换精确或字符模糊模式')
  if (mode === 'native' && query.trim() && (!/^[\p{L}\p{M}\p{N}_ .\/\-]+$/u.test(query) || query.trim().split(/[\s/]+/).length > 8)) throw new Error('模糊查找请输入最多 8 个普通词；特殊符号请使用精确或正则模式')

  // 文本模式保留词间空格；模糊模式按字符顺序匹配，空格作为字符间隔。
  const text = query.trim()
  let expression
  if (mode === 'regex') expression = query
  else if (mode === 'literal') expression = escapeRegex(text)
  else expression = '(?s:' + Array.from(text).filter(character => !/\s/u.test(character)).map(escapeRegex).join('.*') + ')'
  const pattern = `(?${caseSensitive ? '-i' : 'i'}:${expression})`

  // 精确/正则/字符模糊严格限制字段；原生模式另行交给引擎的名称与父目录评分器。
  const payload = content
    ? { op: 'grep', q: '', pattern: query, mode: field === 'symbol' ? 'symbol' : mode, case: caseSensitive ? 'sensitive' : 'insensitive', context: 1, per_file: 3, limit: pageSize, cursor: offset, kind: 'file' }
    : { q: '', [field === 'name' ? 're' : 'path']: pattern, limit: pageSize, offset }
  if (options.file) {
    if (!content || !require('node:path').isAbsolute(options.file)) throw new Error('单文件正文范围无效')
    if (offset !== 0) throw new Error('单文件正文不支持文件分页')
    if (options.git || options.extensions || options.modified || options.size || options.exclude || category !== 'all') throw new Error('单文件正文不使用分类及目录筛选，请先清空这些筛选')
    payload.file = options.file; delete payload.cursor
  }
  if (filter.kind) payload.kind = filter.kind
  if (mode === 'native') { delete payload.re; delete payload.path; payload.q = query.trim() }
  if (!applyFilters(payload, options, filter, content)) payload.noResults = true
  if (content && options.git) {
    // Git 正文走服务的过滤分页分支，next 是结果偏移，不能当成内容候选游标。
    if (offset >= 2000) throw new Error('Git 正文检索达到 2,000 项窗口，请缩小条件')
    delete payload.cursor; payload.offset = offset
  }
  return payload
}

/**
 * 创建搜索适配器；只保留当前页，直接采用服务返回的下一页位置，不缓存整个结果集。
 * @param {Function} request 调用官方服务的请求函数
 * @returns {Function} 返回命中、下一页游标和窗口限制状态的异步搜索函数
 */
function createSearch(request) {
  return async function search(options = {}, { signal, queueMs = 0, isCurrent = () => true } = {}) {
    const started = performance.now()
    // 先做纯参数校验，再异步访问目录；异步结束后仍校验取消状态。
    buildRequest(options)
    const resolved = await resolveDirectories(options, { signal })
    const payload = buildRequest(resolved)
    checkAbort(signal)
    if (!isCurrent()) throw aborted()
    const validated = performance.now()
    const content = ['content', 'symbol'].includes(options.field)
    const offset = options.offset || 0
    if (payload.noResults || (!options.query.trim() && content)) return { hits: [], took_us: 0, offset, next: null, windowLimited: false, content }
    if (!options.query.trim() && !options.browse) {
      if (options.git) throw new Error('最近文件不支持 Git 状态，请输入关键词或选择浏览筛选结果')
      payload.op = 'recent'; delete payload.offset; delete payload.re; delete payload.path; delete payload.boost
    }
    let response
    try { response = await request(payload, { signal }) }
    catch (error) {
      if (options.mode === 'regex' && /regex parse error|regex syntax|regex.*error|unclosed|repetition operator/i.test(error.message)) {
        throw new Error('正则表达式无效：' + error.message)
      }
      throw error
    }
    checkAbort(signal)
    const timings = { queueMs, validationMs: validated - started, transportMs: performance.now() - validated }
    if (content) {
      const result = normalizeContent(response, offset)
      if (options.git && result.next >= 2000) { result.next = null; result.windowLimited = true; result.windowMessage = 'Git 正文检索达到 2,000 项窗口，请缩小条件' }
      return { ...result, timings }
    }
    if (!Array.isArray(response.hits)) throw new Error('FSearch 返回的结果格式无效')
    const next = response.next
    if (next !== undefined && (!Number.isSafeInteger(next) || next <= offset)) {
      throw new Error('引擎未能继续当前检索，请缩小条件后重试')
    }
    const windowLimited = (next !== undefined && next >= SEARCH_WINDOW) || offset + response.hits.length >= SEARCH_WINDOW
    return {
      timings,
      hits: response.hits,
      took_us: response.took_us,
      offset,
      recent: payload.op === 'recent',
      next: next === undefined || windowLimited ? null : next,
      windowLimited
    }
  }
}

module.exports = { buildRequest, createSearch, escapeRegex, PAGE_SIZES, SEARCH_WINDOW }
