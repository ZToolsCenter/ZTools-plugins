export type TokenType =
  | 'literal'
  | 'escape'
  | 'charClass'
  | 'group'
  | 'quantifier'
  | 'anchor'
  | 'alternation'
  | 'dot'
  | 'backref'

export interface RegexToken {
  type: TokenType
  value: string
  start: number
  end: number
  children?: RegexToken[]
  quantifier?: RegexToken
  groupKind?: 'capturing' | 'non-capturing' | 'lookahead' | 'negative-lookahead' | 'lookbehind' | 'negative-lookbehind' | 'named' | 'atomic' | 'comment'
  groupName?: string
}

const ESCAPE_MAP: Record<string, string> = {
  d: 'digit',
  D: 'non-digit',
  w: 'word',
  W: 'non-word',
  s: 'space',
  S: 'non-space',
  b: 'boundary',
  B: 'non-boundary',
  n: 'newline',
  r: 'return',
  t: 'tab',
  f: 'formfeed',
  v: 'vtab',
  '0': 'null'
}

function readQuantifier(pattern: string, start: number): { token: RegexToken | null; next: number } {
  const char = pattern[start]
  if ('*+?'.includes(char)) {
    return {
      token: { type: 'quantifier', value: char, start, end: start + 1 },
      next: start + 1
    }
  }
  if (char === '{') {
    const close = pattern.indexOf('}', start)
    if (close === -1) {
      return { token: null, next: start }
    }
    const inner = pattern.slice(start + 1, close)
    if (/^\d+(,\d*)?$/.test(inner) || /^\d*,\d+$/.test(inner)) {
      return {
        token: { type: 'quantifier', value: pattern.slice(start, close + 1), start, end: close + 1 },
        next: close + 1
      }
    }
  }
  return { token: null, next: start }
}

function readCharClass(pattern: string, start: number): { token: RegexToken; next: number } | { error: string } {
  let i = start + 1
  if (pattern[i] === ']') i++
  while (i < pattern.length) {
    if (pattern[i] === '\\') {
      i += 2
      continue
    }
    if (pattern[i] === ']') {
      return {
        token: {
          type: 'charClass',
          value: pattern.slice(start, i + 1),
          start,
          end: i + 1
        },
        next: i + 1
      }
    }
    i++
  }
  return { error: '字符类 [ 未闭合' }
}

function readEscape(pattern: string, start: number): { token: RegexToken; next: number } {
  const nextChar = pattern[start + 1] ?? ''
  let end = start + 2

  if (nextChar === 'u') {
    if (pattern[start + 2] === '{') {
      const close = pattern.indexOf('}', start + 3)
      end = close === -1 ? pattern.length : close + 1
    } else {
      end = start + 6
    }
  } else if (nextChar === 'x') {
    end = start + 4
  } else if (nextChar === 'c' || nextChar === 'p' || nextChar === 'P') {
    end = start + 4
  } else if (/\d/.test(nextChar) && start > 0) {
    let i = start + 1
    while (i < start + 4 && /\d/.test(pattern[i] ?? '')) i++
    end = i
  }

  return {
    token: {
      type: 'escape',
      value: pattern.slice(start, end),
      start,
      end,
      groupName: ESCAPE_MAP[nextChar]
    },
    next: end
  }
}

function parseGroupHeader(pattern: string, start: number): {
  kind: RegexToken['groupKind']
  name?: string
  contentStart: number
} {
  if (pattern[start + 1] !== '?') {
    return { kind: 'capturing', contentStart: start + 1 }
  }

  const marker = pattern.slice(start + 1, start + 3)
  if (marker === '?:') return { kind: 'non-capturing', contentStart: start + 3 }
  if (marker === '?=') return { kind: 'lookahead', contentStart: start + 3 }
  if (marker === '?!') return { kind: 'negative-lookahead', contentStart: start + 3 }
  if (marker === '?<') {
    const close = pattern.indexOf('>', start + 3)
    const name = close === -1 ? undefined : pattern.slice(start + 3, close)
    return { kind: 'named', name, contentStart: close === -1 ? start + 3 : close + 1 }
  }
  if (pattern.slice(start + 1, start + 4) === '?<=') {
    return { kind: 'lookbehind', contentStart: start + 4 }
  }
  if (pattern.slice(start + 1, start + 4) === '?<!') {
    return { kind: 'negative-lookbehind', contentStart: start + 4 }
  }
  if (pattern[start + 2] === '>') return { kind: 'atomic', contentStart: start + 3 }
  if (pattern[start + 2] === '#') {
    const close = pattern.indexOf(')', start + 3)
    return { kind: 'comment', contentStart: close === -1 ? pattern.length : close + 1 }
  }

  return { kind: 'capturing', contentStart: start + 1 }
}

