import { describe, expect, it } from 'vitest'
import { MemoryDb } from '../src/services/db'
import {
  deleteConnection,
  listConnections,
  saveConnection,
  setActiveConnection,
} from '../src/services/connectionStore'
import {
  flattenMappingProperties,
  parseDslJson,
  validateSearchBody,
} from '../src/services/dslValidate'

describe('connectionStore', () => {
  it('saves, lists, activates, deletes', async () => {
    const db = new MemoryDb()
    const a = await saveConnection(
      {
        name: 'local',
        baseUrl: 'http://localhost:9200/',
        authType: 'basic',
        username: 'elastic',
        password: 'secret',
      },
      undefined,
      db,
    )
    expect(a.baseUrl).toBe('http://localhost:9200')
    expect(a._id.startsWith('conn:')).toBe(true)

    const list = await listConnections(db)
    expect(list).toHaveLength(1)

    await setActiveConnection(a._id, db)

    const updated = await saveConnection(
      {
        name: 'local-edited',
        baseUrl: 'http://127.0.0.1:9200',
        authType: 'basic',
        username: 'elastic',
        password: 'secret2',
      },
      a._id,
      db,
    )
    expect(updated._id).toBe(a._id)
    expect(updated.name).toBe('local-edited')
    expect(updated.baseUrl).toBe('http://127.0.0.1:9200')
    expect(updated.password).toBe('secret2')
    expect(await listConnections(db)).toHaveLength(1)

    await deleteConnection(a._id, db)
    expect(await listConnections(db)).toHaveLength(0)
  })
})

describe('dslValidate', () => {
  it('rejects invalid json', () => {
    const r = parseDslJson('{')
    expect(r.error).toBeTruthy()
  })

  it('validates size type and unknown keys', () => {
    const issues = validateSearchBody({ size: '10', foo: 1, query: { match_all: {} } })
    expect(issues.some((i) => i.path === 'size' && i.severity === 'error')).toBe(true)
    expect(issues.some((i) => i.path === 'foo')).toBe(true)
  })

  it('warns term on text field', () => {
    const fields = [{ path: 'title', type: 'text' }, { path: 'title.keyword', type: 'keyword' }]
    const issues = validateSearchBody(
      { query: { term: { title: 'x' } } },
      fields,
    )
    expect(issues.some((i) => i.message.includes('.keyword'))).toBe(true)
  })

  it('flattens mapping', () => {
    const mapping = {
      demo: {
        mappings: {
          properties: {
            title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            meta: { properties: { count: { type: 'long' } } },
          },
        },
      },
    }
    const fields = flattenMappingProperties(mapping)
    expect(fields.find((f) => f.path === 'title')?.type).toBe('text')
    expect(fields.find((f) => f.path === 'title.keyword')?.type).toBe('keyword')
    expect(fields.find((f) => f.path === 'meta.count')?.type).toBe('long')
  })
})

