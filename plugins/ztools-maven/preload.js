// Aggregate search from three sources:
// 1. Maven Central (Solr) — primary
// 2. Aliyun Maven mirror — Chinese mirror, fast from CN
// 3. CodeRead — community-curated Chinese mirror
// Results are deduped by `g:a` key, preferring the entry with the most
// recent timestamp.

const SOLR_BASE = 'https://search.maven.org/solrsearch/select'
const ALIYUN_BASE = 'https://maven.aliyun.com/artifact/aliyunMaven/searchArtifactByWords'
const CODEREAD_BASE = 'http://mvn.coderead.cn/search' // CodeRead only serves HTTP (no TLS)
const TIMEOUT_MS = 5000
const RETRY_DELAY_MS = 1500
const DEFAULT_PROXY = ''

function applyProxy(url) {
  if (typeof process === 'undefined' || !process?.env) return
  if (url === undefined) {
    if (process.env.MAVEN_PROXY_DISABLED === '1') deleteEnvProxy()
    return
  }
  if (url === '') { deleteEnvProxy(); return }
  process.env.HTTP_PROXY = url
  process.env.HTTPS_PROXY = url
  process.env.http_proxy = url
  process.env.https_proxy = url
  process.env.MAVEN_PROXY = url
}
function deleteEnvProxy() {
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.MAVEN_PROXY
}
applyProxy()

if (window.ztools?.http?.setHeaders) {
  window.ztools.http.setHeaders({ 'User-Agent': 'ztools-maven/1.0' })
}

class ServiceError extends Error {
  constructor(message, meta) {
    super(message)
    this.name = 'ServiceError'
    this.url = meta.url
    this.status = meta.status
    this.durationMs = meta.durationMs
    this.body = meta.body
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJson(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const durationMs = Date.now() - start
    if (!res.ok) {
      let body
      try { body = await res.text() } catch {}
      throw new ServiceError(`HTTP ${res.status}`, { url, status: res.status, durationMs, body })
    }
    return { json: await res.json(), durationMs }
  } catch (err) {
    const durationMs = Date.now() - start
    if (err instanceof ServiceError) throw err
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new ServiceError(`请求超时（${timeoutMs}ms）`, { url, status: 0, durationMs, body: err.message })
    }
    throw new ServiceError(`网络错误：${err?.message || String(err)}`, { url, status: 0, durationMs, body: err?.stack })
  } finally {
    clearTimeout(timer)
  }
}

// Like fetchJson but returns raw text (CodeRead's version page is HTML).
async function fetchText(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const durationMs = Date.now() - start
    if (!res.ok) {
      let body
      try { body = await res.text() } catch {}
      throw new ServiceError(`HTTP ${res.status}`, { url, status: res.status, durationMs, body })
    }
    return { text: await res.text(), durationMs }
  } catch (err) {
    const durationMs = Date.now() - start
    if (err instanceof ServiceError) throw err
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new ServiceError(`请求超时（${timeoutMs}ms）`, { url, status: 0, durationMs, body: err.message })
    }
    throw new ServiceError(`网络错误：${err?.message || String(err)}`, { url, status: 0, durationMs, body: err?.stack })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(url) {
  try { return await fetchJson(url) }
  catch (err) {
    if (err instanceof ServiceError && err.status === 429) {
      await sleep(RETRY_DELAY_MS)
      return fetchJson(url)
    }
    throw err
  }
}

function buildSolrQ(query) {
  if (query.kind === 'freeText') return query.freeText
  if (query.kind === 'rawQuery') return query.rawQuery
  if (query.kind === 'scoped') {
    const parts = []
    if (query.g) parts.push(`g:${query.g}`)
    if (query.a) parts.push(`a:${query.a}`)
    return parts.join(' AND ')
  }
  throw new Error('unknown query kind')
}

// ── Source 1: Maven Central Solr ──────────────────────────────────────────

async function searchSolr(query) {
  const params = new URLSearchParams({ q: buildSolrQ(query), rows: '20', wt: 'json' })
  const url = `${SOLR_BASE}?${params}`
  const { json } = await fetchWithRetry(url)
  return (json.response?.docs ?? []).map(d => ({
    id: d.id,
    g: d.g,
    a: d.a,
    latestVersion: d.v,
    timestamp: d.timestamp ?? 0,
    source: 'solr',
  }))
}

