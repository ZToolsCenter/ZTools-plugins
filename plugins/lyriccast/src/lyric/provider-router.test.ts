/** Provider 路由测试(任务 2.3):CJK 为主时中文源提前,否则保持声明顺序。 */
import { describe, expect, it } from 'vitest'
import { isCjkQuery, routeProviders } from './provider-router'
import type { LyricProvider, LyricQuery } from './types'

const lrclib: LyricProvider = { name: 'lrclib', search: async () => ({ status: 'not_found' }) }
const netease: LyricProvider = { name: 'netease', prefersCjk: true, search: async () => ({ status: 'not_found' }) }

function query(title: string, artist: string): LyricQuery {
  return { title, artist, album: '', durationMs: 0 }
}

describe('isCjkQuery', () => {
  it('CJK 为主的标题+歌手判为 true', () => {
    expect(isCjkQuery(query('晴天', '周杰伦'))).toBe(true)
    expect(isCjkQuery(query('七里香', '周杰伦 Feat. 杨瑞代'))).toBe(true)
  })
  it('拉丁为主判为 false', () => {
    expect(isCjkQuery(query('Shape of You', 'Ed Sheeran'))).toBe(false)
    // CJK 标题 + 英文歌手名,拉丁字符更多 → false(两个源都会跑,只影响优先级)
    expect(isCjkQuery(query('晴天', 'Jay Chou'))).toBe(false)
  })
})

describe('routeProviders', () => {
  it('CJK 查询:中文源提前,其余保持相对顺序', () => {
    expect(routeProviders([lrclib, netease], query('晴天', '周杰伦'))).toEqual([netease, lrclib])
  })
  it('拉丁查询:保持声明顺序', () => {
    expect(routeProviders([lrclib, netease], query('Yesterday', 'The Beatles'))).toEqual([lrclib, netease])
  })
  it('多源混合时仅 prefersCjk 的被提前', () => {
    const kugou: LyricProvider = { name: 'kugou', prefersCjk: true, search: async () => ({ status: 'not_found' }) }
    expect(routeProviders([lrclib, netease, kugou], query('晴天', '周杰伦'))).toEqual([netease, kugou, lrclib])
  })
})
