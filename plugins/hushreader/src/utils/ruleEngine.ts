// 通用书源规则引擎（对标开源阅读 Legado AnalyzeRule）
// 支持：
//   - CSS 选择器（@text/@textNodes/@ownText/@html/@all/@属性）
//   - XPath（/ 开头或 @XPath: 前缀）
//   - JSONPath（$. 或 $[ 开头或 @Json: 前缀）
//   - 正则提取（@regex: 前缀）
//   - 规则组合（&& 并集 / || 或 / %% 交错）
//   - 结果正则替换（规则##正则##替换，### 结尾为仅替换首个匹配）
//   - 元素索引筛选（选择器[n] / [-n] / [a:b]）

export type RuleMode = 'css' | 'xpath' | 'json' | 'regex' | 'js'

export interface RuleExpression {
  /** 核心规则（选择器 / XPath / JSONPath / 正则） */
  base: string
  mode: RuleMode
  /** CSS 取值后缀：text / textNodes / ownText / html / all / 属性名 */
  attr?: string
  /** ## 后缀正则替换 */
  replace?: { pattern: string; replacement: string; first: boolean }
  /** 元素索引筛选（选择器尾部的 [n] 写法） */
  indexes?: string
}

export type RuleContent = Document | Element | unknown

/** 拆分多规则组合，返回各段与组合类型 */
export function splitRuleChain(rule: string): { type: '&&' | '||' | '%%' | ''; parts: string[] } {
  if (!rule) return { type: '', parts: [] }
  let type: '&&' | '||' | '%%' | '' = ''
  for (const sep of ['&&', '||', '%%'] as const) {
    if (rule.includes(sep)) {
      type = sep
      break
    }
  }
  if (!type) return { type: '', parts: [rule] }
  return { type, parts: rule.split(type).map(s => s.trim()).filter(Boolean) }
}

/** 解析单条规则表达式 */
export function parseRuleExpression(raw: string): RuleExpression {
  let rule = (raw || '').trim()
  let mode: RuleMode = 'css'

  // 显式类型前缀
  if (/^@CSS:/i.test(rule)) {
    mode = 'css'
    rule = rule.slice(5).trim()
  } else if (/^@XPath:/i.test(rule)) {
    mode = 'xpath'
    rule = rule.slice(7).trim()
  } else if (/^@Json:/i.test(rule)) {
    mode = 'json'
    rule = rule.slice(6).trim()
  } else if (/^@regex:/i.test(rule)) {
    mode = 'regex'
    rule = rule.slice(7).trim()
  } else if (/^@js:/i.test(rule)) {
    mode = 'js'
    rule = rule.slice(4).trim()
  } else if (rule.startsWith('@@')) {
    mode = 'css'
    rule = rule.slice(2).trim()
  }

  // ## 正则替换后缀（与 Legado 一致：按 ## 切分）
  const parts = rule.split('##')
  let replace: RuleExpression['replace']
  if (parts.length > 1 && parts[0]) {
    replace = {
      pattern: parts[1],
      replacement: parts.length > 2 ? parts[2] : '',
      first: parts.length > 3
    }
    rule = parts[0].trim()
  }

  // 模式自动识别（未显式指定时）
  if (mode === 'css') {
    if (rule.startsWith('$.') || rule.startsWith('$[')) mode = 'json'
    else if (rule.startsWith('/')) mode = 'xpath'
  }

  // CSS / XPath 取值后缀：最后一个 @ 之后的部分（排除 @ 属性值内的 @）
  let attr: string | undefined
  if (mode === 'css' || mode === 'xpath') {
    const at = rule.lastIndexOf('@')
    if (at <= 0 && rule.startsWith('@') && rule.length > 1) {
      // 形如 @textNodes / @ownText：无选择器，直接对元素本身取值
      attr = rule.slice(1).trim()
      rule = ''
    } else if (at > 0) {
      const tail = rule.slice(at + 1).trim()
      // 仅当最后一段是取值后缀（text/textNodes/ownText/html/属性名）才切分为 attr；
      // 否则（如 tag.li / class.x / css:...）它是子元素选择器，保留在 rule 中继续处理
      const isValueSuffix = tail === '' ||
        /^(text|textNodes|ownText|html)$/i.test(tail) ||
        /^[a-zA-Z_][\w-]*$/.test(tail)
      if (isValueSuffix) {
        attr = tail
        rule = rule.slice(0, at).trim()
      }
    }
  }

  // 子选择器链（@tag.li / @class.x / @id.x / @css:...）转标准 CSS 后代选择器
  if (mode === 'css' && rule.includes('@')) {
    const segs = rule.split('@').map(s => s.trim()).filter(Boolean)
    const converted: string[] = []
    let valid = true
    for (const s of segs) {
      if (/^css:/i.test(s)) converted.push(s.replace(/^css:/i, ''))
      else if (/^(tag|class|id)\./i.test(s)) converted.push(s)
      else if (converted.length === 0) converted.push(s) // 首段为基础选择器
      else { valid = false; break }
    }
    if (valid && converted.length) rule = converted.join(' ')
  }

  // Legado 简写选择器（class.x / id.x / tag.x）转标准 CSS
  if (mode === 'css' && rule) rule = normalizeLegadoSelector(rule)

  // CSS 元素索引筛选：[...] 结尾（仅 CSS；XPath 的 [1] 是位置谓词，属于表达式本身）
  let indexes: string | undefined
  if (mode === 'css') {
    const im = /\[([\d\s,:!\-]+)\]$/.exec(rule)
    if (im) {
      indexes = im[1].trim()
      rule = rule.slice(0, im.index).trim()
    }
  }

  return { base: rule, mode, attr, replace, indexes }
}

