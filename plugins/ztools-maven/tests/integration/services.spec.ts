import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

const mockFetch = vi.fn()
;(globalThis as any).fetch = mockFetch
;(globalThis as any).window = {
  ztools: {
    http: { setHeaders: vi.fn().mockReturnValue(true) },
    clipboard: { writeContent: vi.fn() },
    isDarkColors: () => false,
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
  },
}

const TIMEOUT_MS = 5000

await import('../../preload.js')
const services = (globalThis as any).services

beforeAll(() => {
  if (!services) throw new Error('services.js did not register window.services')
})

describe('services.mavenSearch', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('hits Solr with freeText query and returns aggregated source', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: { numFound: 1, docs: [{ id: 'g:a', g: 'g', a: 'a', v: '1.0', timestamp: 1000 }] },
      }),
    })
    mockFetch.mockRejectedValueOnce(new Error('aliyun unreachable'))
    mockFetch.mockRejectedValueOnce(new Error('coderead unreachable'))
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    expect(result.source).toBe('aggregated')
    expect(result.data.length).toBeGreaterThan(0)
  })

  it('aggregates results from all three sources', async () => {
    // Route by URL since sources fire in parallel.
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('search.maven.org')) {
        return { ok: true, status: 200, json: async () => ({ response: { numFound: 0, docs: [] } }) }
      }
      if (url.includes('aliyun.com')) {
        return { ok: true, status: 200, json: async () => ({ object: [{ artifactId: 'g:a', packaging: 'pom', version: '1.0', lastModified: '2025-01-01' }] }) }
      }
      if (url.includes('coderead.cn')) {
        return { ok: true, status: 200, json: async () => ({ success: true, results: [{ value: 'g:a', lastTime: '2025-01-01' }] }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    // After dedup: exactly one entry per artifact id. Aliyun has the most
    // info (real g/a/latestVersion), so it should win over CodeRead.
    const aliyunEntries = result.data.filter(d => d.source === 'aliyun')
    const codeReadEntries = result.data.filter(d => d.source === 'coderead')
    expect(aliyunEntries.length).toBe(1)
    expect(codeReadEntries.length).toBe(0) // deduped out by richer aliyun entry
    expect(aliyunEntries[0].latestVersion).toBe('1.0')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('aliyun keeps only packaging=pom rows', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('search.maven.org')) {
        return { ok: true, status: 200, json: async () => ({ response: { numFound: 0, docs: [] } }) }
      }
      if (url.includes('aliyun.com')) {
        return { ok: true, status: 200, json: async () => ({
          object: [
            { artifactId: 'pom-only', packaging: 'pom', version: '1.0' },
            { artifactId: 'jar-only', packaging: 'jar', version: '1.0' },
            { artifactId: 'sources-only', packaging: 'java-source', version: '1.0' },
          ],
        }) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, results: [] }) }
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'x' })
    const aliyunEntries = result.data.filter(d => d.source === 'aliyun')
    expect(aliyunEntries.map(e => e.a)).toEqual(['pom-only'])
  })

  it('aliyun drops rows with unknown version', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('search.maven.org')) {
        return { ok: true, status: 200, json: async () => ({ response: { numFound: 0, docs: [] } }) }
      }
      if (url.includes('aliyun.com')) {
        return { ok: true, status: 200, json: async () => ({
          object: [
            { artifactId: 'real-ver', packaging: 'pom', version: '2.0.0' },
            { artifactId: 'unknown-ver', packaging: 'pom', version: 'unknown' },
            { artifactId: 'unknown-cap', packaging: 'pom', version: 'Unknown' },
            { artifactId: 'no-ver', packaging: 'pom' },
          ],
        }) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, results: [] }) }
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'x' })
    const aliyunEntries = result.data.filter(d => d.source === 'aliyun')
    expect(aliyunEntries.map(e => e.a)).toEqual(['real-ver'])
  })

  it('sorts well-known groupId prefixes (com/org/dev/cn) first', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('search.maven.org')) {
        return { ok: true, status: 200, json: async () => ({
          response: { numFound: 0, docs: [] },
        }) }
      }
      if (url.includes('aliyun.com')) {
        return { ok: true, status: 200, json: async () => ({ object: [] }) }
      }
      if (url.includes('coderead.cn')) {
        return { ok: true, status: 200, json: async () => ({
          success: true,
          results: [
            { value: 'io.github.other:lib', lastTime: '2025-01-01' },
            { value: 'com.alibaba:fastjson', lastTime: '2025-01-01' },
            { value: 'net.example:netlib', lastTime: '2025-01-01' },
            { value: 'cn.dev33:sa-token', lastTime: '2025-01-01' },
          ],
        }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'x' })
    // com / cn rank 0 → first; io / net rank 1 → last.
    const gs = result.data.filter(d => d.g).map(d => d.g)
    expect(gs.indexOf('com.alibaba')).toBeLessThan(gs.indexOf('io.github.other'))
    expect(gs.indexOf('cn.dev33')).toBeLessThan(gs.indexOf('net.example'))
  })

  it('aliyun rows inherit groupId from Solr and sort to the front', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('search.maven.org')) {
        return { ok: true, status: 200, json: async () => ({
          response: { numFound: 2, docs: [
            { id: 'com.alibaba:fastjson', g: 'com.alibaba', a: 'fastjson', v: '2.0.0', timestamp: 1 },
            { id: 'io.other:slow', g: 'io.other', a: 'slow', v: '1.0.0', timestamp: 1 },
          ] },
        }) }
      }
      if (url.includes('aliyun.com')) {
        return { ok: true, status: 200, json: async () => ({
          object: [
            { artifactId: 'fastjson', packaging: 'pom', version: '2.0.0' },
            { artifactId: 'slow', packaging: 'pom', version: '1.0.0' },
          ],
        }) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, results: [] }) }
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'x' })
    const aliyunTab = result.sources.aliyun
    const idxFast = aliyunTab.findIndex((e: any) => e.a === 'fastjson')
    const idxSlow = aliyunTab.findIndex((e: any) => e.a === 'slow')
    expect(aliyunTab[idxFast].g).toBe('com.alibaba')
    expect(idxFast).toBeLessThan(idxSlow)
  })

  it('still succeeds when all sources fail (returns empty)', async () => {
    mockFetch.mockRejectedValue(new Error('all down'))
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    expect(result.data).toEqual([])
    expect(result.source).toBe('aggregated')
    // Three sources fired; all rejected.
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns MavenArtifact-shaped data with timestamp fallback to 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: { numFound: 1, docs: [{ id: 'g:a', g: 'g', a: 'a', v: '1.0' }] },
      }),
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    expect(result.data[0].timestamp).toBe(0)
  })

  it('throws on Solr 500 (no fallback)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await expect(
      services.mavenVersions('g', 'a')
    ).rejects.toThrow(/HTTP 500/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('wraps AbortError (timeout) into ServiceError with structured fields', async () => {
    vi.useFakeTimers()
    const abortErr = Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' })
    mockFetch.mockRejectedValueOnce(abortErr)
    const promise = services.mavenVersions('g', 'a')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 100)
    await expect(promise).rejects.toThrow(/请求超时/)
    vi.useRealTimers()
  })

  it('wraps network errors into ServiceError with structured fields', async () => {
    const netErr = Object.assign(new Error('ECONNREFUSED'), { name: 'Error' })
    mockFetch.mockRejectedValueOnce(netErr)
    await expect(
      services.mavenVersions('g', 'a')
    ).rejects.toThrow(/网络错误/)
  })
})

