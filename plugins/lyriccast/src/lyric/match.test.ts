import { describe, expect, it } from 'vitest'
import { pickBestCandidate, scoreCandidate, similarity } from './match'
import type { LyricQuery } from './types'

const query: LyricQuery = {
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  durationMs: 269000
}

describe('similarity', () => {
  it('is 1 for identical normalized text', () => {
    expect(similarity('晴天', ' 晴天 ')).toBe(1)
  })
  it('is 0 for empty input', () => {
    expect(similarity('', '晴天')).toBe(0)
  })
  it('gives 0 when a short title only extends by a version word (handled by version tags)', () => {
    // v2 语义:版本词(live 等)不再参与裸相似度 —— '晴天live' vs '晴天' 短标题保护直接 0,
    // 版本失配由 extractVersionTags 的对称惩罚处理(match-cases.test.ts 覆盖)
    const value = similarity('晴天 Live', '晴天')
    expect(value).toBe(0)
  })

  it('allows containment for short titles when length ratio is small', () => {
    // 合法包含:'晴天吖'(3) 包含 '晴天'(2),比例 1.5 → 按包含计算相似度
    const value = similarity('晴天吖', '晴天')
    expect(value).toBeGreaterThan(0.4)
    expect(value).toBeLessThan(1)
    // 比例恰好 2('爱x' vs '爱'):判为悬殊 → 0(1 字标题只允许全等)
    expect(similarity('爱x', '爱')).toBe(0)
  })
})

describe('scoreCandidate', () => {
  it('rewards duration within ±3s heavily', () => {
    const close = scoreCandidate({ title: '晴天', artist: '周杰伦', durationMs: 270000 }, query)
    const far = scoreCandidate({ title: '晴天', artist: '周杰伦', durationMs: 300000 }, query)
    expect(close).toBeGreaterThan(far)
  })

  it('punishes very different durations', () => {
    const exactTitleButFarDuration = scoreCandidate({ title: '晴天', durationMs: 90_000 }, query)
    expect(exactTitleButFarDuration).toBeLessThan(
      scoreCandidate({ title: '晴天', artist: '周杰伦', durationMs: 269500 }, query)
    )
  })
})

describe('pickBestCandidate', () => {
  it('picks the matching candidate among noise', () => {
    const best = pickBestCandidate(
      [
        { title: '晴天 (Live)', artist: '周杰伦', durationMs: 320000 },
        { title: '晴天', artist: '周杰伦', durationMs: 269500 },
        { title: '夜曲', artist: '周杰伦', durationMs: 226000 }
      ],
      query
    )
    expect(best?.durationMs).toBe(269500)
  })

  it('returns null when no title is similar enough', () => {
    const best = pickBestCandidate([{ title: '完全无关的歌', artist: '别人', durationMs: 269000 }], query)
    expect(best).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(pickBestCandidate([], query)).toBeNull()
  })
})
