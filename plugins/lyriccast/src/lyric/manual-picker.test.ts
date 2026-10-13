/**
 * 手动纠错测试(任务 3.1):
 * - fetchCandidates:聚合支持 searchCandidates 的来源,单源失败静默,禁用源不出现;
 * - pinLyrics:自带内容的候选直接固定;仅带 id 的候选按源回取;固定后自动路径直读;
 * - pinnedCandidate:固定候选的 source+id 持久化读回(候选面板高亮"当前选中"),unpin 清空;
 * - unpinLyrics 恢复自动匹配。
 */
import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from './cache'
import { LyricsManager } from './lyrics-manager'
import type { LyricProvider, LyricResult, PickerCandidate, ProviderOutcome } from './types'

const SYNCED = '[00:01.00]第一句\n[00:12.00]第二句\n[00:30.00]第三句'
const TRACK = { id: 't1', title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269_000 }

function provider(name: string, opts: Partial<LyricProvider> & { calls?: number[] } = {}): LyricProvider {
  return {
    name,
    search: async (): Promise<ProviderOutcome> => {
      opts.calls?.push(1)
      return { status: 'not_found' }
    },
    ...opts
  }
}

describe('fetchCandidates', () => {
  it('聚合各来源候选,单源失败静默跳过', async () => {
    const ok: PickerCandidate[] = [{ title: '晴天', artist: '周杰伦', source: 'lrclib', synced: SYNCED }]
    const good = provider('good', { searchCandidates: async () => ok })
    const bad = provider('bad', {
      searchCandidates: async () => {
        throw new Error('boom')
      }
    })
    const mgr = new LyricsManager({ storage: createMemoryStorage(), providers: [good, bad] })
    const items = await mgr.fetchCandidates(TRACK)
    expect(items).toEqual(ok)
  })

  it('被开关禁用的来源不出现;无 searchCandidates 的来源跳过', async () => {
    const ok: PickerCandidate[] = [{ title: '晴天', artist: '周杰伦', source: 'netease', id: '1' }]
    const netease = provider('netease', { searchCandidates: async () => ok })
    const plain = provider('plain') // 未实现 searchCandidates
    const mgr = new LyricsManager({
      storage: createMemoryStorage(),
      providers: [netease, plain],
      isProviderEnabled: (name) => name !== 'netease'
    })
    expect(await mgr.fetchCandidates(TRACK)).toEqual([])
  })
})

describe('pinLyrics', () => {
  it('自带歌词内容的候选:直接固定,自动路径不再打网络', async () => {
    const storage = createMemoryStorage()
    let calls = 0
    const src = provider('lrclib', { search: async () => { calls++; return { status: 'not_found' } } })
    const mgr = new LyricsManager({ storage, providers: [src] })
    const pinned = await mgr.pinLyrics(TRACK, {
      title: '晴天', artist: '周杰伦', source: 'lrclib', synced: SYNCED
    })
    expect(pinned?.synced).toBe(SYNCED)
    expect(mgr.isPinned(TRACK)).toBe(true)
    // 自动路径直读固定结果,不打网络
    const fetched = await mgr.fetchForTrack(TRACK, '')
    expect(fetched?.source).toBe('lrclib')
    expect(fetched?.synced).toBe(SYNCED)
    expect(calls).toBe(0)
  })

  it('仅带 id 的候选:按源 fetchLyricsById 回取并固定', async () => {
    const storage = createMemoryStorage()
    const byId: LyricResult = { synced: SYNCED, plain: null, translation: '[00:01.00]L1', source: 'netease' }
    let requestedId = ''
    const src = provider('netease', {
      fetchLyricsById: async (id) => {
        requestedId = id
        return byId
      }
    })
    const mgr = new LyricsManager({ storage, providers: [src] })
    const pinned = await mgr.pinLyrics(TRACK, { title: '晴天', artist: '周杰伦', source: 'netease', id: '186016' })
    expect(requestedId).toBe('186016')
    expect(pinned?.translation).toBe('[00:01.00]L1')
    // 固定结果读回(source 保持候选来源)
    expect(mgr.fetchForTrack(TRACK, '').then((r) => r?.source)).resolves.toBe('netease')
  })

  it('回取失败(无词)不写固定缓存,自动路径照常工作', async () => {
    const storage = createMemoryStorage()
    const src = provider('netease', { fetchLyricsById: async () => null })
    const mgr = new LyricsManager({ storage, providers: [src] })
    expect(await mgr.pinLyrics(TRACK, { title: '晴天', artist: '周杰伦', source: 'netease', id: '1' })).toBeNull()
    expect(mgr.isPinned(TRACK)).toBe(false)
  })

  it('unpinLyrics 恢复自动匹配(固定清空,自动重新接管)', async () => {
    const storage = createMemoryStorage()
    let calls = 0
    const src = provider('auto', {
      search: async () => {
        calls++
        return { status: 'found', result: { synced: SYNCED, plain: null, source: 'auto' } }
      }
    })
    const mgr = new LyricsManager({ storage, providers: [src] })
    await mgr.pinLyrics(TRACK, { title: '晴天', artist: '周杰伦', source: 'lrclib', synced: SYNCED })
    expect(mgr.isPinned(TRACK)).toBe(true)
    await mgr.unpinLyrics(TRACK)
    expect(mgr.isPinned(TRACK)).toBe(false)
    // 恢复自动:条目仍在缓存(非固定态),自动路径直接读缓存不再打网络 ——
    // 固定标记清除后,该曲回归普通缓存生命周期(被覆盖/过期后自然重搜)
    const fetched = await mgr.fetchForTrack(TRACK, '')
    expect(calls).toBe(0)
    expect(fetched?.synced).toBe(SYNCED)
  })
})

describe('pinnedCandidate(候选面板标注当前选中)', () => {
  it('固定带 id 的候选:source+id 随缓存持久化读回,unpin 后清空', async () => {
    const storage = createMemoryStorage()
    const src = provider('netease', {
      fetchLyricsById: async () => ({ synced: SYNCED, plain: null, source: 'netease' })
    })
    const mgr = new LyricsManager({ storage, providers: [src] })
    expect(mgr.pinnedCandidate(TRACK)).toBeNull()
    await mgr.pinLyrics(TRACK, { title: '晴天', artist: '周杰伦', source: 'netease', id: '186016' })
    expect(mgr.pinnedCandidate(TRACK)).toEqual({ source: 'netease', id: '186016' })
    await mgr.unpinLyrics(TRACK)
    expect(mgr.pinnedCandidate(TRACK)).toBeNull()
  })

  it('固定无 id 候选(自带内容):无从按 id 标注,返回 null', async () => {
    const mgr = new LyricsManager({ storage: createMemoryStorage(), providers: [provider('lrclib')] })
    await mgr.pinLyrics(TRACK, { title: '晴天', artist: '周杰伦', source: 'lrclib', synced: SYNCED })
    expect(mgr.isPinned(TRACK)).toBe(true)
    expect(mgr.pinnedCandidate(TRACK)).toBeNull()
  })
})
