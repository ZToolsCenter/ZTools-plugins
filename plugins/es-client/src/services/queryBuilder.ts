export type QueryOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'exists'
  | 'not_exists'
  | 'starts_with'
  | 'ends_with'

export type CombineMode = 'must' | 'should'

export type SearchCondition = {
  id: string
  kind: 'condition'
  field: string
  operator: QueryOperator
  value: string
  valueTo?: string
}

export type QueryGroup = {
  id: string
  kind: 'group'
  combine: CombineMode
  children: QueryNode[]
}

export type QueryNode = SearchCondition | QueryGroup

export const OPERATOR_OPTIONS: Array<{
  value: QueryOperator
  label: string
  needsValue: boolean
  needsRange?: boolean
}> = [
  { value: 'eq', label: '等于', needsValue: true },
  { value: 'neq', label: '不等于', needsValue: true },
  { value: 'contains', label: '包含', needsValue: true },
  { value: 'not_contains', label: '不包含', needsValue: true },
  { value: 'gt', label: '大于', needsValue: true },
  { value: 'gte', label: '大于等于', needsValue: true },
  { value: 'lt', label: '小于', needsValue: true },
  { value: 'lte', label: '小于等于', needsValue: true },
  { value: 'between', label: '介于', needsValue: true, needsRange: true },
  { value: 'starts_with', label: '开头是', needsValue: true },
  { value: 'ends_with', label: '结尾是', needsValue: true },
  { value: 'exists', label: '有值', needsValue: false },
  { value: 'not_exists', label: '无值', needsValue: false },
]

export function isGroup(node: QueryNode): node is QueryGroup {
  return node.kind === 'group'
}

export function newCondition(partial?: Partial<Omit<SearchCondition, 'kind'>>): SearchCondition {
  return {
    id: crypto.randomUUID(),
    field: '',
    operator: 'eq',
    value: '',
    valueTo: '',
    ...partial,
    kind: 'condition',
  }
}

export function newGroup(partial?: Partial<Omit<QueryGroup, 'kind'>>): QueryGroup {
  return {
    id: crypto.randomUUID(),
    combine: 'must',
    children: [newCondition()],
    ...partial,
    kind: 'group',
  }
}

function isNumericLike(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v.trim())
}

function coerceValue(raw: string): string | number | boolean {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (isNumericLike(v)) return Number(v)
  return v
}

function valueToString(v: unknown): string {
  if (v === undefined || v === null) return ''
  return String(v)
}

function isCompleteCondition(cond: SearchCondition): boolean {
  if (!cond.field.trim()) return false
  const meta = OPERATOR_OPTIONS.find((o) => o.value === cond.operator)
  if (meta?.needsValue && !String(cond.value ?? '').trim()) return false
  if (meta?.needsRange && !String(cond.valueTo ?? '').trim()) return false
  return true
}

function clauseFor(cond: SearchCondition): unknown | null {
  if (!isCompleteCondition(cond)) return null
  const field = cond.field.trim()
  const op = cond.operator
  const value = cond.value
  const valueTo = cond.valueTo ?? ''

  switch (op) {
    case 'eq':
      return isNumericLike(value) || value === 'true' || value === 'false'
        ? { term: { [field]: coerceValue(value) } }
        : { match_phrase: { [field]: value } }
    case 'neq':
      return {
        bool: {
          must_not: [
            isNumericLike(value) || value === 'true' || value === 'false'
              ? { term: { [field]: coerceValue(value) } }
              : { match_phrase: { [field]: value } },
          ],
        },
      }
    case 'contains':
      return { wildcard: { [field]: `*${value}*` } }
    case 'not_contains':
      return {
        bool: {
          must_not: [{ wildcard: { [field]: `*${value}*` } }],
        },
      }
    case 'gt':
      return { range: { [field]: { gt: coerceValue(value) } } }
    case 'gte':
      return { range: { [field]: { gte: coerceValue(value) } } }
    case 'lt':
      return { range: { [field]: { lt: coerceValue(value) } } }
    case 'lte':
      return { range: { [field]: { lte: coerceValue(value) } } }
    case 'between':
      return {
        range: {
          [field]: {
            gte: coerceValue(value),
            lte: coerceValue(valueTo),
          },
        },
      }
    case 'starts_with':
      return { wildcard: { [field]: `${value}*` } }
    case 'ends_with':
      return { wildcard: { [field]: `*${value}` } }
    case 'exists':
      return { exists: { field } }
    case 'not_exists':
      return { bool: { must_not: [{ exists: { field } }] } }
    default:
      return null
  }
}

function buildGroupQuery(group: QueryGroup): Record<string, unknown> | null {
  const clauses: unknown[] = []
  for (const child of group.children) {
    if (isGroup(child)) {
      const nested = buildGroupQuery(child)
      if (nested) clauses.push(nested)
    } else {
      const c = clauseFor(child)
      if (c) clauses.push(c)
    }
  }
  if (clauses.length === 0) return null
  if (clauses.length === 1) {
    return clauses[0] as Record<string, unknown>
  }
  if (group.combine === 'should') {
    return { bool: { should: clauses, minimum_should_match: 1 } }
  }
  return { bool: { must: clauses } }
}

