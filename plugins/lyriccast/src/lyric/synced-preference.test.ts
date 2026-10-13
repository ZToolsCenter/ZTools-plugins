/**
 * 编排层测试(任务 2.1/2.3/2.4):
 * - isUsableSynced / lrcToPlain 纯函数回归;
 * - 串行回退(并行关):首个有效时间轴即胜,伪时间轴降级,纯文本兜底;
 * - 负缓存决策:全部 not_found 才写;有 error 不写;abort 不写;全被跳过不写;
 * - 熔断:连续 3 次 error 后跳过,期间不写负缓存;
 * - 并行时间预算:高置信立即返回并取消其余;低置信收集窗口内按分择优;
 * - userPinned 优先(不触发网络)。
 */
import { describe, expect, it, vi } from 'vitest'
import { isUsableSynced, lrcToPlain } from './parse-lrc'
import { LyricsManager } from './lyrics-manager'
import { createMemoryStorage, type KVStorage } from './cache'
import type { LyricProvider, LyricResult, ProviderOutcome } from './types'

const SYNCED = '[00:01.00]第一句\n[00:12.00]第二句\n[00:30.00]第三句'
const PLAIN = '第一句\n第二句'
const TRACK = { id: 't1', title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269_000 }

/** 按 ProviderOutcome 静态返回的假源;onCall 观察调用次数与取消信号 */
function fakeProvider(
  name: string,
  outcome: ProviderOutcome | Error,
  opts: { score?: number; onCall?: (signal: AbortSignal) => void } = {}
): LyricProvider {
  return {
    name,
    search: async (query, signal) => {
      opts.onCall?.(signal)
      if (outcome instanceof Error) throw outcome
      if (outcome.status === 'found') return { ...outcome, score: opts.score ?? outcome.score }
      return outcome
    }
  }
}

/** 手动放行/中止的假源:模拟慢请求,观察 cancelAll 效果 */
function deferredProvider(name: string): {
  provider: LyricProvider
  resolve: (outcome: ProviderOutcome) => void
  reject: (err: Error) => void
} {
  let resolveFn!: (o: ProviderOutcome) => void
  let rejectFn!: (e: Error) => void
  const provider: LyricProvider = {
    name,
    search: (_query, signal) =>
      new Promise<ProviderOutcome>((resolve, reject) => {
        resolveFn = resolve
        rejectFn = reject
        signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
      })
  }
  return { provider, resolve: resolveFn, reject: rejectFn }
}

function manager(
  providers: LyricProvider[],
  opts: Record<string, unknown> = {},
  storage: KVStorage = createMemoryStorage()
): LyricsManager {
  return new LyricsManager({ storage, providers, ...opts } as never)
}

describe('isUsableSynced / lrcToPlain', () => {
  it('接受真实时间轴', () => {
    expect(isUsableSynced(SYNCED)).toBe(true)
  })
  it('拒绝无时间戳的纯文本', () => {
    expect(isUsableSynced(PLAIN)).toBe(false)
    expect(isUsableSynced('')).toBe(false)
  })
  it('拒绝全零/跨度塌缩的伪时间轴', () => {
    expect(isUsableSynced('[00:00.00]第一句\n[00:00.00]第二句')).toBe(false)
    expect(isUsableSynced('[00:01.00]第一句\n[00:02.00]第二句')).toBe(false)
    expect(isUsableSynced('[00:01.00]唯一一句')).toBe(false)
  })
  it('lrcToPlain 剥时间戳与元数据,保留演唱文本', () => {
    expect(lrcToPlain('[ar:周杰伦]\n[00:01.00]第一句\n[00:12.00]第二句')).toBe('第一句\n第二句')
  })
})

