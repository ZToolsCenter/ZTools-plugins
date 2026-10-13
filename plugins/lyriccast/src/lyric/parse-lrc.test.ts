import { describe, expect, it } from 'vitest'
import { findActiveLine, isUsableSynced, lrcToPlain, parseLrc } from './parse-lrc'

describe('parseLrc', () => {
  it('parses two-digit and three-digit millisecond stamps', () => {
    const parsed = parseLrc('[00:12.30]two-digit\n[01:05.123]three-digit')
    expect(parsed.lines.map((l) => l.timeMs)).toEqual([12300, 65123])
    expect(parsed.lines.map((l) => l.text)).toEqual(['two-digit', 'three-digit'])
  })

  it('supports multiple timestamps on one line', () => {
    const parsed = parseLrc('[00:10.00][01:20.50]chorus')
    expect(parsed.lines).toEqual([
      { timeMs: 10000, text: 'chorus' },
      { timeMs: 80500, text: 'chorus' }
    ])
  })

  it('applies [offset:] tag (positive shifts lyrics earlier)', () => {
    const parsed = parseLrc('[offset:+500]\n[00:10.00]line')
    expect(parsed.offsetTagMs).toBe(500)
    expect(parsed.lines[0]?.timeMs).toBe(9500)
    const negative = parseLrc('[offset:-200]\n[00:10.00]line')
    expect(negative.lines[0]?.timeMs).toBe(10200)
  })

  it('strips enhanced word timestamps and flags them', () => {
    const parsed = parseLrc('[00:12.00]<00:12.00>你<00:12.50>好')
    expect(parsed.isEnhanced).toBe(true)
    expect(parsed.lines[0]?.text).toBe('你好')
  })

  it('ignores metadata lines and sorts output', () => {
    const parsed = parseLrc('[ar:周杰伦]\n[ti:晴天]\n[00:20.00]b\n[00:10.00]a\n')
    expect(parsed.lines.map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('dedupes identical timestamp+text pairs', () => {
    const parsed = parseLrc('[00:10.00]a\n[00:10.00]a')
    expect(parsed.lines.length).toBe(1)
  })

  it('returns empty lines for garbage input', () => {
    expect(parseLrc('').lines).toEqual([])
    expect(parseLrc('plain text only').lines).toEqual([])
  })
})


describe('元数据行过滤(任务 2.5)', () => {
  it('开头区域的"作词/作曲"行不进入歌词体', () => {
    const parsed = parseLrc('[00:00.50]作词 : 周杰伦\n[00:00.60]作曲 : 周杰伦\n[00:01.00]第一句\n[00:12.00]第二句')
    expect(parsed.lines.map((l) => l.text)).toEqual(['第一句', '第二句'])
  })

  it('全角冒号与英文关键词同样过滤', () => {
    const parsed = parseLrc('[00:00.10]Lyrics by: Someone\n[00:00.20]编曲:Another\n[00:01.00]la')
    expect(parsed.lines.map((l) => l.text)).toEqual(['la'])
  })

  it('正式歌词出现后的同类行不误删(保守:仅限开头区域)', () => {
    const parsed = parseLrc('[00:01.00]雨下了一整夜\n[00:12.00]作词:周杰伦\n[00:30.00]第二句')
    expect(parsed.lines.map((l) => l.text)).toEqual(['雨下了一整夜', '作词:周杰伦', '第二句'])
  })

  it('元数据空壳歌词被判为不可用(网易云无歌词场景)', () => {
    const shell = '[00:00.50]作词 : 张三\n[00:00.60]作曲 : 李四\n[00:00.70]混音:王五'
    expect(isUsableSynced(shell)).toBe(false)
    expect(parseLrc(shell).lines).toEqual([])
  })

  it('lrcToPlain 同样滤除开头制作信息', () => {
    expect(lrcToPlain('[00:00.50]作词 : 张三\n[00:01.00]第一句')).toBe('第一句')
  })
})

describe('findActiveLine', () => {
  const lines = parseLrc('[00:10.00]a\n[00:20.00]b\n[00:30.00]c').lines

  it('returns -1 before the first line', () => {
    expect(findActiveLine(lines, 0)).toBe(-1)
    expect(findActiveLine(lines, 9999)).toBe(-1)
  })

  it('returns the last line whose time <= position', () => {
    expect(findActiveLine(lines, 10000)).toBe(0)
    expect(findActiveLine(lines, 10001)).toBe(0)
    expect(findActiveLine(lines, 20000)).toBe(1)
    expect(findActiveLine(lines, 99999)).toBe(2)
  })
})