/**
 * 把 Legado 简写选择器转标准 CSS：
 *   class.x → .x   id.x → #x   tag.x → x
 * 逐段处理（以空白分隔的复合选择器），不动属性值内的 class= 等。
 */
export function normalizeLegadoSelector(sel: string): string {
  return sel.split(/\s+/).map(s => s.trim()).filter(Boolean)
    .map(s => {
      const m = /^(class|id|tag)\./i.exec(s)
      if (!m) return s
      const rest = s.slice(m[0].length)
      switch (m[1].toLowerCase()) {
        case 'class': return `.${rest}`
        case 'id': return `#${rest}`
        case 'tag': return rest
      }
      return s
    })
    .join(' ')
}

/** 对规则结果应用 ## 正则替换 */
export function applyRuleReplace(value: string, replace: RuleExpression['replace']): string {
  if (!replace || !replace.pattern) return value
  try {
    const regex = new RegExp(replace.pattern, 'g')
    if (replace.first) {
      const m = regex.exec(value)
      if (m) {
        const full = m[0]
        const out = full.replace(regex, replace.replacement)
        return value.replace(full, out)
      }
      return value
    }
    return value.replace(regex, replace.replacement)
  } catch {
    return value
  }
}

// ---------- DOM / XPath / JSON 查询 ----------

export function parseHtmlDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** 文本节点内容按行拆分并去首尾空白（对齐 jsoup 文本归一化的段落语义） */
function textNodeLines(node: Text): string[] {
  return (node.textContent || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

/** 直接文本节点列表，按行拼接（对应 @textNodes） */
function textNodes(el: Element): string {
  const lines: string[] = []
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) lines.push(...textNodeLines(node as Text))
  })
  return lines.join('\n')
}

/** 元素直接文本节点内容（对应 @ownText，与 @textNodes 同语义） */
function ownText(el: Element): string {
  return textNodes(el)
}

/** 按取值后缀从元素提取值（@text/@textNodes/@ownText/@html/@all/属性名） */
function extractNodeValue(node: Element, attr?: string): string {
  switch (attr) {
    case 'text':
    case undefined:
    case '': return (node.textContent || '').trim()
    case 'textNodes': return textNodes(node)
    case 'ownText': return ownText(node)
    case 'html': {
      const clone = node.cloneNode(true) as Element
      clone.querySelectorAll('script,style').forEach(s => s.remove())
      return clone.innerHTML || ''
    }
    case 'all': return node.outerHTML || ''
    default: return (node.getAttribute(attr) || '').trim()
  }
}

/** 按 css 表达式从元素取文本列表 */
function cssTextList(el: Element, base: string, attr?: string): string[] {
  let nodes: Element[]
  try {
    nodes = base ? Array.from(el.querySelectorAll(base)) : [el]
  } catch {
    // 非法选择器（书源规则写错）不抛错，返回空
    return []
  }
  const list: string[] = []
  for (const node of nodes) {
    if (!(node instanceof Element)) continue
    const value = extractNodeValue(node, attr)
    if (value) list.push(value)
  }
  return list
}

/** 查询 XPath 节点列表 */
function xpathNodes(el: Element, expr: string): Element[] {
  try {
    const result = document.evaluate(expr, el, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    const nodes: Element[] = []
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i)
      if (node instanceof Element) nodes.push(node)
    }
    return nodes
  } catch {
    return []
  }
}