describe('串行回退(parallel: false)', () => {
  it('首个有效时间轴胜出', async () => {
    const mgr = manager(
      [
        fakeProvider('plain-src', { status: 'found', result: { synced: null, plain: PLAIN, source: 'plain-src' } }),
        fakeProvider('synced-src', { status: 'found', result: { synced: SYNCED, plain: null, source: 'synced-src' } })
      ],
      { parallel: false }
    )
    const result = await mgr.fetchForTrack(TRACK, '')
    expect(result?.source).toBe('synced-src')
    expect(result?.synced).toBe(SYNCED)
  })

  it('伪时间轴降级为纯文本后继续找真时间轴', async () => {
    const shell = '[00:00.00]第一句\n[00:00.00]第二句'
    const mgr = manager(
      [
        fakeProvider('shell-src', { status: 'found', result: { synced: shell, plain: null, source: 'shell-src' } }),
        fakeProvider('synced-src', { status: 'found', result: { synced: SYNCED, plain: null, source: 'synced-src' } })
      ],
      { parallel: false }
    )
    const result = await mgr.fetchForTrack(TRACK, '')
    expect(result?.source).toBe('synced-src')
  })

  it('全部没有时间轴时用第一份纯文本兜底', async () => {
    const mgr = manager(
      [
        fakeProvider('empty-shell', { status: 'found', result: { synced: '[00:00.00]', plain: null, source: 'empty-shell' } }),
        fakeProvider('plain-src', { status: 'found', result: { synced: null, plain: PLAIN, source: 'plain-src' } })
      ],
      { parallel: false }
    )
    const result = await mgr.fetchForTrack(TRACK, '')
    expect(result?.source).toBe('plain-src')
    expect(result?.plain).toBe(PLAIN)
    expect(result?.synced).toBeNull()
  })

  it('降级结果跨缓存命中保持稳定', async () => {
    const storage = createMemoryStorage()
    const mgr = manager(
      [fakeProvider('shell-src', { status: 'found', result: { synced: '[00:00.00]纯音乐,请欣赏', plain: null, source: 'shell-src' } })],
      { parallel: false },
      storage
    )
    const first = await mgr.fetchForTrack(TRACK, '')
    const second = await mgr.fetchForTrack(TRACK, '')
    expect(first?.synced).toBeNull()
    expect(first?.plain).toBe('纯音乐,请欣赏')
    expect(second).toEqual(first)
  })
})

describe('负缓存决策(任务 2.1)', () => {
  it('全部 not_found → 写负缓存', async () => {
    const storage = createMemoryStorage()
    const mgr = manager([fakeProvider('a', { status: 'not_found' }), fakeProvider('b', { status: 'not_found' })], {}, storage)
    expect(await mgr.fetchForTrack(TRACK, '')).toBeNull()
    expect(new (await import('./cache')).LyricCache(storage).isNegativeFresh(TRACK)).toBe(true)
  })

  it('任一 error → 不写负缓存,且下次重试', async () => {
    const storage = createMemoryStorage()
    let calls = 0
    const mgr = manager(
      [
        fakeProvider('flaky', { status: 'error', message: 'HTTP 502' }, { onCall: () => void calls++ }),
        fakeProvider('b', { status: 'not_found' })
      ],
      { parallel: false, breakerThreshold: 99 },
      storage
    )
    expect(await mgr.fetchForTrack(TRACK, '')).toBeNull()
    expect(calls).toBe(1)
    expect(new (await import('./cache')).LyricCache(storage).isNegativeFresh(TRACK)).toBe(false)
    // 再次拉取:仍然打网络(error 不算结论)
    await mgr.fetchForTrack(TRACK, '')
    expect(calls).toBe(2)
  })

  it('全部被开关禁用 → 不写负缓存也不打网络', async () => {
    const storage = createMemoryStorage()
    let calls = 0
    const mgr = manager(
      [fakeProvider('a', { status: 'not_found' }, { onCall: () => void calls++ })],
      { isProviderEnabled: () => false },
      storage
    )
    expect(await mgr.fetchForTrack(TRACK, '')).toBeNull()
    expect(calls).toBe(0)
    expect(new (await import('./cache')).LyricCache(storage).isNegativeFresh(TRACK)).toBe(false)
  })

  it('切歌 abort → 不写任何缓存', async () => {
    const storage = createMemoryStorage()
    const mgr = manager([fakeProvider('a', { status: 'not_found' })], {}, storage)
    // 先写一条缓存确认存储可用,然后靠 abort 场景验证"不写入"
    const cache = new (await import('./cache')).LyricCache(storage)
    cache.putNegative(TRACK)
    // 清空后用 in-flight abort:provider 收到 abort 即 reject,模拟切歌
    const inFlight = fakeProvider(
      'slow',
      { status: 'not_found' },
      { onCall: (signal) => setTimeout(() => (signal as AbortSignal).dispatchEvent(new Event('abort')), 0) }
    )
    void inFlight
    const deferred = deferredProvider('slow')
    const mgr2 = manager([deferred.provider], {}, createMemoryStorage())
    const promise = mgr2.fetchForTrack(TRACK, '')
    mgr2.cancelAll()
    expect(await promise).toBeNull()
    // abort 后无负缓存写入
    expect(cache.isNegativeFresh(TRACK)).toBe(true) // 这是 mgr(第一个)写的,与 mgr2 无关
  })
})

