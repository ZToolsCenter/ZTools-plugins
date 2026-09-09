/**
 * tokenizer 单元测试（roadmap 任务 ENG-002：CJK 感知词法切词）。
 *
 * 覆盖 `src/core/tokenizer.ts` 的三个导出：
 * - 拼接恒等式（铁律）：`tokenizeWords(text).join('') === text` 与
 *   `tokenizeChars(text).join('') === text` 对中 / 英 / 混合 / 纯数字 /
 *   emoji / 制表符 / 连续空格 / 空串 / 换行符 / 孤立代理项等输入全部成立；
 * - `tokenizeWords` 分类正确性：拉丁词（下划线并入）、数字串独立、
 *   CJK 逐字（汉字 / 假名 / 谚文）、空白合并、标点与 emoji 逐 code point；
 * - `tokenizeChars`：逐 code point 切分（emoji 代理对不劈开），空白不合并；
 * - `isCjkChar`：单字符判定与行内包含判定（ENG-004 高亮策略用法）；
 * - O(n) / 无死循环：10 万字符长文本单趟完成且恒等式成立（性能粗测）。
 */
import { describe, expect, it } from 'vitest'
import { isCjkChar, tokenizeChars, tokenizeWords } from '../../src/core/tokenizer'

/* -------------------------------------------------------------------------- */
/* 拼接恒等式（铁律：tokens.join('') 必须还原原文）                              */
/* -------------------------------------------------------------------------- */

describe('拼接恒等式（无损：join 还原原文）', () => {
  // [用例标签, 输入文本]；标签仅用于测试名可读，输入才是断言对象。
  const samples: Array<[string, string]> = [
    ['空串', ''],
    ['英文单词与空格', 'hello world'],
    ['纯中文', '对比两段文本差异'],
    ['中英混合', '中文 English 混排 v1.2.3！'],
    ['纯数字', '1234567890'],
    ['emoji 与 BMP 外字符', 'a🎉b🇨🇳𠀀'], // 🇨🇳 为区域指示符对，𠀀 为扩展 B 区汉字
    ['制表符', 'a\tb\t\tc'],
    ['连续空格', 'a   b    c'],
    ['三种换行符', 'a\nb\r\nc\rd'],
    ['\\s 类空白（NBSP / 全角空格 / BOM）', '\u00a0A\u3000B\ufeffC'],
    ['下划线并入词', 'foo_bar __init__ ___'],
    ['中文标点', '，。！？！、（）：；'],
    ['孤立代理项（非法 UTF-16 序列）', '\uD800孤\uDC00立代理项'],
  ]

  for (const [label, text] of samples) {
    it(`tokenizeWords / tokenizeChars 恒等成立：${label}`, () => {
      expect(tokenizeWords(text).join('')).toBe(text)
      expect(tokenizeChars(text).join('')).toBe(text)
    })
  }
})

/* -------------------------------------------------------------------------- */
/* tokenizeWords 分类正确性                                                     */
/* -------------------------------------------------------------------------- */

