import type { RegexToken } from './regexTokenizer'

const ESCAPE_DESC: Record<string, string> = {
  d: '一位数字（0-9）',
  D: '一个非数字字符',
  w: '字母、数字或下划线',
  W: '一个非单词字符',
  s: '空白（空格、换行、制表符等）',
  S: '一个非空白字符',
  b: '单词边界',
  B: '非单词边界',
  n: '换行',
  r: '回车',
  t: '制表符',
  f: '换页',
  v: '垂直制表符',
  '0': '空字符'
}

function explainQuantifier(q: RegexToken): string {
  const v = q.value
  if (v === '*') return '出现任意次（可以为 0 次）'
  if (v === '+') return '至少出现 1 次'
  if (v === '?') return '可有可无（最多 1 次）'
  if (v.startsWith('{')) {
    const inner = v.slice(1, -1)
    if (inner.includes(',')) {
      const [min, max] = inner.split(',')
      if (max === '') return `至少连续出现 ${min} 次`
      if (min === max) return `必须刚好出现 ${min} 次`
      return `连续出现 ${min} 到 ${max} 次`
    }
    return `必须刚好出现 ${inner} 次`
  }
  return `重复 ${v} 次`
}

function classPartLabel(part: string): string {
  if (part === '\\d') return '数字'
  if (part === '\\w') return '单词字符'
  if (part === '\\s') return '空白'
  if (part === '\\D') return '非数字'
  if (part === '\\W') return '非单词字符'
  if (part === '\\S') return '非空白'
  if (part.startsWith('\\')) return part.slice(1)
  return part
}

function parseCharClassParts(body: string): string[] {
  const parts: string[] = []
  let i = 0

  while (i < body.length) {
    let token = ''
    if (body[i] === '\\') {
      token = body.slice(i, i + 2)
      i += 2
    } else {
      token = body[i]
      i += 1
    }

    if (i < body.length && body[i] === '-' && i + 1 < body.length) {
      let endToken = ''
      i += 1
      if (body[i] === '\\') {
        endToken = body.slice(i, i + 2)
        i += 2
      } else {
        endToken = body[i]
        i += 1
      }
      parts.push(`${classPartLabel(token)} 到 ${classPartLabel(endToken)} 之间的字符`)
    } else {
      parts.push(`「${classPartLabel(token)}」`)
    }
  }

  return parts
}

function explainCharClass(value: string): string {
  const inner = value.slice(1, -1)
  const negated = inner.startsWith('^')
  const body = negated ? inner.slice(1) : inner

  if (body === '\\d') return negated ? '不能是数字' : '任意一个数字'
  if (body === '\\w') return negated ? '不能是字母数字下划线' : '字母、数字或下划线'
  if (body === '\\s') return negated ? '不能是空白' : '空白字符'
  if (body === '\\D') return '不能是数字'
  if (body === '\\W') return '不能是单词字符'
  if (body === '\\S') return '不能是空白'

  if (body.includes('-')) {
    const rangeDesc = parseCharClassParts(body).join('、')
    return negated ? `不能是：${rangeDesc}` : `只能是：${rangeDesc}`
  }

  const chars = body.replace(/\\(.)/g, '$1')
  return negated ? `不能是「${chars}」里的字符` : `只能是「${chars}」里的字符`
}

function explainEscape(value: string): string {
  const code = value.slice(1)
  if (ESCAPE_DESC[code[0]]) return ESCAPE_DESC[code[0]]
  if (code.startsWith('u{')) return `Unicode 字符 U+${code.slice(2, -1)}`
  if (code.startsWith('u')) return `Unicode 字符 U+${code.slice(1)}`
  if (code.startsWith('x')) return `十六进制字符 x${code.slice(1)}`
  if (code.startsWith('p{')) return `符合 ${code.slice(2, -1)} 属性的字符`
  if (code.startsWith('P{')) return `不符合 ${code.slice(2, -1)} 属性的字符`
  if (/^\d+$/.test(code)) return `引用前面第 ${code} 个括号里的内容`
  return `特殊字符「${code}」`
}

function explainGroupKind(kind: RegexToken['groupKind'], name?: string): string {
  switch (kind) {
    case 'non-capturing':
      return '一组规则（不计入捕获）'
    case 'lookahead':
      return '后面必须满足'
    case 'negative-lookahead':
      return '后面不能满足'
    case 'lookbehind':
      return '前面必须满足'
    case 'negative-lookbehind':
      return '前面不能满足'
    case 'named':
      return `记名为「${name ?? ''}」的一组`
    case 'atomic':
      return '一组原子规则（匹配后不回退）'
    case 'comment':
      return '注释（不参与匹配）'
    default:
      return '一组可捕获的规则'
  }
}

function explainToken(token: RegexToken): string {
  let desc: string

  switch (token.type) {
    case 'literal':
      desc = `固定匹配「${token.value}」`
      break
    case 'escape':
      desc = explainEscape(token.value)
      break
    case 'charClass':
      desc = explainCharClass(token.value)
      break
    case 'group': {
      const kind = explainGroupKind(token.groupKind, token.groupName)
      const inner = token.children?.length ? explainTokensPlain(token.children) : '空'
      desc = `${kind}：${inner}`
      break
    }
    case 'quantifier':
      desc = explainQuantifier(token)
      break
    case 'anchor':
      desc = token.value === '^' ? '从开头开始' : '到结尾结束'
      break
    case 'alternation':
      desc = '或者'
      break
    case 'dot':
      desc = '任意一个字符（默认不含换行）'
      break
    case 'backref':
      desc = `再次匹配第 ${token.value} 组的内容`
      break
    default:
      desc = token.value
  }

  if (token.quantifier) {
    desc += `，${explainQuantifier(token.quantifier)}`
  }

  return desc
}

function explainTokensPlain(tokens: RegexToken[]): string {
  const parts: string[] = []
  for (const token of tokens) {
    if (token.type === 'alternation') {
      parts.push('，或者 ')
      continue
    }
    parts.push(explainToken(token))
  }
  let text = parts.join('')
  if (text.startsWith('，')) text = text.slice(1)
  return text
}

function toPlainSummary(text: string): string {
  return text
    .replace(/，或者/g, '；或者')
    .replace(/固定匹配「(\d)」/g, '数字 $1')
    .replace(/固定匹配「([^」]+)」/g, '字符「$1」')
    .replace(/从开头开始/g, '从头开始')
    .replace(/到结尾结束/g, '一直匹配到末尾')
    .replace(/；+/g, '；')
}

export interface ExplanationResult {
  summary: string
  parts: { token: string; description: string; type: RegexToken['type'] }[]
  errors: string[]
}

export function explainRegex(pattern: string, tokens: RegexToken[], errors: string[]): ExplanationResult {
  if (!pattern) {
    return { summary: '输入正则后，这里会用大白话解释它的匹配规则', parts: [], errors: [] }
  }

  if (errors.length) {
    return {
      summary: `正则写错了：${errors.join('；')}`,
      parts: [],
      errors
    }
  }

  const parts = tokens.map((t) => ({
    token: t.value,
    description: explainToken(t),
    type: t.type
  }))

  const raw = explainTokensPlain(tokens)
  const summary = toPlainSummary(raw ? `整体来说：${raw}` : '空规则')

  return { summary, parts, errors }
}