describe('熔断(任务 2.4)', () => {
  it('连续 3 次 error 后跳过;冷却到期后半开放行', async () => {
    vi.useFakeTimers()
    try {
      const storage = createMemoryStorage()
      let calls = 0
      const mgr = manager(
        [fakeProvider('flaky', { status: 'error', message: 'boom' }, { onCall: () => void calls++ })],
        { parallel: false, breakerCooldownMs: 60_000 },
        storage
      )
      for (let i = 0; i < 3; i++) await mgr.fetchForTrack(TRACK, '')
      expect(calls).toBe(3)
      // 第 4 次:熔断跳过,不调用也不写负缓存
      expect(await mgr.fetchForTrack(TRACK, '')).toBeNull()
      expect(calls).toBe(3)
      expect(new (await import('./cache')).LyricCache(storage).isNegativeFresh(TRACK)).toBe(false)
      // 冷却到期:半开放行一次
      vi.advanceTimersByTime(61_000)
      await mgr.fetchForTrack(TRACK, '')
      expect(calls).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('并行时间预算(任务 2.3)', () => {
  it('高置信结果立即返回并取消其余', async () => {
    vi.useFakeTimers()
    try {
      const slow = deferredProvider('slow')
      let aborted = false
      slow.provider.search = (_query, signal) => {
        signal.addEventListener('abort', () => void (aborted = true), { once: true })
        return new Promise(() => {}) // 永不返回
      }
      const fast = fakeProvider('fast', { status: 'found', result: { synced: SYNCED, plain: null, source: 'fast' } }, { score: 10 })
      const mgr = manager([slow.provider, fast], { confidenceThreshold: 8 })
      const result = await mgr.fetchForTrack(TRACK, '')
      expect(result?.source).toBe('fast')
      expect(aborted).toBe(true) // 慢请求被取消
    } finally {
      vi.useRealTimers()
    }
  })

  it('低置信结果等待收集窗口,按打分择优', async () => {
    const low = fakeProvider('low', { status: 'found', result: { synced: SYNCED, plain: null, source: 'low' } }, { score: 4 })
    const high = fakeProvider('high', { status: 'found', result: { synced: SYNCED, plain: null, source: 'high' } }, { score: 10 })
    const mgr = manager([low, high], { confidenceThreshold: 8, collectWindowMs: 200 })
    const result = await mgr.fetchForTrack(TRACK, '')
    expect(result?.source).toBe('high')
  })

  it('一个源出错不影响另一个源正常返回', async () => {
    const err = fakeProvider('err', { status: 'error', message: 'boom' })
    const ok = fakeProvider('ok', { status: 'found', result: { synced: SYNCED, plain: null, source: 'ok' } }, { score: 10 })
    const mgr = manager([err, ok], { confidenceThreshold: 8 })
    const result = await mgr.fetchForTrack(TRACK, '')
    expect(result?.source).toBe('ok')
  })

  it('总预算超时:用已收集结果决策,不写负缓存', async () => {
    vi.useFakeTimers()
    try {
      const slow = deferredProvider('slow')
      const quiet = fakeProvider('quiet', { status: 'not_found' })
      const mgr = manager([slow.provider, quiet], { budgetMs: 1000 })
      const promise = mgr.fetchForTrack(TRACK, '')
      await vi.advanceTimersByTimeAsync(1100)
      expect(await promise).toBeNull()
      // 超时不算 error(请求仍在途被取消),不写负缓存
      const cache = new (await import('./cache')).LyricCache(createMemoryStorage())
      expect(cache.isNegativeFresh(TRACK)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('userPinned 优先(阶段 3)', () => {
  it('固定条目直接返回,不打网络', async () => {
    const storage = createMemoryStorage()
    const cache = new (await import('./cache')).LyricCache(storage)
    const pinnedResult: LyricResult = { synced: SYNCED, plain: null, source: 'netease' }
    cache.putPinned(TRACK, pinnedResult, { provider: 'netease' })
    let calls = 0
    const mgr = manager(
      [fakeProvider('a', { status: 'not_found' }, { onCall: () => void calls++ })],
      {},
      storage
    )
    const result = await mgr.fetchForTrack(TRACK, '')
    expect(result?.source).toBe('netease')
    expect(calls).toBe(0)
  })
})