describe('tokenizeWords 分类正确性', () => {
  it('英文与空格："hello world" → ["hello", " ", "world"]', () => {
    expect(tokenizeWords('hello world')).toEqual(['hello', ' ', 'world'])
  })

  it('中英相邻直接切开："你好world" → ["你", "好", "world"]', () => {
    expect(tokenizeWords('你好world')).toEqual(['你', '好', 'world'])
  })

  it('数字与拉丁字母相邻时独立成 token："v1" → ["v", "1"]', () => {
    expect(tokenizeWords('v1')).toEqual(['v', '1'])
  })

  it('版本号切分："v1.2.3" → ["v", "1", ".", "2", ".", "3"]', () => {
    expect(tokenizeWords('v1.2.3')).toEqual(['v', '1', '.', '2', '.', '3'])
  })

  it('蛇形命名不拆："foo_bar" 成一词；纯下划线串也成词', () => {
    expect(tokenizeWords('foo_bar')).toEqual(['foo_bar'])
    expect(tokenizeWords('__init__')).toEqual(['__init__'])
    expect(tokenizeWords('___')).toEqual(['___'])
  })

  it('连字符按标点处理："hello-world" → ["hello", "-", "world"]', () => {
    expect(tokenizeWords('hello-world')).toEqual(['hello', '-', 'world'])
  })

  it('数字串独立："123abc456" → ["123", "abc", "456"]', () => {
    expect(tokenizeWords('123abc456')).toEqual(['123', 'abc', '456'])
  })

  it('中文标点逐字："中文，。！" → 5 个单字 token', () => {
    expect(tokenizeWords('中文，。！')).toEqual(['中', '文', '，', '。', '！'])
  })

  it('emoji 逐 code point："a🎉b" → ["a", "🎉", "b"]（代理对不劈开）', () => {
    expect(tokenizeWords('a🎉b')).toEqual(['a', '🎉', 'b'])
  })

  it('空白合并为一个 token：制表符 / 连续空白 / 跨换行空白 / NBSP', () => {
    expect(tokenizeWords('\t')).toEqual(['\t'])
    expect(tokenizeWords('a\t\tb')).toEqual(['a', '\t\t', 'b'])
    expect(tokenizeWords('a  \n  b')).toEqual(['a', '  \n  ', 'b'])
    expect(tokenizeWords('a\u00a0\u00a0b')).toEqual(['a', '\u00a0\u00a0', 'b'])
  })

  it('空串 → 空 token 数组', () => {
    expect(tokenizeWords('')).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* CJK 逐字切词                                                                 */
/* -------------------------------------------------------------------------- */

describe('CJK 逐字切词', () => {
  it('"对比两段文本" → 6 个单字 token（解决中文整句一个 token 的问题）', () => {
    expect(tokenizeWords('对比两段文本')).toEqual(['对', '比', '两', '段', '文', '本'])
  })

  it('假名与谚文同样逐字', () => {
    expect(tokenizeWords('ひらがなカタカナ')).toEqual([
      'ひ', 'ら', 'が', 'な', 'カ', 'タ', 'カ', 'ナ',
    ])
    expect(tokenizeWords('한국어')).toEqual(['한', '국', '어'])
  })

  it('汉字扩展 A 区与兼容表意区也在 CJK 类内', () => {
    // 㐀 = U+3400（扩展 A 区首字符），豈 = U+F900（兼容表意区首字符）
    expect(tokenizeWords('㐀豈')).toEqual(['㐀', '豈'])
  })

  it('BMP 外扩展 B 区汉字走兜底路径，粒度仍是逐字', () => {
    // 𠀀 = U+20000（代理对，2 个 UTF-16 code unit、1 个 code point）
    expect(tokenizeWords('𠀀')).toEqual(['𠀀'])
  })
})

/* -------------------------------------------------------------------------- */
/* tokenizeChars 字符级切词                                                     */
/* -------------------------------------------------------------------------- */

describe('tokenizeChars 字符级切词', () => {
  it('"a🎉b" → ["a", "🎉", "b"]（3 个 code point，不是 4 个）', () => {
    const tokens = tokenizeChars('a🎉b')
    expect(tokens).toEqual(['a', '🎉', 'b'])
    expect(tokens).toHaveLength(3)
  })

  it('逐 code point 且空白不合并', () => {
    expect(tokenizeChars('a  b\t')).toEqual(['a', ' ', ' ', 'b', '\t'])
    expect(tokenizeChars('ab🎉你好')).toEqual(['a', 'b', '🎉', '你', '好'])
  })

  it('空串 → []；BMP 外字符成单元素 token', () => {
    expect(tokenizeChars('')).toEqual([])
    expect(tokenizeChars('𠀀')).toEqual(['𠀀'])
  })
})

/* -------------------------------------------------------------------------- */
/* isCjkChar                                                                    */
/* -------------------------------------------------------------------------- */

describe('isCjkChar', () => {
  it('汉字 / 假名 / 谚文为 CJK；拉丁 / 数字 / 全角标点 / 空白 / emoji 不是', () => {
    expect(isCjkChar('中')).toBe(true)
    expect(isCjkChar('あ')).toBe(true)
    expect(isCjkChar('ア')).toBe(true)
    expect(isCjkChar('가')).toBe(true)
    expect(isCjkChar('a')).toBe(false)
    expect(isCjkChar('1')).toBe(false)
    expect(isCjkChar('，')).toBe(false) // 全角标点属「其他符号」类，不是 CJK 文字
    expect(isCjkChar(' ')).toBe(false)
    expect(isCjkChar('🎉')).toBe(false)
  })

  it('传入整行判断行内是否含 CJK（ENG-004 高亮策略用法）', () => {
    expect(isCjkChar('const x = 1')).toBe(false)
    expect(isCjkChar('const x = 1 // 中文注释')).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* O(n) / 无死循环（性能粗测）                                                   */
/* -------------------------------------------------------------------------- */

describe('O(n) / 无死循环（性能粗测）', () => {
  it('10 万字符长文本单趟完成且拼接恒等式成立', () => {
    // 单段 26 个 UTF-16 code unit（含 1 个 BMP 外 emoji）× 4000 ≈ 10.4 万
    // 字符，覆盖全部五类 token；若实现存在死循环或回溯灾难，本用例会
    // 超时失败（timeout 已放宽到 30s，正常应在毫秒级完成）。
    const segment = '中文 text_123 v1.2.3 🎉\t\t，。\n'
    const text = segment.repeat(4000)

    const words = tokenizeWords(text)
    expect(words.length).toBeGreaterThan(10000)
    expect(words.join('')).toBe(text)

    const chars = tokenizeChars(text)
    expect(chars.length).toBeGreaterThan(10000)
    expect(chars.join('')).toBe(text)
  }, 30000)
})
