import type { ParsedQuery } from './types'

const SOLR_OPERATORS = /\b(AND|OR|NOT)\b/i
const HAS_PARENS = /[()]/

export function parseSearch(input: string): ParsedQuery {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { kind: 'freeText', freeText: '' }
  }

  if (SOLR_OPERATORS.test(trimmed) || HAS_PARENS.test(trimmed)) {
    return { kind: 'rawQuery', rawQuery: trimmed }
  }

  const parts = trimmed.split(':')
  if (parts.length === 1) {
    return { kind: 'freeText', freeText: parts[0].trim() }
  }

  if (parts.length === 2) {
    const [first, second] = parts
    if (first === 'g') return { kind: 'scoped', g: second.trim() }
    if (first === 'a') return { kind: 'scoped', a: second.trim() }
    if (first === 'v') return { kind: 'scoped', v: second.trim() }
    return {
      kind: 'scoped',
      g: first.trim(),
      a: second.trim(),
    }
  }

  const [g, a, ...rest] = parts
  return {
    kind: 'scoped',
    g: g.trim(),
    a: a.trim(),
    v: rest.map(s => s.trim()).join(':'),
  }
}