function tokenizeInternal(pattern: string, start: number, end: number): { tokens: RegexToken[]; errors: string[] } {
  const tokens: RegexToken[] = []
  const errors: string[] = []
  let i = start

  while (i < end) {
    const char = pattern[i]

    if (char === '\\') {
      const { token, next } = readEscape(pattern, i)
      const { token: quantifier, next: afterQuant } = readQuantifier(pattern, next)
      if (quantifier) token.quantifier = quantifier
      tokens.push(token)
      i = quantifier ? afterQuant : next
      continue
    }

    if (char === '[') {
      const result = readCharClass(pattern, i)
      if ('error' in result) {
        errors.push(result.error)
        break
      }
      const { token: quantifier, next: afterQuant } = readQuantifier(pattern, result.next)
      if (quantifier) result.token.quantifier = quantifier
      tokens.push(result.token)
      i = quantifier ? afterQuant : result.next
      continue
    }

    if (char === '(') {
      const header = parseGroupHeader(pattern, i)
      let depth = 1
      let j = header.contentStart
      let inCharClass = false
      while (j < end && depth > 0) {
        if (pattern[j] === '\\') {
          j += 2
          continue
        }
        if (pattern[j] === '[' && !inCharClass) {
          inCharClass = true
        } else if (pattern[j] === ']' && inCharClass) {
          inCharClass = false
        } else if (!inCharClass) {
          if (pattern[j] === '(') depth++
          if (pattern[j] === ')') depth--
        }
        if (depth > 0) j++
      }
      const groupEnd = depth === 0 ? j + 1 : end
      const innerStart = header.contentStart
      const innerEnd = depth === 0 ? j : end
      const inner = tokenizeInternal(pattern, innerStart, innerEnd)

      const groupToken: RegexToken = {
        type: 'group',
        value: pattern.slice(i, groupEnd),
        start: i,
        end: groupEnd,
        children: inner.tokens,
        groupKind: header.kind,
        groupName: header.name
      }

      if (depth !== 0) errors.push('分组 ( 未闭合')

      const { token: quantifier, next: afterQuant } = readQuantifier(pattern, groupEnd)
      if (quantifier) groupToken.quantifier = quantifier
      tokens.push(groupToken)
      errors.push(...inner.errors)
      i = quantifier ? afterQuant : groupEnd
      continue
    }

    if (char === '|') {
      tokens.push({ type: 'alternation', value: '|', start: i, end: i + 1 })
      i++
      continue
    }

    if (char === '^' || char === '$') {
      tokens.push({ type: 'anchor', value: char, start: i, end: i + 1 })
      i++
      continue
    }

    if (char === '.') {
      const dotToken: RegexToken = { type: 'dot', value: '.', start: i, end: i + 1 }
      const { token: quantifier, next: afterQuant } = readQuantifier(pattern, i + 1)
      if (quantifier) dotToken.quantifier = quantifier
      tokens.push(dotToken)
      i = quantifier ? afterQuant : i + 1
      continue
    }

    if (char === ')') {
      break
    }

    const literalToken: RegexToken = { type: 'literal', value: char, start: i, end: i + 1 }
    const { token: quantifier, next: afterQuant } = readQuantifier(pattern, i + 1)
    if (quantifier) literalToken.quantifier = quantifier
    tokens.push(literalToken)
    i = quantifier ? afterQuant : i + 1
  }

  return { tokens, errors }
}

export function tokenizeRegex(pattern: string): { tokens: RegexToken[]; errors: string[] } {
  if (!pattern) return { tokens: [], errors: [] }
  return tokenizeInternal(pattern, 0, pattern.length)
}

export const TOKEN_COLORS: Record<TokenType, string> = {
  literal: '#6b7280',
  escape: '#2563eb',
  charClass: '#059669',
  group: '#7c3aed',
  quantifier: '#ea580c',
  anchor: '#dc2626',
  alternation: '#ca8a04',
  dot: '#0891b2',
  backref: '#db2777'
}