function xpathTextList(el: Element, expr: string, attr?: string): string[] {
  try {
    const result = document.evaluate(expr, el, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    const list: string[] = []
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i)
      if (node instanceof Element) {
        const value = extractNodeValue(node, attr)
        if (value) list.push(value)
      } else if (node) {
        const value = (node.nodeValue || (node.textContent || '')).trim()
        if (value) list.push(value)
      }
    }
    return list
  } catch {
    return []
  }
}

/** 索引筛选：支持 [0] [-1] [1:3] [1,3] [a:b:step] */
export function applyIndexes<T>(list: T[], indexes?: string): T[] {
  if (!indexes || list.length === 0) return list
  const result: T[] = []
  const tokens = indexes.split(',').map(s => s.trim()).filter(Boolean)
  for (const token of tokens) {
    const range = /^(-?\d*):(-?\d*)(?::(-?\d+))?$/.exec(token)
    if (range) {
      const start = range[1] === '' ? undefined : Number(range[1])
      const end = range[2] === '' ? undefined : Number(range[2])
      const stepRaw = range[3] ? Number(range[3]) : 1
      let s = start ?? 0
      let e = end ?? list.length - 1
      if (s < 0) s += list.length
      if (e < 0) e += list.length
      s = Math.max(0, Math.min(s, list.length - 1))
      e = Math.max(0, Math.min(e, list.length - 1))
      const step = stepRaw > 0 ? stepRaw : 1
      if (e >= s) {
        for (let i = s; i <= e; i += step) result.push(list[i])
      } else {
        for (let i = s; i >= e; i -= step) result.push(list[i])
      }
    } else {
      let idx = Number(token)
      if (!Number.isFinite(idx)) continue
      if (idx < 0) idx += list.length
      if (idx >= 0 && idx < list.length) result.push(list[idx])
    }
  }
  return result
}

// ---------- JSONPath ----------

function jget(obj: unknown, rule: string): any {
  if (!rule) return undefined
  let v: any = obj
  const path = rule.replace(/^\$\.?/, '').split('.').map(s => s.trim()).filter(Boolean)
  for (const seg of path) {
    if (v == null) return undefined
    const bracket = /^(\w+)\[(\d+|\*)\]$/.exec(seg)
    if (bracket) {
      v = v[bracket[1]]
      if (Array.isArray(v)) {
        if (bracket[2] !== '*') v = v[Number(bracket[2])]
      }
      continue
    }
    if (seg.includes('$$')) {
      const [kind, key] = seg.split('$$')
      if (kind === 'index') v = (v as any[])[Number(key)]
      else v = v[key]
      continue
    }
    v = v[seg]
  }
  return v
}

function jsonList(data: unknown, base: string): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const v = jget(data, base)
    if (Array.isArray(v)) return v
    // bookList 指向单个对象时按单条结果处理
    if (v && typeof v === 'object') return [v]
    const arr = jget(data, base.replace(/\.\w+$/, ''))
    if (Array.isArray(arr)) return arr
  }
  return []
}

function jsonTextList(item: unknown, root: unknown, base: string): string[] {
  if (base.startsWith('$')) {
    const v = jget(root, base)
    return v == null ? [] : [String(v)]
  }
  const v = jget(item, base)
  return v == null ? [] : [String(v)]
}

// ---------- 对外查询接口 ----------

export interface RuleQueryContext {
  /** JSON 数据（JSONPath 模式的根） */
  json?: unknown
  /** 是否 URL 模式（取第一条结果） */
  isUrl?: boolean
}