describe('services.mavenVersions', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('hits Solr with core=gav and rows=200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 1, docs: [{ v: '1.0', timestamp: 1000 }] } }),
    })
    await services.mavenVersions('g', 'a')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toMatch(/core=gav/)
    expect(url).toMatch(/rows=200/)
  })

  it('returns empty array when Solr returns 0 results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 0, docs: [] } }),
    })
    const result = await services.mavenVersions('g', 'a')
    expect(result.data).toEqual([])
  })

  it('URL-encodes g and a parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 0, docs: [] } }),
    })
    await services.mavenVersions('org.springframework', 'spring-core')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('g%3Aorg.springframework')
    expect(url).toContain('a%3Aspring-core')
  })
})

describe('services.codeReadVersions', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  const SAMPLE_HTML = `
<table class="ui version selectable table">
  <tbody>
    <tr onclick="doFold($(this))">
        <td>2.0.60</td>
        <td class="right aligned">1005</td>
        <td class="right aligned"> 2025-10-25</td>
    </tr>
    <tr onclick="doFold($(this))">
        <td>2.0.59.android8</td>
        <td class="right aligned">9</td>
        <td class="right aligned"> 2025-09-22</td>
    </tr>
  </tbody>
</table>`

  it('parses version + date from the CodeRead HTML table', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => SAMPLE_HTML })
    const result = await services.codeReadVersions('com.alibaba.fastjson2', 'fastjson2')
    expect(result.source).toBe('coderead')
    expect(result.data).toHaveLength(2)
    expect(result.data[0].v).toBe('2.0.60')
    expect(result.data[0].timestamp).toBe(Date.parse('2025-10-25'))
    expect(result.data[1].v).toBe('2.0.59.android8')
    expect(result.data[1].timestamp).toBe(Date.parse('2025-09-22'))
  })

  it('builds the version URL with groupId + artifactId', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => SAMPLE_HTML })
    await services.codeReadVersions('com.alibaba.fastjson2', 'fastjson2')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toMatch(/groupId=com\.alibaba\.fastjson2/)
    expect(url).toMatch(/artifactId=fastjson2/)
  })
})

describe('proxy configuration', () => {
  it('default proxy is OFF — HTTP_PROXY env var unset', () => {
    expect(process.env.HTTP_PROXY).toBeUndefined()
    expect(process.env.HTTPS_PROXY).toBeUndefined()
  })
})
