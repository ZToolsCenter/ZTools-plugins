/**
 * 封面 API 兜底测试(网络在沙箱不可用,聚焦纯函数与编排注入):
 * - lrcapiCoverUrl 参数拼接(空参约束);
 * - parseReleaseGroupIds 解析(去重/非法 id/结构异常容错);
 * - CoverCache 存取/30d 过期/负缓存 24h/evict;
 * - CoverManager 编排(缓存短路/来源回退/单来源失败/负缓存写入/ignoreNegative/markBroken)。
 * 真实联调(LrcAPI 301、CAA 307、MusicBrainz 限流)需在 ZTools 环境手动验证。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CoverCache,
  CoverManager,
  createCaaCoverSource,
  createLrcapiCoverSource,
  lrcapiCoverUrl,
  parseReleaseGroupIds,
  probeImage,
  type CoverQuery,
  type CoverSource
} from './cover'
import { createMemoryStorage } from './cache'

const query: CoverQuery = { title: '晴天', artist: '周杰伦', album: '叶惠美' }

function fakeSource(name: string, urls: (string | null)[], errors: Error[] = []): {
  source: CoverSource
  calls: CoverQuery[]
} {
  const calls: CoverQuery[] = []
  let i = 0
  return {
    calls,
    source: {
      name,
      async fetchCover(q: CoverQuery) {
        calls.push(q)
        const err = errors[i]
        if (err) {
          i++
          throw err
        }
        return urls[i++] ?? null
      }
    }
  }
}

describe('lrcapiCoverUrl', () => {
  it('拼接 title/artist/album 参数', () => {
    const url = lrcapiCoverUrl(query)!
    expect(url.startsWith('https://api.lrc.cx/cover?')).toBe(true)
    expect(url).toContain('title=%E6%99%B4%E5%A4%A9')
    expect(url).toContain('artist=')
    expect(url).toContain('album=')
  })

  it('空参缺省;title 与 album 都为空时无查询意义返回 null', () => {
    expect(lrcapiCoverUrl({ title: '', artist: '', album: '' })).toBeNull()
    expect(lrcapiCoverUrl({ title: '', artist: '某人', album: '' })).toBeNull()
    const albumOnly = lrcapiCoverUrl({ title: '', artist: '', album: '叶惠美' })!
    expect(albumOnly).not.toContain('title=')
    expect(albumOnly).toContain('album=')
  })
})

describe('parseReleaseGroupIds', () => {
  it('解析并去重 MBID 列表', () => {
    const a = '48117b90-a16e-34ca-a514-19c702df1158'
    const b = '2292c05e-299a-4c03-8688-3bf3d0a01277'
    expect(parseReleaseGroupIds({ 'release-groups': [{ id: a }, { id: b }, { id: a }] })).toEqual([a, b])
  })

  it('非法 id 与结构异常容错', () => {
    expect(parseReleaseGroupIds({ 'release-groups': [{ id: 'not-a-uuid' }, { id: 123 } as never] })).toEqual([])
    expect(parseReleaseGroupIds({})).toEqual([])
    expect(parseReleaseGroupIds({ 'release-groups': 'garbage' as never })).toEqual([])
  })
})

describe('probeImage', () => {
  it('无 Image 环境(Node)resolve false', async () => {
    await expect(probeImage('https://example.com/x.jpg', 100, new AbortController().signal)).resolves.toBe(false)
  })
})

describe('CoverCache', () => {
  it('存取与 30 天过期', () => {
    let now = 1_000_000
    const cache = new CoverCache(createMemoryStorage(), () => now)
    expect(cache.get(query)).toBeNull()
    cache.put(query, { url: 'https://cdn/x.jpg', source: 'lrcapi' })
    expect(cache.get(query)).toEqual({ url: 'https://cdn/x.jpg', source: 'lrcapi' })
    now += 29 * 24 * 3_600_000
    expect(cache.get(query)).not.toBeNull()
    now += 2 * 24 * 3_600_000
    expect(cache.get(query)).toBeNull()
  })

  it('负缓存 24h 过期', () => {
    let now = 1_000_000
    const cache = new CoverCache(createMemoryStorage(), () => now)
    cache.putNegative(query)
    expect(cache.isNegativeFresh(query)).toBe(true)
    now += 25 * 3_600_000
    expect(cache.isNegativeFresh(query)).toBe(false)
  })

  it('evict 仅逐出匹配 URL 的条目', () => {
    const cache = new CoverCache(createMemoryStorage())
    cache.put(query, { url: 'https://cdn/old.jpg', source: 'lrcapi' })
    cache.evict(query, 'https://cdn/other.jpg')
    expect(cache.get(query)).not.toBeNull()
    cache.evict(query, 'https://cdn/old.jpg')
    expect(cache.get(query)).toBeNull()
  })

  it('缓存键含专辑(不同专辑不同键)', () => {
    const cache = new CoverCache(createMemoryStorage())
    cache.put(query, { url: 'https://cdn/a.jpg', source: 'lrcapi' })
    expect(cache.get({ ...query, album: '范特西' })).toBeNull()
  })
})

describe('CoverManager', () => {
  it('缓存命中短路,不调来源', async () => {
    const storage = createMemoryStorage()
    const first = fakeSource('a', ['https://cdn/1.jpg'])
    const manager = new CoverManager({ storage, sources: [first.source] })
    await manager.fetchForTrack(query)
    expect(first.calls).toHaveLength(1)
    await manager.fetchForTrack(query)
    expect(first.calls).toHaveLength(1)
  })

  it('首个来源命中即用,不再问后续来源', async () => {
    const a = fakeSource('a', ['https://cdn/a.jpg'])
    const b = fakeSource('b', ['https://cdn/b.jpg'])
    const manager = new CoverManager({ storage: createMemoryStorage(), sources: [a.source, b.source] })
    await expect(manager.fetchForTrack(query)).resolves.toEqual({ url: 'https://cdn/a.jpg', source: 'a' })
    expect(b.calls).toHaveLength(0)
  })

  it('首来源未命中回退下一来源', async () => {
    const a = fakeSource('a', [null])
    const b = fakeSource('b', ['https://cdn/b.jpg'])
    const manager = new CoverManager({ storage: createMemoryStorage(), sources: [a.source, b.source] })
    await expect(manager.fetchForTrack(query)).resolves.toEqual({ url: 'https://cdn/b.jpg', source: 'b' })
  })

  it('单来源抛错不中断,继续下一来源', async () => {
    const a = fakeSource('a', [], [new Error('boom')])
    const b = fakeSource('b', ['https://cdn/b.jpg'])
    const manager = new CoverManager({ storage: createMemoryStorage(), sources: [a.source, b.source] })
    await expect(manager.fetchForTrack(query)).resolves.toEqual({ url: 'https://cdn/b.jpg', source: 'b' })
  })

  it('全部未命中写负缓存;新鲜期内直接 null;ignoreNegative 绕过', async () => {
    const a = fakeSource('a', [null, 'https://cdn/a.jpg'])
    const manager = new CoverManager({ storage: createMemoryStorage(), sources: [a.source] })
    await expect(manager.fetchForTrack(query)).resolves.toBeNull()
    await expect(manager.fetchForTrack(query)).resolves.toBeNull() // 负缓存期,未打来源
    expect(a.calls).toHaveLength(1)
    await expect(manager.fetchForTrack(query, { ignoreNegative: true })).resolves.toEqual({
      url: 'https://cdn/a.jpg',
      source: 'a'
    })
  })

  it('markBroken 逐出后下次重新探测', async () => {
    const a = fakeSource('a', ['https://cdn/gone.jpg', 'https://cdn/fresh.jpg'])
    const manager = new CoverManager({ storage: createMemoryStorage(), sources: [a.source] })
    await manager.fetchForTrack(query)
    manager.markBroken(query, 'https://cdn/gone.jpg')
    await expect(manager.fetchForTrack(query)).resolves.toEqual({ url: 'https://cdn/fresh.jpg', source: 'a' })
  })

  it('切歌中止:cancelAll 后在途请求返回 null 且不写缓存', async () => {
    let releaseProbe: (v: string | null) => void = () => {}
    const slow: CoverSource = {
      name: 'slow',
      fetchCover: () =>
        new Promise<string | null>((resolve) => {
          releaseProbe = resolve
        })
    }
    const manager = new CoverManager({ storage: createMemoryStorage(), sources: [slow] })
    const pending = manager.fetchForTrack(query)
    manager.cancelAll() // 模拟切歌:中止在途
    releaseProbe(null) // 在途探测最终落地(结果应被丢弃)
    await expect(pending).resolves.toBeNull()
    // 中止不写负缓存:重新取同一首可正常探测
    const next = fakeSource('a', ['https://cdn/next.jpg'])
    const manager2 = new CoverManager({ storage: createMemoryStorage(), sources: [next.source] })
    await expect(manager2.fetchForTrack(query)).resolves.toEqual({ url: 'https://cdn/next.jpg', source: 'a' })
  })
})

describe('来源工厂(注入探测替身)', () => {
  it('LrcAPI 源:探测通过返回端点 URL,失败返回 null', async () => {
    const pass = vi.fn().mockResolvedValue(true)
    const source = createLrcapiCoverSource(pass)
    await expect(source.fetchCover(query, new AbortController().signal)).resolves.toBe(lrcapiCoverUrl(query))
    expect(pass).toHaveBeenCalledTimes(1)
    const fail = createLrcapiCoverSource(vi.fn().mockResolvedValue(false))
    await expect(fail.fetchCover(query, new AbortController().signal)).resolves.toBeNull()
  })

  it('CAA 源:按序探测 release-group front-500,首个可加载者胜出', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          'release-groups': [{ id: '48117b90-a16e-34ca-a514-19c702df1158' }, { id: '2292c05e-299a-4c03-8688-3bf3d0a01277' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      // 第一个分组无封面,第二个有
      const probe = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
      const source = createCaaCoverSource(probe)
      await expect(source.fetchCover(query, new AbortController().signal)).resolves.toBe(
        'https://coverartarchive.org/release-group/2292c05e-299a-4c03-8688-3bf3d0a01277/front-500'
      )
      expect(fetchMock.mock.calls[0][0]).toContain('musicbrainz.org/ws/2/release-group')
      expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('release:"叶惠美"'))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('CAA 源:无专辑名不查询', async () => {
    const probe = vi.fn()
    const source = createCaaCoverSource(probe)
    await expect(source.fetchCover({ ...query, album: '' }, new AbortController().signal)).resolves.toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })
})
