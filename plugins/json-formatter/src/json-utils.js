import JSON5 from 'json5'

/** @typedef {'json'|'json5'} ParseMode */

/**
 * 解析 JSON 或可选的 JSON5，并返回使用的解析模式。
 * @param {string} input
 * @param {{allowJson5?: boolean}} options
 * @returns {{value: unknown, mode: ParseMode}}
 */
export function parseJson(input, { allowJson5 = true } = {}) {
  const source = String(input ?? '').replace(/^\uFEFF/, '').trim()
  if (!source) throw new Error('请先输入 JSON')

  try {
    return { value: JSON.parse(source), mode: 'json' }
  } catch (strictError) {
    if (!allowJson5) throw normalizeParseError(strictError, source)
    try {
      return { value: JSON5.parse(source), mode: 'json5' }
    } catch (json5Error) {
      throw normalizeParseError(json5Error, source)
    }
  }
}

/**
 * 格式化 JSON/JSON5 文本。
 * @param {string} input
 * @param {{allowJson5?: boolean, sortKeys?: boolean}} options
 */
export function formatJson(input, options = {}) {
  const parsed = parseJson(input, options)
  const value = options.sortKeys ? sortObjectKeys(parsed.value) : parsed.value
  return { ...parsed, value, text: JSON.stringify(value, null, 2) }
}

/** @param {unknown} value */
export function minifyJson(value) {
  return JSON.stringify(value)
}

/**
 * 递归排序普通对象的 key，数组顺序保持不变。
 * @param {unknown} value
 * @returns {unknown}
 */
export function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
      .map((key) => [key, sortObjectKeys(value[key])])
  )
}

/**
 * 将路径数组格式化成可复制的 JavaScript/JSONPath 风格路径。
 * @param {(string|number)[]} path
 */
export function formatJsonPath(path) {
  return path.reduce((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) return `${result}.${segment}`
    return `${result}[${JSON.stringify(segment)}]`
  }, '$')
}

/** @param {unknown} root @param {(string|number)[]} path */
export function getValueAtPath(root, path) {
  return path.reduce((value, segment) => value[segment], root)
}

/**
 * 在 JSON 数据副本中替换节点。
 * @param {unknown} root
 * @param {(string|number)[]} path
 * @param {unknown} nextValue
 */
export function replaceValueAtPath(root, path, nextValue) {
  if (path.length === 0) return nextValue
  const clone = structuredClone(root)
  const parent = getValueAtPath(clone, path.slice(0, -1))
  parent[path.at(-1)] = nextValue
  return clone
}

/** @param {unknown} value */
export function getJsonType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** @param {unknown} value */
export function valueToEditorText(value) {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, 2)
}

/** @param {unknown} value */
export function valueToClipboardText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/**
 * 从 ZTools 进入动作中抽取文本。
 * @param {{type?: string, payload?: unknown}|null|undefined} action
 */
export function extractJsonFromAction(action) {
  if (!action || !['regex', 'over'].includes(action.type || '')) return ''
  if (typeof action.payload === 'string') return action.payload.trim()
  if (typeof action.payload?.text === 'string') return action.payload.text.trim()
  return ''
}

/** @param {unknown} error @param {string} source */
function normalizeParseError(error, source) {
  const original = error instanceof Error ? error : new Error(String(error))
  let line = Number(original.lineNumber || 0)
  let column = Number(original.columnNumber || 0)
  const position = /position\s+(\d+)/i.exec(original.message)?.[1]
  if ((!line || !column) && position) {
    const before = source.slice(0, Number(position))
    line = before.split('\n').length
    column = before.length - before.lastIndexOf('\n')
  }
  const location = line ? `（第 ${line} 行${column ? `，第 ${column} 列` : ''}）` : ''
  const cleanMessage = original.message.replace(/^JSON5:\s*/i, '').replace(/\s+at\s+\d+:\d+$/i, '')
  const normalized = new Error(`JSON 格式错误${location}：${cleanMessage}`)
  normalized.cause = original
  return normalized
}