// ── Source 2: Aliyun Maven mirror ────────────────────────────────────────
//
// API: GET /artifact/aliyunMaven/searchArtifactByWords?repoId=all&queryTerm=fastjson2
// Response: { object: [{ artifactId, classifier, fileName, groupId, id, packaging, repositoryId, version, lastModified? }, ...] }
//
// The response lists versions PER artifact (groupId is "#" placeholder).
// We keep only `packaging === 'pom'` rows (skip jar/sources/javadoc noise),
// group by artifactId, and pick the entry with the most recent timestamp
// (fallback: highest version).

async function searchAliyun(query) {
  const term = query.kind === 'freeText' ? query.freeText
            : query.kind === 'rawQuery' ? query.rawQuery
            : `${query.g ?? ''}${query.a ? ':' + query.a : ''}`.replace(/^:/, '')
  if (!term) return []
  const url = `${ALIYUN_BASE}?repoId=all&queryTerm=${encodeURIComponent(term)}&_input_charset=utf-8`
  const { json } = await fetchJson(url)
  const list = json?.object ?? []
  const grouped = new Map()
  for (const item of list) {
    if (item.packaging !== 'pom') continue // only regular maven deps
    if (!item.version || /unknown/i.test(String(item.version))) continue // drop 'unknown' version rows
    const artifactId = item.artifactId
    if (!artifactId) continue
    // Not every row has groupId '#' — some carry a real one (e.g. cn.dev33).
    // Use it when present so the row is a proper g:a and sorts by prefix.
    const realG = item.groupId && item.groupId !== '#' ? item.groupId : ''
    const key = realG ? `${realG}:${artifactId}` : artifactId
    const existing = grouped.get(key)
    const ts = Date.parse(item.lastModified || '') || 0
    // Prefer rows with a real groupId, then more recent timestamps.
    const score = (realG ? 2 : 0) + (ts > 0 ? 1 : 0)
    const existingScore = existing
      ? ((existing.groupId && existing.groupId !== '#' ? 2 : 0) + ((existing._ts || 0) > 0 ? 1 : 0))
      : -1
    if (!existing || score > existingScore) {
      grouped.set(key, { ...item, _ts: ts, _realG: realG })
    }
  }
  return [...grouped.values()].map(it => ({
    // Rows with a real groupId keep it; rows with '#' leave g empty and the
    // aggregator fills it from Solr (same artifactId) if available.
    id: it._realG ? `${it._realG}:${it.artifactId}` : it.artifactId,
    g: it._realG,
    a: it.artifactId,
    latestVersion: it.version || 'unknown',
    timestamp: it._ts || 0,
    source: 'aliyun',
  }))
}

// ── Source 3: CodeRead community mirror ──────────────────────────────────
//
// API: GET /search?keyword=fastjson2
// Response: { success: true, results: [{ name (HTML), value ("g:a"), text, lastTime (YYYY-MM-DD), group }, ...] }
// Each result is already one-per-artifact; no version detail.
// `value` is the canonical "g:a" key.

async function searchCodeRead(query) {
  const term = query.kind === 'freeText' ? query.freeText
            : query.kind === 'rawQuery' ? query.rawQuery
            : `${query.g ?? ''}${query.a ? ':' + query.a : ''}`.replace(/^:/, '')
  if (!term) return []
  const url = `${CODEREAD_BASE}?keyword=${encodeURIComponent(term)}`
  const { json } = await fetchJson(url)
  const list = json?.results ?? []
  return list.map(r => {
    const value = r.value || ''
    const [g, a] = value.split(':')
    const ts = r.lastTime ? Date.parse(r.lastTime) || 0 : 0
    return {
      id: value,
      g: g || '',
      a: a || '',
      latestVersion: '',
      timestamp: ts,
      source: 'coderead',
    }
  })
}

// CodeRead's version page is HTML (not JSON). Parse the version table:
// each row is `<tr onclick="doFold($(this))">` whose first <td> is the
// version and the last `right aligned` <td> is the publish date.
async function codeReadVersions(g, a) {
  const url = `http://mvn.coderead.cn/version?groupId=${encodeURIComponent(g)}&artifactId=${encodeURIComponent(a)}`
  const { text } = await fetchText(url)
  const versions = []
  const trRe = /<tr onclick="doFold\(\$\(this\)\)">([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRe.exec(text))) {
    const block = m[1]
    const vMatch = /<td>([^<]+)<\/td>/.exec(block)
    if (!vMatch) continue
    const dateMatch = /<td class="right aligned">\s*(\d{4}-\d{2}-\d{2})/.exec(block)
    versions.push({
      v: vMatch[1].trim(),
      timestamp: dateMatch ? Date.parse(dateMatch[1]) || 0 : 0,
    })
  }
  return { data: versions, source: 'coderead' }
}