describe('queryBuilder', () => {
  it('builds match_all when group has no children', async () => {
    const { buildSearchBody, newGroup } = await import('../src/services/queryBuilder')
    const { body, errors } = buildSearchBody({
      root: newGroup({ children: [] }),
      size: 20,
    })
    expect(errors).toEqual([])
    expect(body.query).toEqual({ match_all: {} })
  })

  it('builds match_all when no field filled', async () => {
    const { buildSearchBody, newGroup, newCondition } = await import('../src/services/queryBuilder')
    const { body, errors } = buildSearchBody({
      root: newGroup({ children: [newCondition()] }),
      size: 20,
    })
    expect(errors).toEqual([])
    expect(body.query).toEqual({ match_all: {} })
  })

  it('builds match_all when field selected but value empty', async () => {
    const { buildSearchBody, newGroup, newCondition } = await import('../src/services/queryBuilder')
    const { body, errors } = buildSearchBody({
      root: newGroup({
        children: [newCondition({ field: 'title', operator: 'eq', value: '' })],
      }),
      size: 20,
    })
    expect(errors).toEqual([])
    expect(body.query).toEqual({ match_all: {} })
  })

  it('skips incomplete rows and keeps complete ones', async () => {
    const { buildSearchBody, newGroup, newCondition } = await import('../src/services/queryBuilder')
    const { body, errors } = buildSearchBody({
      root: newGroup({
        children: [
          newCondition({ field: 'title', operator: 'contains', value: 'es' }),
          newCondition({ field: 'age', operator: 'gt', value: '' }),
          newCondition(),
        ],
      }),
      size: 10,
    })
    expect(errors).toEqual([])
    expect(body.query).toEqual({
      wildcard: { title: '*es*' },
    })
  })

  it('builds nested AND / OR', async () => {
    const { buildSearchBody, newGroup, newCondition } = await import('../src/services/queryBuilder')
    const { body, errors } = buildSearchBody({
      root: newGroup({
        combine: 'must',
        children: [
          newCondition({ field: 'title', operator: 'contains', value: 'es' }),
          newGroup({
            combine: 'should',
            children: [
              newCondition({ field: 'age', operator: 'gt', value: '18' }),
              newCondition({ field: 'age', operator: 'lt', value: '10' }),
            ],
          }),
        ],
      }),
      size: 10,
    })
    expect(errors).toEqual([])
    expect(body).toMatchObject({
      size: 10,
      query: {
        bool: {
          must: [
            { wildcard: { title: '*es*' } },
            {
              bool: {
                should: [
                  { range: { age: { gt: 18 } } },
                  { range: { age: { lt: 10 } } },
                ],
                minimum_should_match: 1,
              },
            },
          ],
        },
      },
    })
  })

  it('parses query JSON back to tree', async () => {
    const { parseSearchBody, isGroup } = await import('../src/services/queryBuilder')
    const { root, errors } = parseSearchBody({
      size: 5,
      query: {
        bool: {
          must: [
            { match_phrase: { title: 'hello' } },
            { range: { age: { gt: 18 } } },
          ],
        },
      },
    })
    expect(errors).toEqual([])
    expect(root).toBeTruthy()
    expect(isGroup(root!)).toBe(true)
    expect(root!.combine).toBe('must')
    expect(root!.children).toHaveLength(2)
  })
})

describe('searchRequestText', () => {
  it('formats GET /index/_search with body', async () => {
    const { formatSearchRequestText } = await import('../src/services/searchRequestText')
    const text = formatSearchRequestText('demo', { query: { match_all: {} }, size: 20 })
    expect(text.startsWith('GET /demo/_search\n')).toBe(true)
    expect(text).toContain('"match_all"')
  })

  it('parses Dev Tools request and validates index', async () => {
    const { applySearchRequestText } = await import('../src/services/searchRequestText')
    const text = `GET /demo/_search
{
  "query": { "match_all": {} },
  "size": 10
}`
    const ok = applySearchRequestText(text, { availableIndices: ['demo', 'other'] })
    expect(ok.ok).toBe(true)
    expect(ok.envelope?.index).toBe('demo')
    expect(ok.size).toBe(10)
    expect(ok.root).toBeTruthy()

    const bad = applySearchRequestText(text, { availableIndices: ['other'] })
    expect(bad.ok).toBe(false)
    expect(bad.errors.some((e) => e.includes('不存在'))).toBe(true)
  })

  it('rejects invalid JSON body', async () => {
    const { parseSearchRequestText } = await import('../src/services/searchRequestText')
    const r = parseSearchRequestText('GET /demo/_search\n{')
    expect(r.errors.length).toBeGreaterThan(0)
  })
})


