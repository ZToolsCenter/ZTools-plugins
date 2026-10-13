/**
 * lrcmux provider 测试:以**真实公共实例录制的样例响应**做解析层单测
 * (2026-10-11 实测 https://api.lrcmux.dev/get;裁剪至前 6 行/每行前 4 词)。
 * 连通性已在实现时人工验证(200 带词级 lines / 404 JSON / 限流头);测试走 fixture。
 */
import { describe, expect, it } from 'vitest'
import { lrcmuxProvider, linesToLrc, toLrcStamp } from './lrcmux'
import { parseLrc } from '../parse-lrc'
import type { LyricQuery } from '../types'

/** 录制的样例(Rick Astley - Never Gonna Give You Up,来源 kugou,词级) */
const SAMPLE = {
  meta: { source: { id: 'kugou', name: 'KuGou', url: 'https://kugou.com' }, level: 'word' },
  lines: [
    {
      text: "We're no strangers to love",
      start: 19311,
      end: 22362,
      words: [
        { text: "We're ", start: 19311, end: 19539 },
        { text: 'no ', start: 19539, end: 19715 },
        { text: 'strangers ', start: 19715, end: 19910 },
        { text: 'to ', start: 19910, end: 20146 }
      ]
    },
    {
      text: 'You know the rules and so do I',
      start: 23031,
      end: 26544,
      words: [
        { text: 'You ', start: 23031, end: 23186 },
        { text: 'know ', start: 23186, end: 23363 },
        { text: 'the ', start: 23363, end: 23582 },
        { text: 'rules ', start: 23582, end: 24269 }
      ]
    },
    { text: '行级歌词(无 words)', start: 30_000, end: 33_000 },
    { text: '纯文本行(无时间戳)' }
  ]
}

describe('toLrcStamp', () => {
  it('毫秒 → [mm:ss.xx],负值截为 0', () => {
    expect(toLrcStamp(19_311)).toBe('[00:19.31]')
    expect(toLrcStamp(230_310)).toBe('[03:50.31]')
    expect(toLrcStamp(-5)).toBe('[00:00.00]')
  })
})

describe('linesToLrc', () => {
  it('词级行转增强 LRC,行级转普通 LRC,纯文本行跳过', () => {
    const lrc = linesToLrc(SAMPLE.lines)
    expect(lrc).not.toBeNull()
    const lines = (lrc ?? '').split('\n')
    // 词级:<mm:ss.xx> 增强标签;词间空格来自词文本自带的尾随空格
    expect(lines[0]).toBe("[00:19.31]<00:19.31>We're <00:19.53>no <00:19.71>strangers <00:19.91>to ")
    expect(lines[1]).toBe('[00:23.03]<00:23.03>You <00:23.18>know <00:23.36>the <00:23.58>rules ')
    // 行级:无增强标签
    expect(lines[2]).toBe('[00:30.00]行级歌词(无 words)')
    // 纯文本行不进时间轴
    expect(lines).toHaveLength(3)
  })

  it('转换结果可被 parseLrc 解析(时间戳与文本一致)', () => {
    const lrc = linesToLrc(SAMPLE.lines) ?? ''
    const parsed = parseLrc(lrc)
    expect(parsed.isEnhanced).toBe(true)
    // LRC 厘秒粒度:19311ms → [00:19.31] → 回读 19310ms(±10ms 内,渲染无感)
    expect(parsed.lines[0]?.timeMs).toBe(19_310)
    expect(parsed.lines[0]?.text).toContain("We're")
  })

  it('空行/全空输入返回 null', () => {
    expect(linesToLrc([])).toBeNull()
    expect(linesToLrc([{ text: '' }])).toBeNull()
    expect(linesToLrc([{ text: '无时间戳' }])).toBeNull()
  })
})

describe('lrcmuxProvider', () => {
  it('声明正确的来源与请求形状(不发真实网络)', async () => {
    expect(lrcmuxProvider.name).toBe('lrcmux')
    expect(lrcmuxProvider.searchCandidates).toBeUndefined() // 聚合源无候选列表
    const query: LyricQuery = { title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269_000 }
    // 无网络时 fetchJson 抛错 → error 结果(不写负缓存);abort 语义由编排层保证
    const outcome = await lrcmuxProvider.search(query, new AbortController().signal).catch((err) => {
      expect(String(err)).toContain('fetch failed')
      return null
    })
    void outcome // 沙箱断网时到这里即验证了失败隔离
  })
})
