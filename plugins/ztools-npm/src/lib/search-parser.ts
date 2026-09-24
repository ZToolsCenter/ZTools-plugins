import type { ParsedQuery } from './types'

export function parseSearch(input: string): ParsedQuery {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'freeText', text: '' }

  // 内部含空白 → 多词自由文本（避免 "typescript @types" 被误判为 包+版本）
  if (/\s/.test(trimmed)) return { kind: 'freeText', text: trimmed }

  const atCount = [...trimmed].filter(c => c === '@').length
  if (atCount === 0) return { kind: 'freeText', text: trimmed }

  // 单 @：以 @ 开头且含 / 才是 scoped 包名（@scope/name）；纯 @x 按自由文本
  if (atCount === 1 && trimmed.startsWith('@')) {
    return trimmed.includes('/')
      ? { kind: 'package', name: trimmed }
      : { kind: 'freeText', text: trimmed }
  }

  // name@version / @scope/name@version：在最后一个 @ 处拆分（indexOf === lastIndexOf 当 atCount===1）
  const atIdx = trimmed.lastIndexOf('@')
  const name = trimmed.slice(0, atIdx).trim()
  const versionPrefix = trimmed.slice(atIdx + 1).trim()
  return versionPrefix ? { kind: 'package', name, versionPrefix } : { kind: 'package', name }
}
