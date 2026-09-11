/**
 * 语法高亮单元测试（roadmap 任务 INT-001）。
 *
 * 覆盖 `src/core/highlight.ts`：
 * - `getParser` / 语言包按需注册：12 语言包 parser 均可取得、plaintext /
 *   未知语言返回 null；
 * - `highlightLineSpans`：拼接恒等式（spans 拼接恒等于行文本，JS / Python /
 *   YAML / CSS / JSON 样例）、tok-* 类名命中（keyword / string / comment /
 *   number / property）、无 parser 语言单 span、空行、超长行性能（1 万字符
 *   < 100ms）、LRU 缓存命中（同输入返回同一引用）；
 * - `mergeWordSyntax`：词级 diff 与语法高亮的共存合并 —— 拼接恒等式、
 *   changed 片段保留 word-changed、语法类叠加、类名并列形态。
 */
import { describe, expect, it } from 'vitest'
import {
  getParser,
  highlightLineSpans,
  mergeWordSyntax,
  tagToClass,
} from '../../src/core/highlight'
import { tags } from '@lezer/highlight'

/* -------------------------------------------------------------------------- */
/* getParser：语言包按需注册                                                    */
/* -------------------------------------------------------------------------- */

describe('getParser / getLanguageSupport 按需注册', () => {
  it('12 个语言包（含 typescript 变体）都能取得 parser', () => {
    const languages = [
      'javascript',
      'typescript',
      'python',
      'java',
      'go',
      'sql',
      'json',
      'yaml',
      'html',
      'markdown',
      'css',
      'xml',
      'cpp',
    ]
    for (const lang of languages) {
      expect(getParser(lang), `语言 ${lang} 应有 parser`).not.toBeNull()
    }
  })

  it('plaintext / 未知语言 → null（调用方回退纯文本）', () => {
    expect(getParser('plaintext')).toBeNull()
    expect(getParser('cobol')).toBeNull()
    expect(getParser('')).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* highlightLineSpans：拼接恒等式与类名命中                                      */
/* -------------------------------------------------------------------------- */

/** spans 按序拼接恒等于原文本 */
function assertConcatIdentity(text: string, lang: string): void {
  const spans = highlightLineSpans(text, lang)
  expect(spans.map((span) => span.text).join('')).toBe(text)
}

describe('highlightLineSpans 拼接恒等式', () => {
  const samples: Array<[string, string, string]> = [
    ['JavaScript', 'const x = "hi"; // note', 'javascript'],
    ['Python', 'def f():\n    return 1  # 注释', 'python'],
    ['YAML', 'key: value\nother: 2', 'yaml'],
    ['CSS', 'a .b, #c { color: red; }', 'css'],
    ['JSON', '{"a": [1, 2], "b": null}', 'json'],
    ['HTML', '<div class="x">text</div>', 'html'],
    ['Markdown', '# Title\n\n```js\nconst a = 1;\n```', 'markdown'],
    ['空文本', '', 'javascript'],
    ['emoji 与 CJK', 'const 中文 = "🎉" // 🎉', 'javascript'],
  ]

  for (const [label, text, lang] of samples) {
    it(`[${label}] 拼接还原原文`, () => {
      assertConcatIdentity(text, lang)
    })
  }

  it('同一样本重复调用（缓存路径）拼接恒等式仍成立', () => {
    const text = 'const repeat = 1;'
    assertConcatIdentity(text, 'javascript')
    assertConcatIdentity(text, 'javascript')
  })
})

describe('highlightLineSpans tok-* 类名命中', () => {
  it('JavaScript：keyword / string / comment', () => {
    const spans = highlightLineSpans('const s = "hi"; // note', 'javascript')
    const classes = spans.map((span) => span.cls)
    expect(classes).toContain('tok-keyword') // const（definitionKeyword → keyword 父链）
    expect(classes).toContain('tok-string') // "hi"
    expect(classes).toContain('tok-comment') // // note
  })

  it('JSON：propertyName / number', () => {
    const spans = highlightLineSpans('{"count": 42}', 'json')
    const classes = spans.map((span) => span.cls)
    expect(classes).toContain('tok-property')
    expect(classes).toContain('tok-number')
  })

  it('Python：keyword / comment', () => {
    const spans = highlightLineSpans('def f():\n    pass  # 说明', 'python')
    const classes = spans.map((span) => span.cls)
    expect(classes).toContain('tok-keyword') // def（definitionKeyword → keyword 父链）
    expect(classes).toContain('tok-comment')
  })

  it('YAML：propertyName（key）', () => {
    const spans = highlightLineSpans('key: value', 'yaml')
    expect(spans.map((span) => span.cls)).toContain('tok-property')
  })

  it('无语法类的行只产出无类 span（不产生空 tok-* 挂载）', () => {
    const spans = highlightLineSpans('   ', 'javascript')
    expect(spans.every((span) => span.cls === '')).toBe(true)
  })
})

describe('highlightLineSpans 回退与缓存', () => {
  it('无 parser 语言 / 未知语言 → 单 span 纯文本', () => {
    expect(highlightLineSpans('const x = 1;', 'plaintext')).toEqual([
      { text: 'const x = 1;', cls: '' },
    ])
    expect(highlightLineSpans('anything', 'cobol')).toEqual([{ text: 'anything', cls: '' }])
  })

  it('空文本 → 单空 span', () => {
    expect(highlightLineSpans('', 'javascript')).toEqual([{ text: '', cls: '' }])
  })

  it('LRU 缓存命中：同 (lang, text) 返回同一数组引用', () => {
    const first = highlightLineSpans('const cached = "v";', 'javascript')
    const second = highlightLineSpans('const cached = "v";', 'javascript')
    expect(second).toBe(first)
  })

  it('缓存键含 lang：同文本不同语言不串缓存', () => {
    const js = highlightLineSpans('const a = 1;', 'javascript')
    const ts = highlightLineSpans('const a = 1;', 'typescript')
    expect(ts).not.toBe(js)
    assertConcatIdentity('const a = 1;', 'typescript')
  })

  it('超长行性能：1 万字符 < 100ms', () => {
    const longLine = `const s = "${'a'.repeat(9985)}"; // end`
    expect(longLine.length).toBeGreaterThan(10000)
    const start = performance.now()
    const spans = highlightLineSpans(longLine, 'javascript')
    const elapsed = performance.now() - start
    assertConcatIdentity(longLine, 'javascript') // 二次调用走缓存，保证结果形态
    expect(spans.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100)
  }, 5000)
})

/* -------------------------------------------------------------------------- */
/* tagToClass：Tag → 类名映射                                                   */
/* -------------------------------------------------------------------------- */

describe('tagToClass', () => {
  it('显式映射命中（keyword / string / comment）', () => {
    expect(tagToClass(tags.keyword)).toBe('tok-keyword')
    expect(tagToClass(tags.string)).toBe('tok-string')
    expect(tagToClass(tags.comment)).toBe('tok-comment')
  })

  it('未映射 tag → null（保持默认文字色）', () => {
    expect(tagToClass(tags.heading)).toBeNull()
    expect(tagToClass(tags.emphasis)).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* mergeWordSyntax：词级 diff 与语法高亮共存                                     */
/* -------------------------------------------------------------------------- */

describe('mergeWordSyntax 共存合并', () => {
  const syntax = highlightLineSpans('const x = 1;', 'javascript')

  it('拼接恒等式：合并结果还原整行文本', () => {
    const words = [
      { text: 'const ', changed: false },
      { text: 'x', changed: true },
      { text: ' = 1;', changed: false },
    ]
    const merged = mergeWordSyntax(words, syntax)
    expect(merged.map((span) => span.text).join('')).toBe('const x = 1;')
  })

  it('changed 片段保留 word-changed 并叠加语法类；未变更片段仅语法类', () => {
    const words = [
      { text: 'const ', changed: false },
      { text: 'x', changed: true },
      { text: ' = 1;', changed: false },
    ]
    const merged = mergeWordSyntax(words, syntax)
    // 'const' 关键片段：无 changed，仅语法类（keyword）
    expect(merged[0]).toEqual({ text: 'const', cls: 'tok-keyword' })
    // 紧随的空格片段：无语法类无 changed
    expect(merged[1]).toEqual({ text: ' ', cls: '' })
    // changed 的 'x'：词级背景类 + 语法类并列（variableName → tok-variable）
    const xSpan = merged.find((span) => span.text === 'x')
    expect(xSpan?.cls).toContain('word-changed')
    expect(xSpan?.cls).toContain('tok-variable')
    // 空语法类的行：changed 片段只有 word-changed，未变更片段无类
    const plain = mergeWordSyntax(words, [{ text: 'const x = 1;', cls: '' }])
    expect(plain.map((span) => span.cls)).toEqual(['', 'word-changed', ''])
  })

  it('语法边界与词级边界交错时按最小片段切分（双序列两指针）', () => {
    // 词级把语法 keyword 'const' 从中间切开
    const words = [
      { text: 'co', changed: true },
      { text: 'nst x = 1;', changed: false },
    ]
    const merged = mergeWordSyntax(words, syntax)
    expect(merged.map((span) => span.text).join('')).toBe('const x = 1;')
    // 'co' 与 'nst' 都落在 keyword 语法段内，changed 差异保留
    expect(merged[0]).toEqual({ text: 'co', cls: 'word-changed tok-keyword' })
    expect(merged[1].cls).toBe('tok-keyword')
  })

  it('空词级序列 → 空结果（调用方不会传入，防御）', () => {
    expect(mergeWordSyntax([], syntax)).toEqual([])
  })

  it('类名形态约束：cls 只能是空 / word-changed / tok-* 的单层组合', () => {
    const words = [
      { text: 'const ', changed: false },
      { text: 'y', changed: true },
      { text: ' = 2;', changed: false },
    ]
    const merged = mergeWordSyntax(words, highlightLineSpans('const y = 2;', 'javascript'))
    for (const span of merged) {
      if (span.cls === '') continue
      const parts = span.cls.split(' ')
      for (const part of parts) {
        expect(part === 'word-changed' || part.startsWith('tok-')).toBe(true)
      }
      // word-changed 至多出现一次（单个词级片段背景类不重复）
      expect(parts.filter((part) => part === 'word-changed').length).toBeLessThanOrEqual(1)
    }
    // 结构性断言：changed 的 'y' 带词级背景 + 语法类；'=' 带 tok-operator
    expect(merged.find((span) => span.text === 'y')?.cls).toBe('word-changed tok-variable')
    expect(merged.map((span) => span.cls)).toContain('tok-operator')
  })
})