export function buildSearchBody(options: {
  root: QueryGroup
  size: number
  from?: number
}): { body: Record<string, unknown>; errors: string[] } {
  // Incomplete condition rows are skipped; none complete → match_all.
  const built = buildGroupQuery(options.root)
  const query = built ?? { match_all: {} }

  const body: Record<string, unknown> = { query, size: options.size }
  if (options.from && options.from > 0) body.from = options.from
  return { body, errors: [] }
}

function firstEntry(obj: Record<string, unknown>): [string, unknown] | null {
  const e = Object.entries(obj)[0]
  return e ?? null
}

function negateCondition(cond: SearchCondition): SearchCondition | null {
  const map: Partial<Record<QueryOperator, QueryOperator>> = {
    eq: 'neq',
    neq: 'eq',
    contains: 'not_contains',
    not_contains: 'contains',
    exists: 'not_exists',
    not_exists: 'exists',
  }
  const next = map[cond.operator]
  if (!next) return null
  return { ...cond, id: crypto.randomUUID(), operator: next }
}

function parseWildcard(field: string, raw: string): SearchCondition {
  if (raw.startsWith('*') && raw.endsWith('*') && raw.length >= 2) {
    return newCondition({ field, operator: 'contains', value: raw.slice(1, -1) })
  }
  if (raw.endsWith('*') && !raw.startsWith('*')) {
    return newCondition({ field, operator: 'starts_with', value: raw.slice(0, -1) })
  }
  if (raw.startsWith('*') && !raw.endsWith('*')) {
    return newCondition({ field, operator: 'ends_with', value: raw.slice(1) })
  }
  return newCondition({ field, operator: 'contains', value: raw })
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

export function parseClause(clause: unknown): { node: QueryNode | null; error?: string } {
  if (!clause || typeof clause !== 'object') {
    return { node: null, error: '无法识别的查询子句' }
  }
  const c = clause as Record<string, unknown>

  if ('match_all' in c) {
    return { node: newGroup({ children: [newCondition()] }) }
  }

  if (c.term && typeof c.term === 'object') {
    const e = firstEntry(c.term as Record<string, unknown>)
    if (!e) return { node: null, error: 'term 缺少字段' }
    return { node: newCondition({ field: e[0], operator: 'eq', value: valueToString(e[1]) }) }
  }

  if (c.match_phrase && typeof c.match_phrase === 'object') {
    const e = firstEntry(c.match_phrase as Record<string, unknown>)
    if (!e) return { node: null, error: 'match_phrase 缺少字段' }
    const val =
      e[1] && typeof e[1] === 'object' && e[1] !== null && 'query' in (e[1] as object)
        ? valueToString((e[1] as { query: unknown }).query)
        : valueToString(e[1])
    return { node: newCondition({ field: e[0], operator: 'eq', value: val }) }
  }

  if (c.match && typeof c.match === 'object') {
    const e = firstEntry(c.match as Record<string, unknown>)
    if (!e) return { node: null, error: 'match 缺少字段' }
    const val =
      e[1] && typeof e[1] === 'object' && e[1] !== null && 'query' in (e[1] as object)
        ? valueToString((e[1] as { query: unknown }).query)
        : valueToString(e[1])
    return { node: newCondition({ field: e[0], operator: 'eq', value: val }) }
  }

  if (c.wildcard && typeof c.wildcard === 'object') {
    const e = firstEntry(c.wildcard as Record<string, unknown>)
    if (!e) return { node: null, error: 'wildcard 缺少字段' }
    const raw =
      e[1] && typeof e[1] === 'object' && e[1] !== null && 'value' in (e[1] as object)
        ? valueToString((e[1] as { value: unknown }).value)
        : valueToString(e[1])
    return { node: parseWildcard(e[0], raw) }
  }

  if (c.range && typeof c.range === 'object') {
    const e = firstEntry(c.range as Record<string, unknown>)
    if (!e || typeof e[1] !== 'object' || e[1] === null) {
      return { node: null, error: 'range 格式无效' }
    }
    const r = e[1] as Record<string, unknown>
    if ('gte' in r && 'lte' in r) {
      return {
        node: newCondition({
          field: e[0],
          operator: 'between',
          value: valueToString(r.gte),
          valueTo: valueToString(r.lte),
        }),
      }
    }
    if ('gt' in r) return { node: newCondition({ field: e[0], operator: 'gt', value: valueToString(r.gt) }) }
    if ('gte' in r) return { node: newCondition({ field: e[0], operator: 'gte', value: valueToString(r.gte) }) }
    if ('lt' in r) return { node: newCondition({ field: e[0], operator: 'lt', value: valueToString(r.lt) }) }
    if ('lte' in r) return { node: newCondition({ field: e[0], operator: 'lte', value: valueToString(r.lte) }) }
    return { node: null, error: `不支持的 range：${e[0]}` }
  }

  if (c.exists && typeof c.exists === 'object') {
    const field = valueToString((c.exists as { field?: unknown }).field)
    if (!field) return { node: null, error: 'exists 缺少 field' }
    return { node: newCondition({ field, operator: 'exists', value: '' }) }
  }

  if (c.bool && typeof c.bool === 'object') {
    const b = c.bool as Record<string, unknown>
    const mustNot = asArray(b.must_not)
    const must = asArray(b.must)
    const filter = asArray(b.filter)
    const should = asArray(b.should)

    if (mustNot.length && !must.length && !filter.length && !should.length) {
      if (mustNot.length === 1) {
        const inner = parseClause(mustNot[0])
        if (inner.error) return inner
        if (inner.node && !isGroup(inner.node)) {
          const neg = negateCondition(inner.node)
          if (neg) return { node: neg }
        }
      }
      const children: QueryNode[] = []
      for (const item of mustNot) {
        const parsed = parseClause(item)
        if (parsed.error || !parsed.node) {
          return { node: null, error: parsed.error || 'must_not 子句无法解析' }
        }
        if (!isGroup(parsed.node)) {
          const neg = negateCondition(parsed.node)
          if (!neg) return { node: null, error: `无法取反运算符：${parsed.node.operator}` }
          children.push(neg)
        } else {
          return { node: null, error: '暂不支持 must_not 嵌套组的直接回显' }
        }
      }
      return { node: newGroup({ combine: 'must', children }) }
    }

    if (should.length && !must.length && !filter.length && !mustNot.length) {
      const children: QueryNode[] = []
      for (const item of should) {
        const parsed = parseClause(item)
        if (parsed.error || !parsed.node) {
          return { node: null, error: parsed.error || 'should 子句无法解析' }
        }
        children.push(parsed.node)
      }
      return { node: newGroup({ combine: 'should', children }) }
    }

    const positive = [...must, ...filter]
    if (positive.length && !should.length && !mustNot.length) {
      const children: QueryNode[] = []
      for (const item of positive) {
        const parsed = parseClause(item)
        if (parsed.error || !parsed.node) {
          return { node: null, error: parsed.error || 'must 子句无法解析' }
        }
        children.push(parsed.node)
      }
      return { node: newGroup({ combine: 'must', children }) }
    }

    // Mixed bool: wrap positives as must group, should as nested, must_not as negated leafs
    const children: QueryNode[] = []
    for (const item of positive) {
      const parsed = parseClause(item)
      if (parsed.error || !parsed.node) return { node: null, error: parsed.error || 'bool 子句无法解析' }
      children.push(parsed.node)
    }
    if (should.length) {
      const shouldChildren: QueryNode[] = []
      for (const item of should) {
        const parsed = parseClause(item)
        if (parsed.error || !parsed.node) return { node: null, error: parsed.error || 'should 无法解析' }
        shouldChildren.push(parsed.node)
      }
      children.push(newGroup({ combine: 'should', children: shouldChildren }))
    }
    for (const item of mustNot) {
      const parsed = parseClause(item)
      if (parsed.error || !parsed.node || isGroup(parsed.node)) {
        return { node: null, error: parsed.error || 'must_not 无法解析' }
      }
      const neg = negateCondition(parsed.node)
      if (!neg) return { node: null, error: `无法取反：${parsed.node.operator}` }
      children.push(neg)
    }
    if (!children.length) return { node: null, error: '空的 bool 查询' }
    return { node: newGroup({ combine: 'must', children }) }
  }

  return { node: null, error: `不支持的查询类型：${Object.keys(c).join(',') || 'unknown'}` }
}

export function parseSearchBody(input: unknown): {
  root: QueryGroup | null
  size?: number
  from?: number
  errors: string[]
} {
  if (!input || typeof input !== 'object') {
    return { root: null, errors: ['请提供有效的查询 JSON 对象'] }
  }
  const body = input as Record<string, unknown>
  if (!('query' in body)) {
    return { root: null, errors: ['缺少 query 字段'] }
  }
  const parsed = parseClause(body.query)
  if (parsed.error || !parsed.node) {
    return { root: null, errors: [parsed.error || '无法解析 query'] }
  }
  const root = isGroup(parsed.node)
    ? parsed.node
    : newGroup({ children: [parsed.node] })

  return {
    root,
    size: typeof body.size === 'number' ? body.size : undefined,
    from: typeof body.from === 'number' ? body.from : undefined,
    errors: [],
  }
}

/** @deprecated flat API kept for simple callers — wraps as single group */
export function buildSearchBodyFlat(options: {
  conditions: SearchCondition[]
  combine: CombineMode
  size: number
  from?: number
}): { body: Record<string, unknown>; errors: string[] } {
  return buildSearchBody({
    root: newGroup({
      combine: options.combine,
      children: options.conditions.map((c) => ({ ...c, kind: 'condition' as const })),
    }),
    size: options.size,
    from: options.from,
  })
}
