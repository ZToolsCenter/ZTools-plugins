/** 命名风格代码 */
export type NamingStyle = 'title' | 'camel' | 'pascal' | 'snake' | 'screaming'

const HAN_CHAR = /\p{Script=Han}/u
const ENGLISH_CAMEL =
  /[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+/g

/** 是否为汉字 */
function isHan(ch: string): boolean {
  return HAN_CHAR.test(ch)
}

/** 是否可作为命名内容保留在段内（字母数字下划线汉字） */
function isInnerContentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch) || isHan(ch) || /\s/.test(ch)
}

/** 外部分隔符：符号等，不含字母数字下划线汉字与空白 */
function isOuterSeparator(ch: string): boolean {
  return !isInnerContentChar(ch)
}

type Piece = { type: 'text' | 'sep'; value: string }

/** 按外部分隔符切开并保留分隔符 */
export function splitByOuterSeparators(input: string): Piece[] {
  const pieces: Piece[] = []
  let buf = ''
  let sepMode: boolean | null = null

  for (const ch of input) {
    const sep = isOuterSeparator(ch)
    if (sepMode === null) {
      sepMode = sep
      buf = ch
      continue
    }
    if (sep === sepMode) {
      buf += ch
    } else {
      pieces.push({ type: sepMode ? 'sep' : 'text', value: buf })
      buf = ch
      sepMode = sep
    }
  }
  if (buf) {
    pieces.push({ type: sepMode ? 'sep' : 'text', value: buf })
  }
  return pieces
}

/** 拆英文驼峰与连续大写缩写 */
export function tokenizeEnglish(chunk: string): string[] {
  if (!chunk) return []
  const words: string[] = []
  for (const part of chunk.split(/[_\s]+/)) {
    if (!part) continue
    const matches = part.match(ENGLISH_CAMEL)
    if (matches) {
      for (const m of matches) words.push(m)
    }
  }
  return words
}

type Token =
  | { kind: 'word'; value: string; han: boolean }
  | { kind: 'sep'; value: string }

/** 蛇形类：汉字作为词参与连接 */
function tokenizeForSnake(segment: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const chars = [...segment]

  while (i < chars.length) {
    const ch = chars[i]
    if (/[\s_]/.test(ch)) {
      i++
      continue
    }
    if (isHan(ch)) {
      let han = ch
      i++
      while (i < chars.length && isHan(chars[i])) {
        han += chars[i]
        i++
      }
      tokens.push({ kind: 'word', value: han, han: true })
      continue
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      let eng = ch
      i++
      while (i < chars.length && /[A-Za-z0-9]/.test(chars[i])) {
        eng += chars[i]
        i++
      }
      for (const w of tokenizeEnglish(eng)) {
        tokens.push({ kind: 'word', value: w, han: false })
      }
      continue
    }
    i++
  }
  return tokens
}

/** 驼峰/标题类：汉字作为段内分隔符 */
function tokenizeForCamelFamily(segment: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const chars = [...segment]

  while (i < chars.length) {
    const ch = chars[i]
    if (isHan(ch)) {
      let han = ch
      i++
      while (i < chars.length && isHan(chars[i])) {
        han += chars[i]
        i++
      }
      tokens.push({ kind: 'sep', value: han })
      continue
    }
    if (/[\s_]/.test(ch)) {
      i++
      continue
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      let eng = ch
      i++
      while (i < chars.length && /[A-Za-z0-9]/.test(chars[i])) {
        eng += chars[i]
        i++
      }
      for (const w of tokenizeEnglish(eng)) {
        tokens.push({ kind: 'word', value: w, han: false })
      }
      continue
    }
    i++
  }
  return tokens
}

