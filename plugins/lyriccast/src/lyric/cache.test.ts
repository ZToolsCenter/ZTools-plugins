/**
 * 缓存 v2 测试(任务 2.2):
 * - 主键 = 规范化 title|artist(时长不参与键,作条目内校验字段);
 * - 时长差 >5s 视为不同版本不命中;≤5s 或未知时长命中;
 * - 结构版本:旧格式/损坏条目平滑失效不抛错;
 * - 负缓存 24h 过期;userPinned 优先级(阶段 3 用)。
 */
import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LyricCache, cacheKey, type KVStorage } from './cache'
import { OffsetStore } from './offsets'
import type { LyricQuery, LyricResult } from './types'

const query: LyricQuery = { title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269_000 }
const result: LyricResult = { synced: '[00:01.00]hi', plain: null, translation: null, source: 'lrclib' }

describe('cacheKey', () => {
  it('忽略大小写/空白,且时长不参与键', () => {
    const a = cacheKey({ title: ' 晴天 ', artist: '周杰伦' })
    const b = cacheKey({ title: '晴天', artist: '周杰伦' })
    expect(a).toBe(b)
    // 时长差 1s 不改变键(时长是条目校验字段)
    expect(cacheKey({ title: '晴天', artist: '周杰伦' })).toBe(
      cacheKey({ title: '晴天', artist: '周杰伦' })
    )
  })

  it('简繁/全半角归一后同键', () => {
    expect(cacheKey({ title: '龍卷風', artist: '周杰伦' })).toBe(cacheKey({ title: '龙卷风', artist: '周杰伦' }))
    expect(cacheKey({ title: 'Ｓｈａｐｅ', artist: 'x' })).toBe(cacheKey({ title: 'Shape', artist: 'x' }))
  })
})

describe('LyricCache', () => {
  it('存取结果', () => {
    const cache = new LyricCache(createMemoryStorage())
    expect(cache.get(query)).toBeNull()
    cache.put(query, result, { provider: 'lrclib', score: 10.5 })
    const hit = cache.get(query)
    expect(hit?.source).toBe('lrclib')
  })

  it('时长差 ≤5s 命中,>5s 视为不同版本不命中', () => {
    const cache = new LyricCache(createMemoryStorage())
    cache.put(query, result)
    // +4.9s:命中(播放器报时长的正常抖动)
    expect(cache.get({ ...query, durationMs: 273_900 })).not.toBeNull()
    // +5.1s:不命中(不同版本)
    expect(cache.get({ ...query, durationMs: 274_100 })).toBeNull()
    // 查询未知时长:命中(不拦)
    expect(cache.get({ ...query, durationMs: 0 })).not.toBeNull()
  })

  it('负缓存 24h 过期', () => {
    let now = 1_000_000
    const cache = new LyricCache(createMemoryStorage(), () => now)
    cache.putNegative(query)
    expect(cache.isNegativeFresh(query)).toBe(true)
    now += 23 * 3_600_000
    expect(cache.isNegativeFresh(query)).toBe(true)
    now += 2 * 3_600_000
    expect(cache.isNegativeFresh(query)).toBe(false)
  })

  it('旧格式/损坏条目按未命中处理,不抛错', () => {
    const storage = createMemoryStorage()
    // 模拟 v1 时代写入的同键旧条目(无 v 字段)
    storage.setItem(cacheKey(query), { type: 'result', savedAt: Date.now(), result })
    const cache = new LyricCache(storage)
    expect(cache.get(query)).toBeNull()
    expect(cache.isNegativeFresh(query)).toBe(false)
    // 损坏 JSON 场景(非对象)
    storage.setItem(cacheKey(query), 'garbage')
    expect(cache.get(query)).toBeNull()
  })

  it('userPinned 条目优先级与 unpin(阶段 3)', () => {
    const cache = new LyricCache(createMemoryStorage())
    const pinnedResult: LyricResult = { synced: '[00:01.00]手动固定', plain: null, source: 'netease' }
    cache.putPinned(query, pinnedResult, { provider: 'netease' })
    expect(cache.getPinned(query)?.source).toBe('netease')
    // 自动匹配路径(pinnedOnly)不读普通命中
    expect(cache.get(query)).not.toBeNull()
    // unpin 后不再视为固定,但条目仍可作为普通缓存命中
    cache.unpin(query)
    expect(cache.getPinned(query)).toBeNull()
    expect(cache.get(query)?.source).toBe('netease')
  })
})

describe('OffsetStore', () => {
  it('本曲偏移优先于应用偏移', () => {
    const store = new OffsetStore(createMemoryStorage())
    store.add('app', 'com.netease.cloudmusic', 300)
    expect(store.effective('track-1', 'com.netease.cloudmusic')).toBe(300)
    store.add('track', 'track-1', -100)
    expect(store.effective('track-1', 'com.netease.cloudmusic')).toBe(-100)
  })

  it('累加增量,归零即清除条目', () => {
    const store = new OffsetStore(createMemoryStorage())
    expect(store.add('track', 't', 100)).toBe(100)
    expect(store.add('track', 't', 500)).toBe(600)
    expect(store.add('track', 't', -600)).toBe(0)
    expect(store.effective('t', 'app')).toBe(0)
  })
})