describe('restValidate', () => {
  it('flags invalid JSON body', async () => {
    const { validateRestRequest, restHasBlockingError } = await import('../src/services/restValidate')
    const hints = validateRestRequest('POST', '/_search', '{')
    expect(restHasBlockingError(hints)).toBe(true)
    expect(hints.some((h) => h.severity === 'error')).toBe(true)
  })

  it('allows GET with JSON body without ignore warning', async () => {
    const { validateRestRequest } = await import('../src/services/restValidate')
    const hints = validateRestRequest('GET', '/demo/_search', '{"query":{"match_all":{}}}')
    expect(hints.some((h) => h.message.includes('忽略'))).toBe(false)
    expect(hints.some((h) => h.severity === 'error')).toBe(false)
  })

  it('warns when HEAD has body', async () => {
    const { validateRestRequest } = await import('../src/services/restValidate')
    const hints = validateRestRequest('HEAD', '/demo', '{"a":1}')
    expect(hints.some((h) => h.severity === 'warning' && h.message.includes('HEAD'))).toBe(true)
  })

  it('accepts valid path and empty GET body', async () => {
    const { validateRestRequest, restHasBlockingError } = await import('../src/services/restValidate')
    const hints = validateRestRequest('GET', '/_cluster/health', '')
    expect(restHasBlockingError(hints)).toBe(false)
  })
})


describe('restScript', () => {
  it('parses multiple Dev Tools requests', async () => {
    const { parseRestScript } = await import('../src/services/restScript')
    const text = `GET /_cluster/health

GET /cms_notice/_search
{
  "query": { "match_all": {} },
  "size": 20
}`
    const reqs = parseRestScript(text)
    expect(reqs).toHaveLength(2)
    expect(reqs[0].method).toBe('GET')
    expect(reqs[0].path).toBe('/_cluster/health')
    expect(reqs[1].path).toBe('/cms_notice/_search')
    expect(reqs[1].bodyText).toContain('match_all')
  })

  it('marks invalid JSON body with error marker', async () => {
    const { validateRestScript, requestHasError } = await import('../src/services/restScript')
    const text = `POST /idx/_doc
{ invalid }`
    const { requests, markers } = validateRestScript(text)
    expect(requests).toHaveLength(1)
    expect(requestHasError(markers, requests[0].id)).toBe(true)
    expect(markers.some((m) => m.severity === 'error')).toBe(true)
  })

  it('buildRequestPayload includes GET body', async () => {
    const { parseRestScript, buildRequestPayload } = await import('../src/services/restScript')
    const reqs = parseRestScript(`GET /demo/_search
{
  "query": { "match_all": {} }
}`)
    const payload = buildRequestPayload(reqs[0])
    expect(payload.method).toBe('GET')
    expect(payload.body).toEqual({ query: { match_all: {} } })
  })

  it('formatRestScript pretty-prints JSON bodies', async () => {
    const { formatRestScript } = await import('../src/services/restScript')
    const { text, skipped } = formatRestScript(`GET /demo/_search
{"query":{"match_all":{}},"size":10}`)
    expect(skipped).toBe(0)
    expect(text).toContain('GET /demo/_search')
    expect(text).toContain('  "query"')
    expect(text).toContain('  "size": 10')
  })
})

describe('searchBodySchema', () => {
  it('validates known _search body and flags unknown props', async () => {
    const { validateSearchBodySchema } = await import('../src/services/searchSchemaValidate')
    expect(validateSearchBodySchema({ query: { match_all: {} }, size: 10 })).toEqual([])
    const bad = validateSearchBodySchema({ query: { match_all: {} }, not_a_real_field: 1 })
    expect(bad.some((i) => i.message.includes('not_a_real_field'))).toBe(true)
  })

  it('schemaPropertyHints returns top-level and query keys', async () => {
    const { schemaPropertyHints, inferJsonKeyContext } = await import('../src/services/searchSchemaValidate')
    expect(schemaPropertyHints([])).toContain('query')
    expect(schemaPropertyHints([])).toContain('aggs')
    expect(schemaPropertyHints(['query'])).toContain('bool')
    expect(schemaPropertyHints(['query', 'bool'])).toContain('must')

    const body = `{\n  "query": {\n    "\n`
    const ctx = inferJsonKeyContext(body, body.length - 1)
    expect(ctx.typingKey).toBe(true)
    expect(ctx.path).toEqual(['query'])
  })

  it('validateRestScriptWithSchema marks unknown _search fields', async () => {
    const { validateRestScriptWithSchema } = await import('../src/services/restScriptSchema')
    const text = `GET /demo/_search
{
  "query": { "match_all": {} },
  "fooBarUnknown": 1
}`
    const { markers } = validateRestScriptWithSchema(text)
    expect(markers.some((m) => m.message.includes('fooBarUnknown'))).toBe(true)
  })
})