/** 单词首字母大写其余小写 */
function capWord(word: string): string {
  if (!word) return word
  if (/^[0-9]+$/.test(word)) return word
  const lower = word.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** 将词列表格式化为标题样式 */
function formatTitleWords(words: string[]): string {
  return words.map(capWord).join(' ')
}

/** 将词列表格式化为小驼峰 */
function formatCamelWords(words: string[]): string {
  if (words.length === 0) return ''
  return words
    .map((w, i) => {
      if (/^[0-9]+$/.test(w)) return w
      const lower = w.toLowerCase()
      if (i === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

/** 将词列表格式化为大驼峰 */
function formatPascalWords(words: string[]): string {
  return words
    .map((w) => {
      if (/^[0-9]+$/.test(w)) return w
      return capWord(w)
    })
    .join('')
}

/** 将词列表格式化为蛇形 */
function formatSnakeWords(words: { value: string; han: boolean }[]): string {
  return words
    .map((w) => (w.han ? w.value : w.value.toLowerCase()))
    .join('_')
}

/** 将词列表格式化为尖叫蛇形 */
function formatScreamingWords(words: { value: string; han: boolean }[]): string {
  return words
    .map((w) => (w.han ? w.value : w.value.toUpperCase()))
    .join('_')
}

/** 格式化蛇形类 token 流 */
function formatSnakeTokens(tokens: Token[], screaming: boolean): string {
  const words = tokens.filter((t): t is Extract<Token, { kind: 'word' }> => t.kind === 'word')
  if (words.length === 0) return ''
  return screaming ? formatScreamingWords(words) : formatSnakeWords(words)
}

/** 格式化驼峰族 token 流（汉字分隔保留） */
function formatCamelFamilyTokens(tokens: Token[], style: 'title' | 'camel' | 'pascal'): string {
  let result = ''
  let pendingWords: string[] = []

  const flush = () => {
    if (pendingWords.length === 0) return
    if (style === 'title') result += formatTitleWords(pendingWords)
    else if (style === 'camel') result += formatCamelWords(pendingWords)
    else result += formatPascalWords(pendingWords)
    pendingWords = []
  }

  for (const t of tokens) {
    if (t.kind === 'word') {
      pendingWords.push(t.value)
    } else {
      flush()
      result += t.value
    }
  }
  flush()
  return result
}

/** 转换单个文本段 */
function convertSegment(segment: string, style: NamingStyle): string {
  if (!segment) return segment

  if (style === 'snake' || style === 'screaming') {
    return formatSnakeTokens(tokenizeForSnake(segment), style === 'screaming')
  }

  return formatCamelFamilyTokens(tokenizeForCamelFamily(segment), style)
}

/** 是否存在可转换的命名片段 */
export function hasConvertibleNaming(text: string): boolean {
  if (!text) return false
  return /[A-Za-z\u4e00-\u9fff]/.test(text)
}

/** 剥离并保留首尾空白，只对中间正文做转换 */
export function withEdgeWhitespace(text: string, transform: (core: string) => string): string {
  const lead = text.match(/^\s*/)?.[0] ?? ''
  const rest = text.slice(lead.length)
  const trail = rest.match(/\s*$/)?.[0] ?? ''
  const core = rest.slice(0, rest.length - trail.length)
  if (!core) return text
  return lead + transform(core) + trail
}

/** 按目标命名风格转换整段文本 */
export function convertNaming(text: string, style: NamingStyle): string {
  return withEdgeWhitespace(text, (core) => {
    const pieces = splitByOuterSeparators(core)
    if (pieces.length === 0) return core
    return pieces
      .map((p) => (p.type === 'sep' ? p.value : convertSegment(p.value, style)))
      .join('')
  })
}

export function toTitleCase(text: string): string {
  return convertNaming(text, 'title')
}

export function toCamelCase(text: string): string {
  return convertNaming(text, 'camel')
}

export function toPascalCase(text: string): string {
  return convertNaming(text, 'pascal')
}

export function toSnakeCase(text: string): string {
  return convertNaming(text, 'snake')
}

export function toScreamingSnakeCase(text: string): string {
  return convertNaming(text, 'screaming')
}

const NAMING_CODES = new Set<string>(['title', 'camel', 'pascal', 'snake', 'screaming'])

/** 是否为命名风格功能码 */
export function isNamingCode(code: string): boolean {
  return NAMING_CODES.has(code)
}

/** 按功能码做命名转换，未知码返回 null */
export function convertNamingByCode(code: string, text: string): string | null {
  if (!isNamingCode(code)) return null
  return convertNaming(text, code as NamingStyle)
}