/** 查询字符串列表 */
export function queryStringList(
  content: RuleContent,
  rule: string,
  ctx: RuleQueryContext = {}
): string[] {
  if (!rule) return []
  const chain = splitRuleChain(rule)
  const out: string[] = []
  for (const part of chain.parts) {
    const expr = parseRuleExpression(part)
    let values: string[] = []

    if (expr.mode === 'json') {
      // JSONPath：内容为 JSON 字符串 / 已解析对象 / 数组
      const root = ctx.json ?? content
      if (content && typeof content === 'object') {
        values = jsonTextList(content, root, expr.base)
      } else if (typeof content === 'string') {
        try {
          const data = JSON.parse(content)
          values = jsonTextList(data, data, expr.base)
        } catch { }
      }
    } else if (content instanceof Element || content instanceof Document) {
      const root = content instanceof Document ? content.body : content
      if (expr.mode === 'xpath') {
        values = xpathTextList(root, expr.base, expr.attr)
      } else if (expr.mode === 'regex') {
        try {
          const re = new RegExp(expr.base, 'g')
          const text = root.textContent || ''
          let m: RegExpExecArray | null
          while ((m = re.exec(text))) {
            values.push(m[1] != null ? m[1] : m[0])
            if (m.index === re.lastIndex) re.lastIndex++
          }
        } catch { }
      } else if (expr.mode === 'js') {
        values = [expr.base]
      } else {
        values = cssTextList(root, expr.base, expr.attr)
      }
    } else if (typeof content === 'string') {
      if (expr.mode === 'regex') {
        try {
          const re = new RegExp(expr.base, 'g')
          let m: RegExpExecArray | null
          while ((m = re.exec(content))) {
            values.push(m[1] != null ? m[1] : m[0])
            if (m.index === re.lastIndex) re.lastIndex++
          }
        } catch { }
      } else {
        // 字符串内容按 HTML 解析
        const doc = parseHtmlDoc(content)
        values = cssTextList(doc.body, expr.base, expr.attr)
      }
    }

    values = applyIndexes(values, expr.indexes)
    values = values.map(v => expr.replace ? applyRuleReplace(v, expr.replace) : v)
    if (chain.type === '||' && out.length > 0) break
    if (values.length > 0) {
      if (chain.type === '%%') {
        // 交错合并
        values.forEach((v, i) => {
          out[i] = (out[i] || '') + v
        })
      } else {
        out.push(...values)
      }
    }
  }
  return out
}

/** 查询单个字符串：列表>1 时按行拼接（与 Legado getString 一致） */
export function queryString(
  content: RuleContent,
  rule: string,
  ctx: RuleQueryContext = {}
): string {
  if (!rule) return ''
  const chain = splitRuleChain(rule)
  if (chain.type !== '' && chain.parts.length > 1) {
    const values = queryStringList(content, rule, ctx)
    return values.length ? values.join('\n') : ''
  }
  const expr = parseRuleExpression(rule)
  const list = queryStringList(content, rule, ctx)
  if (list.length === 0) return ''
  // URL 模式取第一条
  if (ctx.isUrl) return list[0]
  return list.join('\n')
}

/** 查询元素列表（用于容器规则：bookList / chapterList） */
export function queryElements(content: RuleContent, rule: string): unknown[] {
  if (!rule) {
    // 空规则：JSON 数组直接展开，对象按单条处理
    if (Array.isArray(content)) return content as unknown[]
    if (content && typeof content === 'object' && !(content instanceof Element) && !(content instanceof Document)) {
      return [content]
    }
    return []
  }
  const chain = splitRuleChain(rule)
  const out: unknown[] = []
  for (const part of chain.parts) {
    const expr = parseRuleExpression(part)
    let items: unknown[] = []
    if (content instanceof Element || content instanceof Document) {
      const root = content instanceof Document ? content.body : content
      if (expr.mode === 'xpath') {
        items = xpathNodes(root, expr.base)
      } else if (expr.mode === 'json') {
        // 当前为 HTML 内容时无 JSON 可解析
        items = []
      } else if (expr.mode === 'css') {
        try {
          items = expr.base ? Array.from(root.querySelectorAll(expr.base)) : [root]
        } catch {
          items = []
        }
      } else {
        items = [content]
      }
    } else if (content && typeof content === 'object') {
      // JSON 数据
      items = jsonList(content, expr.base)
    } else if (typeof content === 'string') {
      if (expr.mode === 'json') {
        try {
          const data = JSON.parse(content)
          items = jsonList(data, expr.base)
        } catch { }
      } else {
        const doc = parseHtmlDoc(content)
        try {
          items = expr.base ? Array.from(doc.body.querySelectorAll(expr.base)) : [doc.body]
        } catch {
          items = []
        }
      }
    }
    items = applyIndexes(items, expr.indexes)
    if (chain.type === '||' && out.length > 0) break
    out.push(...items)
  }
  return out
}

/** 从元素/文档/JSON 中提取元素（配合 queryElements 的单项使用） */
export function queryElementText(item: unknown, rule: string, ctx: RuleQueryContext = {}): string {
  if (item instanceof Element) return queryString(item, rule, ctx)
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const expr = parseRuleExpression(rule)
    const root = ctx.json ?? item
    const values = jsonTextList(item, root, expr.base)
    return values.length ? values.join('\n') : ''
  }
  return ''
}