// ── Aggregator ──────────────────────────────────────────────────────────

function dedupeById(list) {
  const map = new Map()
  for (const item of list) {
    if (!item.id) continue
    const existing = map.get(item.id)
    // Prefer entries with richer info (real g/a fields + latestVersion + max ts).
    if (!existing) { map.set(item.id, item); continue }
    const existingScore = (existing.g ? 1 : 0) + (existing.a ? 1 : 0) + (existing.latestVersion ? 1 : 0)
    const newScore = (item.g ? 1 : 0) + (item.a ? 1 : 0) + (item.latestVersion ? 1 : 0)
    if (newScore > existingScore || (newScore === existingScore && item.timestamp > existing.timestamp)) {
      map.set(item.id, item)
    }
  }
  return [...map.values()]
}

// Stable sort that boosts well-known groupId prefixes (com/org/dev/cn)
// to the front — these are the mainstream coordinate namespaces.
const GROUP_PREFIX_RE = /^(com|org|dev|cn)\./i
function sortByGroupPriority(list) {
  const rank = (item) => (item.g && GROUP_PREFIX_RE.test(item.g)) ? 0 : 1
  return list.sort((a, b) => rank(a) - rank(b))
}

async function mavenSearch(query) {
  // rawQuery is Solr-specific syntax — only Solr supports it.
  if (query.kind === 'rawQuery') {
    const data = sortByGroupPriority(await searchSolr(query))
    return { data, source: 'solr', sources: { solr: data, aliyun: [], coderead: [] } }
  }

  // Fan out to all three sources in parallel. One source failing must not
  // break the others.
  const settled = await Promise.allSettled([
    searchSolr(query).catch(e => { console.warn('solr failed:', e); return [] }),
    searchAliyun(query).catch(e => { console.warn('aliyun failed:', e); return [] }),
    searchCodeRead(query).catch(e => { console.warn('coderead failed:', e); return [] }),
  ])

  const [solr, aliyun, coderead] = settled.map(r => (r.status === 'fulfilled' ? r.value : []))

  // Aliyun rows lack a real groupId (API returns '#'). Fill it from the Solr
  // results (same artifactId) so they (a) sort under the com/org/dev/cn
  // priority and (b) display a real g:a that dedupes against Solr. Zero
  // extra requests — we reuse the Solr results already fetched for this query.
  const solrGroupByArtifact = new Map()
  for (const s of solr) if (s.g && s.a) solrGroupByArtifact.set(s.a, s.g)
  const aliyunFilled = aliyun.map(it => {
    const g = solrGroupByArtifact.get(it.a)
    return g ? { ...it, g, id: `${g}:${it.a}` } : it
  })

  const data = sortByGroupPriority(dedupeById([...solr, ...aliyunFilled, ...coderead]))
  return {
    data,
    source: 'aggregated',
    sources: {
      solr: sortByGroupPriority(solr),
      aliyun: sortByGroupPriority(aliyunFilled),
      coderead: sortByGroupPriority(coderead),
    },
  }
}

// ── Version lookup (Solr only — Aliyun/CodeRead return version-per-row) ──

async function mavenVersions(g, a, start = 0) {
  const q = `g:${g} AND a:${a}`
  const params = new URLSearchParams({ q, core: 'gav', rows: '200', wt: 'json' })
  if (start > 0) params.set('start', String(start))
  const url = `${SOLR_BASE}?${params}`
  const { json } = await fetchWithRetry(url)
  return {
    data: (json.response?.docs ?? []).map(d => ({
      v: d.v,
      timestamp: d.timestamp ?? 0,
    })),
    source: 'solr',
  }
}

function registerServices(api) {
  globalThis.services = api
  if (typeof window !== 'undefined') window.services = api
  return api
}

window.services = registerServices({
  mavenSearch,
  mavenVersions,
  codeReadVersions,
  setProxy(url) {
    applyProxy(typeof url === 'string' && url.trim() ? url.trim() : '')
    return !!process.env.HTTP_PROXY
  },
  getProxy() {
    return process.env.HTTP_PROXY || DEFAULT_PROXY
  },
})
