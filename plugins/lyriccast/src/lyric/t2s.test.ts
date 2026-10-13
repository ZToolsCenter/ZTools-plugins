/**
 * 繁→简显示转换测试:
 * - 繁体判定:繁体段落命中、简体段落不误判、假名守卫(日文歌词)、拉丁/空文本;
 * - 阈值防误判:个别繁体用字的简体文本不触发;
 * - 逐字转换:常用字、表外字符保留、繁简同形字;
 * - 批量转换门控:非繁体返回 null、等长保证、无繁体字的行原样保留。
 */
import { describe, expect, it } from 'vitest'
import {
  analyzeTraditional,
  convertTextsIfTraditional,
  hasTraditionalChar,
  isTraditionalChinese,
  toSimplified
} from './t2s'

/** 特征字密集的繁体段落 */
const TRAD = '這是一段繁體中文歌詞用來驗證偵測邏輯與轉換品質的測試文本'
/** 与上句对应的简体写法(特征字应接近零) */
const SIMP = '这是一段简体中文歌词用来验证侦测逻辑与转换品质的测试文本'

describe('繁体判定', () => {
  it('繁体段落判定为繁体,统计字段正确', () => {
    const stats = analyzeTraditional(TRAD)
    expect(stats.traditional).toBe(true)
    expect(stats.kana).toBe(0)
    expect(stats.hits).toBeGreaterThanOrEqual(3)
    expect(stats.hanTotal).toBeGreaterThanOrEqual(stats.hits)
  })

  it('简体段落不判定为繁体', () => {
    expect(isTraditionalChinese(SIMP)).toBe(false)
  })

  it('含假名视为日文歌词,即使有繁体字形也不转换', () => {
    expect(isTraditionalChinese('愛してる 世界で一番の寶物')).toBe(false)
  })

  it('纯拉丁文本不判定为繁体', () => {
    expect(isTraditionalChinese('Hello World, just an English lyric line')).toBe(false)
  })

  it('空文本不判定为繁体', () => {
    expect(isTraditionalChinese('')).toBe(false)
  })

  it('个别繁体用字不至误判简体歌词(低于绝对数阈值)', () => {
    expect(isTraditionalChinese('爱在黎明破晓前 裡程碑之夜')).toBe(false)
  })

  it('短繁体行达到绝对数即判定(占比阈值放行)', () => {
    // 6 个汉字中 4 个特征字(聽/媽/話),占比 67% 远超 2%
    expect(isTraditionalChinese('聽媽媽的話')).toBe(true)
  })
})

describe('toSimplified 逐字转换', () => {
  it('常用繁体字逐字转换', () => {
    expect(toSimplified('聽媽媽的話')).toBe('听妈妈的话')
    expect(toSimplified('時間都去哪兒了')).toBe('时间都去哪儿了')
  })

  it('表外字符原样保留(拉丁/标点/数字)', () => {
    expect(toSimplified('Uptown Funk 你聽過嗎? (feat. Bruno Mars)')).toBe(
      'Uptown Funk 你听过吗? (feat. Bruno Mars)'
    )
  })

  it('繁简同形字不受影响', () => {
    expect(toSimplified('一心一意的人')).toBe('一心一意的人')
  })
})

describe('hasTraditionalChar 行级过滤', () => {
  it('含繁体字的行返回 true', () => {
    expect(hasTraditionalChar('聽媽媽的話')).toBe(true)
  })

  it('纯简体/拉丁行返回 false', () => {
    expect(hasTraditionalChar('听妈妈的话')).toBe(false)
    expect(hasTraditionalChar('La La Land')).toBe(false)
  })
})

describe('convertTextsIfTraditional 批量门控', () => {
  it('繁体行逐行转换且与入参等长', () => {
    const input = ['時間都去哪兒了', '還沒好好感受年輕就老了', '我們尋找的青春']
    const output = convertTextsIfTraditional(input)
    expect(output).not.toBeNull()
    expect(output).toHaveLength(input.length)
    expect(output![0]).toBe('时间都去哪儿了')
    expect(output![2]).toBe('我们寻找的青春')
  })

  it('批量中不含繁体字的行原样保留', () => {
    const output = convertTextsIfTraditional(['聽媽媽的話', 'La La Land', '12345'])
    expect(output).toEqual(['听妈妈的话', 'La La Land', '12345'])
  })

  it('非繁体批次返回 null(调用方沿用原文)', () => {
    expect(convertTextsIfTraditional([SIMP])).toBeNull()
    expect(convertTextsIfTraditional(['Hello World'])).toBeNull()
  })

  it('空数组返回 null', () => {
    expect(convertTextsIfTraditional([])).toBeNull()
  })
})
