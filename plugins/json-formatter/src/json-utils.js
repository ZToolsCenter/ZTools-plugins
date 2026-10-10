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

/**
 * 仅在预览中还原字符串值中的引号和反斜杠，保留控制字符及 key 的转义。
 * 记录显示位置与源文本的对应关系，选中复制时仍返回合法的 JSON 表示。
 * @param {string} source
 */
export function createJsonPreview(source) {
  const ranges = []
  const strings = []
  let removed = 0
  const text = source.replace(/"(?:\\.|[^"\\])*"/g, (token, offset) => {
    if (/^\s*:/.test(source.slice(offset + token.length))) return token
    const preview = token.replace(/\\(["\\])/g, '$1')
    strings.push({ start: offset, end: offset + token.length })
    if (preview !== token) {
      ranges.push({ start: offset - removed, end: offset - removed + preview.length, sourceStart: offset })
      removed += token.length - preview.length
    }
    return preview
  })

  const toSourceOffset = (offset) => {
    let delta = 0
    for (const range of ranges) {
      if (offset < range.start) break
      let sourceOffset = range.sourceStart
      const end = Math.min(offset, range.end)
      for (let index = range.start; index < end; index += 1) {
        const escaped = source[sourceOffset] === '\\' && /["\\]/.test(source[sourceOffset + 1])
        sourceOffset += escaped ? 2 : 1
      }
      if (offset <= range.end) return sourceOffset
      delta = sourceOffset - range.end
    }
    return offset + delta
  }

  return {
    text,
    getSourceText: (start = 0, end = text.length) => source.slice(toSourceOffset(start), toSourceOffset(end)),
    restoreSource(input) {
      let start = 0
      while (start < text.length && start < input.length && text[start] === input[start]) start += 1
      let end = text.length
      let inputEnd = input.length
      while (end > start && inputEnd > start && text[end - 1] === input[inputEnd - 1]) {
        end -= 1
        inputEnd -= 1
      }
      const sourceStart = toSourceOffset(start)
      const sourceEnd = toSourceOffset(end)
      let inserted = input.slice(start, inputEnd)
      // 在字符串内部编辑时，只为新增内容补回转义，原有内容保持不变。
      if (strings.some((range) => sourceStart > range.start && sourceEnd < range.end)) {
        inserted = JSON.stringify(inserted).slice(1, -1)
      }
      return source.slice(0, sourceStart) + inserted + source.slice(sourceEnd)
    }
  }
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
  return typeof value === 'string' ? `"${value}"` : createJsonPreview(JSON.stringify(value, null, 2)).text
}

/**
 * 字符串节点按原文编辑；外层双引号内的内容仍作为字符串保存。
 * 对象和数组同样反转义显示，编辑时将显示位置映射回 JSON 源文本。
 * @param {unknown} value
 */
export function createNodeEditor(value) {
  // textarea 会将 CR/CRLF 统一成 LF，未修改时仍保留原始值。
  const text = valueToEditorText(value).replace(/\r\n?/g, '\n')
  const isStringText = (input) => typeof value === 'string' && input.startsWith('"') && input.endsWith('"') && input.length >= 2
  let preview = createJsonPreview(JSON.stringify(value, null, 2))
  const update = (input) => {
    const nextSource = preview.restoreSource(input)
    const nextPreview = createJsonPreview(nextSource)
    if (nextPreview.text === input) {
      preview = nextPreview
    }
    return nextSource
  }

  return {
    text,
    update(input) {
      if (typeof value !== 'string') update(input)
    },
    parse(input, options = {}) {
      if (input === text) return value
      if (isStringText(input)) return input.slice(1, -1)
      if (typeof value === 'string') return parseJson(input, options).value
      const restored = update(input)
      try {
        return parseJson(restored, options).value
      } catch {
        return parseJson(input, options).value
      }
    },
    getSourceText(input, start, end) {
      if (typeof value !== 'string') {
        const restored = update(input)
        const restoredPreview = createJsonPreview(restored)
        return restoredPreview.text === input
          ? restoredPreview.getSourceText(start, end)
          : input.slice(start, end)
      }
      if (!isStringText(input)) return input.slice(start, end)
      if (input === text && start === 0 && end === input.length) return JSON.stringify(value)
      const contentStart = Math.max(1, start)
      const contentEnd = Math.min(input.length - 1, end)
      const content = input.slice(contentStart, Math.max(contentStart, contentEnd))
      return (start === 0 && end > 0 ? '"' : '')
        + JSON.stringify(content).slice(1, -1)
        + (end === input.length && start < end ? '"' : '')
    }
  }
}

/** @param {unknown} value @param {{isRoot?: boolean}} options */
export function valueToClipboardText(value, { isRoot = false } = {}) {
  if (isRoot) return JSON.stringify(value, null, 2)
  return typeof value === 'string' ? value : createJsonPreview(JSON.stringify(value, null, 2)).text
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
