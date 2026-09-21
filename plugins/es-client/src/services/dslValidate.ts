import type { DslIssue, MappingField } from '../types'

const TOP_LEVEL_KEYS = new Set([
  'query',
  'aggs',
  'aggregations',
  'sort',
  'size',
  'from',
  '_source',
  'highlight',
  'post_filter',
  'suggest',
  'collapse',
  'pit',
  'runtime_mappings',
  'timeout',
  'track_total_hits',
  'version',
  'seq_no_primary_term',
  'stored_fields',
  'script_fields',
  'docvalue_fields',
  'fields',
  'indices_boost',
  'min_score',
  'explain',
  'profile',
  'stats',
  'search_after',
  'slice',
  'rescore',
  'knn',
  'rank',
])

const QUERY_KEYS = new Set([
  'bool',
  'match',
  'match_all',
  'match_phrase',
  'match_phrase_prefix',
  'multi_match',
  'term',
  'terms',
  'range',
  'exists',
  'prefix',
  'wildcard',
  'regexp',
  'fuzzy',
  'ids',
  'nested',
  'constant_score',
  'dis_max',
  'function_score',
  'script',
  'script_score',
  'simple_query_string',
  'query_string',
  'geo_distance',
  'geo_bounding_box',
  'more_like_this',
  'percolate',
  'wrapper',
])

export function parseDslJson(text: string): { value: unknown; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { value: {}, error: undefined }
  try {
    return { value: JSON.parse(trimmed) }
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'JSON 解析失败' }
  }
}

export function validateSearchBody(
  body: unknown,
  fields: MappingField[] = [],
): DslIssue[] {
  const issues: DslIssue[] = []
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    issues.push({ severity: 'error', message: '_search body 必须是 JSON 对象' })
    return issues
  }

  const obj = body as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        severity: 'warning',
        message: `未知顶层字段「${key}」`,
        path: key,
      })
    }
  }

  if ('size' in obj && typeof obj.size !== 'number') {
    issues.push({ severity: 'error', message: 'size 必须是数字', path: 'size' })
  }
  if ('from' in obj && typeof obj.from !== 'number') {
    issues.push({ severity: 'error', message: 'from 必须是数字', path: 'from' })
  }
  if ('query' in obj) {
    if (obj.query === null || typeof obj.query !== 'object' || Array.isArray(obj.query)) {
      issues.push({ severity: 'error', message: 'query 必须是对象', path: 'query' })
    } else {
      validateQueryNode(obj.query as Record<string, unknown>, 'query', issues, fields)
    }
  }
  if ('sort' in obj) {
    const sort = obj.sort
    if (!Array.isArray(sort) && typeof sort !== 'object' && typeof sort !== 'string') {
      issues.push({ severity: 'error', message: 'sort 格式无效', path: 'sort' })
    }
  }

  return issues
}

function validateQueryNode(
  node: Record<string, unknown>,
  path: string,
  issues: DslIssue[],
  fields: MappingField[],
): void {
  const keys = Object.keys(node)
  if (keys.length === 0) {
    issues.push({ severity: 'warning', message: '空 query 对象', path })
    return
  }
  for (const key of keys) {
    if (!QUERY_KEYS.has(key)) {
      issues.push({
        severity: 'warning',
        message: `少见的 query 类型「${key}」`,
        path: `${path}.${key}`,
      })
    }
    if (key === 'bool') {
      const bool = node.bool
      if (!bool || typeof bool !== 'object' || Array.isArray(bool)) {
        issues.push({ severity: 'error', message: 'bool 必须是对象', path: `${path}.bool` })
        continue
      }
      const b = bool as Record<string, unknown>
      for (const clause of ['must', 'should', 'filter', 'must_not'] as const) {
        const v = b[clause]
        if (v === undefined) continue
        const list = Array.isArray(v) ? v : [v]
        list.forEach((item, i) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            validateQueryNode(item as Record<string, unknown>, `${path}.bool.${clause}[${i}]`, issues, fields)
          }
        })
      }
    }
    if (key === 'term' || key === 'match' || key === 'range' || key === 'match_phrase') {
      const clause = node[key]
      if (clause && typeof clause === 'object' && !Array.isArray(clause)) {
        for (const field of Object.keys(clause as object)) {
          warnFieldType(field, key, fields, `${path}.${key}.${field}`, issues)
        }
      }
    }
  }
}

function warnFieldType(
  field: string,
  queryType: string,
  fields: MappingField[],
  path: string,
  issues: DslIssue[],
): void {
  if (!fields.length) return
  const hit = fields.find((f) => f.path === field)
  if (!hit) {
    const partial = fields.some((f) => f.path.startsWith(field + '.') || field.startsWith(f.path + '.'))
    if (!partial) {
      issues.push({
        severity: 'warning',
        message: `字段「${field}」不在当前 mapping 中`,
        path,
      })
    }
    return
  }
  if (queryType === 'term' && hit.type === 'text') {
    issues.push({
      severity: 'warning',
      message: `「${field}」是 text，term 查询通常应使用 ${field}.keyword`,
      path,
    })
  }
}

export function flattenMappingProperties(
  mappingRoot: unknown,
  prefix = '',
): MappingField[] {
  const out: MappingField[] = []
  if (!mappingRoot || typeof mappingRoot !== 'object') return out

  // GET /{index}/_mapping → { indexName: { mappings: { properties: {...} } } }
  const root = mappingRoot as Record<string, unknown>
  const values = Object.values(root)
  for (const idx of values) {
    if (!idx || typeof idx !== 'object') continue
    const mappings = (idx as { mappings?: { properties?: Record<string, unknown> } }).mappings
    const props = mappings?.properties
    if (props) walkProps(props, prefix, out)
  }
  return out
}

function walkProps(
  props: Record<string, unknown>,
  prefix: string,
  out: MappingField[],
): void {
  for (const [name, def] of Object.entries(props)) {
    if (!def || typeof def !== 'object') continue
    const d = def as {
      type?: string
      properties?: Record<string, unknown>
      fields?: Record<string, unknown>
    }
    const path = prefix ? `${prefix}.${name}` : name
    if (d.type) {
      out.push({ path, type: d.type })
    }
    if (d.properties) walkProps(d.properties, path, out)
    if (d.fields) {
      for (const [sub, subDef] of Object.entries(d.fields)) {
        const t = (subDef as { type?: string })?.type ?? 'keyword'
        out.push({ path: `${path}.${sub}`, type: t })
      }
    }
  }
}

export const DSL_COMPLETION_KEYWORDS = [
  'query',
  'bool',
  'must',
  'should',
  'filter',
  'must_not',
  'match',
  'match_all',
  'term',
  'terms',
  'range',
  'aggs',
  'aggregations',
  'sort',
  'size',
  'from',
  '_source',
  'exists',
  'prefix',
  'wildcard',
]
