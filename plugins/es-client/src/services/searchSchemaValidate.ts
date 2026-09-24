import Ajv, { type ErrorObject } from 'ajv'
import {
  SEARCH_BODY_SCHEMA,
  SEARCH_BODY_TOP_KEYS,
  SEARCH_QUERY_KEYS,
} from './searchBodySchema'

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false })
const validateSearch = ajv.compile(SEARCH_BODY_SCHEMA)

export type SchemaIssue = {
  severity: 'error' | 'warning'
  message: string
  path: string
}

export function isSearchPath(path: string): boolean {
  const p = path.split('?')[0].replace(/\/+$/, '')
  return /\/_search$/i.test(p) || p === '/_search'
}

export function validateSearchBodySchema(body: unknown): SchemaIssue[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ severity: 'error', message: '_search body 必须是 JSON 对象', path: '' }]
  }
  const ok = validateSearch(body)
  if (ok) return []
  const errs = (validateSearch.errors || []) as ErrorObject[]
  return errs.map((e) => {
    const path = e.instancePath || ''
    const msg = e.message || '不符合 _search schema'
    let message = path ? `${path}: ${msg}` : msg
    if (e.keyword === 'additionalProperties' && e.params && 'additionalProperty' in e.params) {
      message = `${path || '/'}: 未知属性「${(e.params as { additionalProperty: string }).additionalProperty}」`
    }
    if (e.keyword === 'required' && e.params && 'missingProperty' in e.params) {
      message = `${path || '/'}: 缺少必填属性「${(e.params as { missingProperty: string }).missingProperty}」`
    }
    return {
      severity: e.keyword === 'additionalProperties' ? 'warning' : 'error',
      message,
      path,
    }
  })
}

export function schemaPropertyHints(jsonPath: string[]): string[] {
  if (jsonPath.length === 0) return [...SEARCH_BODY_TOP_KEYS]

  if (jsonPath[0] === 'query') {
    if (jsonPath.length === 1) return [...SEARCH_QUERY_KEYS]
    if (jsonPath[1] === 'bool') {
      if (jsonPath.length === 2) {
        return ['must', 'filter', 'should', 'must_not', 'minimum_should_match', 'boost']
      }
      const boolKey = jsonPath[2]
      if (['must', 'filter', 'should', 'must_not'].includes(boolKey)) {
        return [...SEARCH_QUERY_KEYS]
      }
    }
    if (jsonPath[1] === 'nested' && jsonPath.length === 2) {
      return ['path', 'query', 'score_mode', 'ignore_unmapped']
    }
    if (jsonPath[1] === 'multi_match' && jsonPath.length === 2) {
      return ['query', 'fields', 'type', 'operator', 'fuzziness', 'boost']
    }
    if (jsonPath[1] === 'exists' && jsonPath.length === 2) return ['field']
    if (jsonPath[1] === 'constant_score' && jsonPath.length === 2) return ['filter', 'boost']
    if (jsonPath[1] === 'dis_max' && jsonPath.length === 2) return ['queries', 'tie_breaker']
    return []
  }

  if (jsonPath[0] === 'aggs' || jsonPath[0] === 'aggregations') {
    if (jsonPath.length >= 2) {
      return [
        'terms',
        'date_histogram',
        'histogram',
        'range',
        'filter',
        'filters',
        'nested',
        'avg',
        'sum',
        'min',
        'max',
        'cardinality',
        'stats',
        'top_hits',
        'aggs',
        'aggregations',
      ]
    }
    return []
  }

  if (jsonPath[0] === 'highlight' && jsonPath.length === 1) {
    return ['fields', 'pre_tags', 'post_tags', 'fragment_size', 'number_of_fragments']
  }
  if (jsonPath[0] === '_source' && jsonPath.length === 1) {
    return ['includes', 'excludes']
  }
  if (jsonPath[0] === 'collapse' && jsonPath.length === 1) {
    return ['field', 'inner_hits', 'max_concurrent_group_searches']
  }
  if (jsonPath[0] === 'knn' && jsonPath.length === 1) {
    return ['field', 'query_vector', 'k', 'num_candidates', 'filter', 'boost']
  }
  if (jsonPath[0] === 'pit' && jsonPath.length === 1) {
    return ['id', 'keep_alive']
  }

  return []
}

/**
 * Infer JSON object path and whether the cursor is typing a property key.
 */
export function inferJsonKeyContext(
  bodyText: string,
  offsetInBody: number,
): { path: string[]; typingKey: boolean; prefix: string } {
  const before = bodyText.slice(0, Math.max(0, Math.min(offsetInBody, bodyText.length)))

  let typingKey = false
  let prefix = ''
  const keyTail = before.match(/([{,]\s*)"([^"]*)$/)
  if (keyTail) {
    typingKey = true
    prefix = keyTail[2]
  }

  type Frame = { kind: 'obj' | 'arr'; key?: string }
  const stack: Frame[] = []
  let expectKey = true
  let lastKey: string | null = null
  let inStr = false
  let esc = false
  let strStart = -1

  for (let i = 0; i < before.length; i++) {
    const ch = before[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') {
        inStr = false
        const content = before.slice(strStart + 1, i)
        if (stack.length && stack[stack.length - 1].kind === 'obj' && expectKey) {
          lastKey = content
          expectKey = false
        }
      }
      continue
    }
    if (ch === '"') {
      inStr = true
      strStart = i
      continue
    }
    if (ch === '{') {
      if (lastKey != null && stack.length && stack[stack.length - 1].kind === 'obj') {
        stack.push({ kind: 'obj', key: lastKey })
      } else {
        stack.push({ kind: 'obj' })
      }
      lastKey = null
      expectKey = true
      continue
    }
    if (ch === '[') {
      if (lastKey != null && stack.length && stack[stack.length - 1].kind === 'obj') {
        stack.push({ kind: 'arr', key: lastKey })
      } else {
        stack.push({ kind: 'arr' })
      }
      lastKey = null
      expectKey = false
      continue
    }
    if (ch === '}' || ch === ']') {
      stack.pop()
      lastKey = null
      expectKey = !!(stack.length && stack[stack.length - 1].kind === 'obj')
      continue
    }
    if (ch === ':') {
      expectKey = false
      continue
    }
    if (ch === ',') {
      lastKey = null
      expectKey = !!(stack.length && stack[stack.length - 1].kind === 'obj')
      continue
    }
  }

  const path = stack.filter((f) => f.key).map((f) => f.key!) as string[]
  return { path, typingKey, prefix }
}