describe('indexMeta', () => {
  it('parses aliases by index', async () => {
    const { aliasesByIndex, validateIndexName, aliasChipColor } = await import('../src/services/indexMeta')
    const map = aliasesByIndex({
      demo: { aliases: { demo_read: {}, demo_write: {} } },
      other: { aliases: {} },
    })
    expect(map.demo).toEqual(['demo_read', 'demo_write'])
    expect(map.other).toEqual([])
    expect(validateIndexName('MyIndex')).toBeTruthy()
    expect(validateIndexName('my-index')).toBeNull()
    expect(aliasChipColor('demo_read').bg).toMatch(/^hsl\(/)
  })
})

describe('indexClone', () => {
  it('strips uuid and builds reindex body', async () => {
    const {
      sanitizeIndexSettingsForClone,
      extractMappingsForClone,
      buildReindexBody,
    } = await import('../src/services/indexClone')
    const settings = sanitizeIndexSettingsForClone(
      {
        demo: {
          settings: {
            index: {
              uuid: 'abc',
              number_of_shards: '1',
              number_of_replicas: '0',
              creation_date: '1',
            },
            analysis: { analyzer: { a: { type: 'standard' } } },
          },
        },
      },
      'demo',
    )
    expect((settings.index as Record<string, unknown>).uuid).toBeUndefined()
    expect((settings.index as Record<string, unknown>).number_of_shards).toBe('1')
    expect(settings.analysis).toBeTruthy()
    const mappings = extractMappingsForClone(
      { demo: { mappings: { properties: { title: { type: 'text' } } } } },
      'demo',
    )
    expect(mappings.properties).toBeTruthy()
    expect(buildReindexBody('a', 'b')).toEqual({ source: { index: 'a' }, dest: { index: 'b' } })
  })
})

describe('restFieldHints', () => {
  it('extracts index names and field-suggest contexts', async () => {
    const { indexNamesFromRestPath, shouldSuggestMappingFields } = await import('../src/services/restFieldHints')
    expect(indexNamesFromRestPath('/cms_notice/_search')).toEqual(['cms_notice'])
    expect(indexNamesFromRestPath('/a,b/_search')).toEqual(['a', 'b'])
    expect(indexNamesFromRestPath('/_cluster/health')).toEqual([])
    expect(shouldSuggestMappingFields(['query', 'match'])).toBe(true)
    expect(shouldSuggestMappingFields(['query'])).toBe(false)
  })
})


describe('uiStateStore', () => {
  it('saves and loads via db', async () => {
    const { MemoryDb } = await import('../src/services/db')
    const { getUiState, saveUiState, UI_SEARCH_ID } = await import('../src/services/uiStateStore')
    const db = new MemoryDb()
    await saveUiState(UI_SEARCH_ID, { index: 'demo', size: 20 }, db)
    const loaded = await getUiState<{ index: string; size: number }>(UI_SEARCH_ID, db)
    expect(loaded).toEqual({ index: 'demo', size: 20 })
    await saveUiState(UI_SEARCH_ID, { index: 'demo2', size: 10 }, db)
    const again = await getUiState<{ index: string; size: number }>(UI_SEARCH_ID, db)
    expect(again).toEqual({ index: 'demo2', size: 10 })
  })
})
