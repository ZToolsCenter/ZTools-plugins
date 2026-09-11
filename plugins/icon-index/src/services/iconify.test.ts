import { describe, expect, it, vi } from 'vitest'
import { IconifyClient, iconSvgUrl, normalizeSearchQuery } from './iconify'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function searchPayload(count: number, limit: number) {
  return {
    icons: Array.from({ length: count }, (_, index) => `lucide:icon-${index}`),
    total: count,
    limit,
    start: 0,
    collections: {
      lucide: {
        name: 'Lucide',
        palette: false,
        license: { title: 'ISC', spdx: 'ISC' }
      }
    }
  }
}

describe('normalizeSearchQuery', () => {
  it('translates common Chinese icon terms', () => {
    expect(normalizeSearchQuery('  设置  ')).toBe('settings')
    expect(normalizeSearchQuery('用户 添加')).toBe('user add')
    expect(normalizeSearchQuery('客服')).toBe('customer support')
    expect(normalizeSearchQuery('客户服务')).toBe('customer support')
  })

  it('keeps English queries and whitespace stable', () => {
    expect(normalizeSearchQuery('  arrow   left ')).toBe('arrow left')
  })
})

describe('IconifyClient', () => {
  it('calls the default global fetch without changing its receiver', async () => {
    const originalFetch = globalThis.fetch
    const globalFetcher = vi.fn().mockResolvedValue(jsonResponse(searchPayload(4, 96)))
    globalThis.fetch = globalFetcher

    try {
      const client = new IconifyClient()
      const result = await client.search('menu')
      expect(result.items).toHaveLength(4)
      expect(globalFetcher).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('uses the initial two-page batch without a second request', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(searchPayload(96, 96)))
    const client = new IconifyClient(fetcher)

    const first = await client.search('home', 1)
    const second = await client.search('home', 2)

    expect(first.items).toHaveLength(48)
    expect(second.items[0].id).toBe('lucide:icon-48')
    expect(second.hasNext).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('loads the full API batch only when page three is requested', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(searchPayload(96, 96)))
      .mockResolvedValueOnce(jsonResponse(searchPayload(140, 999)))
    const client = new IconifyClient(fetcher)

    const third = await client.search('home', 3)

    expect(third.items).toHaveLength(44)
    expect(third.hasNext).toBe(false)
    expect(third.loadedCount).toBe(140)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('falls back to the next public API host', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(searchPayload(12, 96)))
    const client = new IconifyClient(fetcher)

    const result = await client.search('search', 1)

    expect(result.items).toHaveLength(12)
    expect(String(fetcher.mock.calls[1][0])).toContain('api.simplesvg.com')
  })
})

describe('iconSvgUrl', () => {
  it('encodes icon names and color parameters', () => {
    const url = new URL(iconSvgUrl('lucide:arrow-left', '#123456'))
    expect(url.pathname).toBe('/lucide/arrow-left.svg')
    expect(url.searchParams.get('color')).toBe('#123456')
  })
})
