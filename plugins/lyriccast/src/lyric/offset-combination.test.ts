/**
 * 偏移叠加语义验证(任务 3.2):
 * - parseLrc 应用 LRC 自带 [offset:] 标签:timeMs = 原始 − offset;
 * - 用户手动偏移在"行定位计算处"叠加:searchPosition = positionMs + userOffset;
 * - 两者互不干扰:缓存中的原始歌词内容不变([offset:] 在解析时应用,用户偏移在查找时应用)。
 * 这组测试固化 store.fetchLyrics + Lyrics.searchPosition 的组合数学。
 */
import { describe, expect, it } from 'vitest'
import { findActiveLine, parseLrc } from './parse-lrc'

const LRC = '[offset:+500]\n[00:10.00]第一句\n[00:20.00]第二句\n[00:30.00]第三句'

describe('偏移叠加([offset:] + 用户偏移)', () => {
  it('[offset:+500] 让歌词整体提前 500ms(时间戳变小)', () => {
    const parsed = parseLrc(LRC)
    expect(parsed.offsetTagMs).toBe(500)
    expect(parsed.lines[0]?.timeMs).toBe(9_500)
  })

  it('用户偏移在定位处叠加,不改动解析结果', () => {
    const parsed = parseLrc(LRC)
    // 播放到 10.2s,用户偏移 -300ms(歌词延后) → 查找位置 9.9s → 仍定位第一句(9.5s)
    const userOffset = -300
    const position = 10_200 + userOffset
    expect(findActiveLine(parsed.lines, position)).toBe(0)
    // 用户偏移 +2s → 查找位置 12.2s,仍早于第二句(19.5s) → 第一句
    expect(findActiveLine(parsed.lines, 10_200 + 2_000)).toBe(0)
    // 用户偏移 +10s → 查找位置 20.2s ≥ 第二句(19.5s) → 进入第二句
    expect(findActiveLine(parsed.lines, 10_200 + 10_000)).toBe(1)
    expect(parsed.lines[1]?.timeMs).toBe(19_500)
  })

  it('重复解析(缓存回读)结果幂等,offset 不二次叠加', () => {
    const first = parseLrc(LRC)
    const second = parseLrc(LRC)
    expect(second.lines).toEqual(first.lines)
    expect(second.offsetTagMs).toBe(500)
  })

  it('负 offset 与零 offset', () => {
    expect(parseLrc('[offset:-200]\n[00:10.00]a').lines[0]?.timeMs).toBe(10_200)
    expect(parseLrc('[00:10.00]a').offsetTagMs).toBe(0)
  })
})
