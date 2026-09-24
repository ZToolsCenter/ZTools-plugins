/**
 * 本地历史纯模型单元测试（roadmap 任务 INT-004）。
 *
 * 覆盖 `src/core/historyModel.ts` 的四个出口：
 * - `pushHistoryItem`：空列表追加 / 去重（left+right+optionsKey+contextLines
 *   全同 → 替换为新条目）/ optionsKey 参与去重（options 不同不算同条）/
 *   规则对象不同但指纹相同仍去重（键只看 pattern+flags）/ 置顶 / 默认 100
 *   条截尾 / 自定义 max / 非法 max 防御 / 不可变（structuredClone 快照比对）；
 * - `searchHistoryItems`：空查询原数组返回（含纯空白）/ 大小写不敏感 /
 *   title 与 left/right 内容命中 / 无命中空集；
 * - `deriveHistoryTitle`：文件名对 → `nameA ↔ nameB` / 单侧文件名 → 定义为
 *   回退内容摘要（spec 的「否则」分支，行为在断言中固化）/ 首非空行跳过空
 *   行并 trim / 超 24 字符截断加省略号 / 恰好 24 字符不截断 / 空文本与全
 *   空白文本 → '未命名对比'；
 * - `historyItemKey`：同身份同键（节流与去重共用同一事实来源）。
 */
import { describe, expect, it } from 'vitest'
import {
  HISTORY_MAX_ITEMS,
  UNTITLED_HISTORY_TEXT,
  deriveHistoryTitle,
  historyItemKey,
  pushHistoryItem,
  searchHistoryItems,
} from '../../src/core/historyModel'
import type { HistoryItem } from '../../src/core/historyModel'
import { DEFAULT_OPTIONS } from '../../src/core/options'
import type { DiffOptions } from '../../src/core/types'

/** 构造完整 HistoryItem：缺省字段用合法兜底值填充。 */
function makeItem(partial: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: `id-${Math.random().toString(36).slice(2, 10)}`,
    title: '标题',
    savedAt: 1_700_000_000_000,
    left: 'a\nb',
    right: 'a\nB',
    options: { ...DEFAULT_OPTIONS, ignoreRules: [] },
    contextLines: 3,
    stats: { addedLines: 1, removedLines: 0, modifiedPairs: 0, hunkCount: 1, totalRows: 3 },
    language: 'plaintext',
    ...partial,
  }
}

/** 带启用的忽略规则的选项（用于 optionsKey / 规则指纹维度断言）。 */
function optionsWithRule(pattern: string, ignoreWhitespace = false): DiffOptions {
  return {
    ignoreWhitespace,
    ignoreCase: false,
    ignoreEmptyLines: false,
    ignoreRules: [{ id: 'r1', pattern, flags: 'g', enabled: true }],
  }
}

/* -------------------------------------------------------------------------- */
/* pushHistoryItem：追加与去重                                                  */
/* -------------------------------------------------------------------------- */

describe('pushHistoryItem 追加与去重', () => {
  it('空列表追加：插入头部（最新在前），返回新数组且长度 +1', () => {
    const first = makeItem({ id: 'a' })
    // 第二条换文本：身份键含 left 全文，同文本会被去重而非追加。
    const second = makeItem({ id: 'b', left: 'x\ny' })
    const one = pushHistoryItem([], first)
    expect(one).toHaveLength(1)
    expect(one[0].id).toBe('a')
    const two = pushHistoryItem(one, second)
    expect(two.map((it) => it.id)).toEqual(['b', 'a'])
  })

  it('去重：left+right+options+contextLines 全同 → 替换为新条目（不产生第二条）', () => {
    const base = makeItem({ id: 'old', savedAt: 1_000 })
    const items = pushHistoryItem([], base)
    const newer = makeItem({ id: 'new', savedAt: 2_000, title: '更新后的标题' })
    const next = pushHistoryItem(items, newer)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('new')
    expect(next[0].savedAt).toBe(2_000)
    expect(next[0].title).toBe('更新后的标题')
  })

  it('optionsKey 参与去重：文本相同但 options 不同（开关不同）→ 两条独立记录', () => {
    const base = makeItem({ id: 'strict', options: { ...DEFAULT_OPTIONS, ignoreRules: [] } })
    const variant = makeItem({
      id: 'ws',
      options: { ...DEFAULT_OPTIONS, ignoreRules: [], ignoreWhitespace: true },
    })
    const items = pushHistoryItem(pushHistoryItem([], base), variant)
    expect(items.map((it) => it.id)).toEqual(['ws', 'strict'])
  })

  it('contextLines 参与去重：其余全同但上下文行数不同 → 两条独立记录', () => {
    const base = makeItem({ id: 'c3', contextLines: 3 })
    const variant = makeItem({ id: 'c0', contextLines: 0 })
    const items = pushHistoryItem(pushHistoryItem([], base), variant)
    expect(items.map((it) => it.id)).toEqual(['c0', 'c3'])
  })

  it('规则对象不同但 pattern+flags 指纹相同 → 仍视为同一条去重（键只看指纹）', () => {
    const base = makeItem({ id: 'r1', options: optionsWithRule('\\d+') })
    // 同 pattern/flags 的另一份规则对象实例（不同引用、不同 id）。
    const variant = makeItem({ id: 'r2', options: optionsWithRule('\\d+') })
    const next = pushHistoryItem(pushHistoryItem([], base), variant)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('r2')
  })

  it('规则指纹不同（pattern / flags / 顺序）→ 独立记录', () => {
    const base = pushHistoryItem([], makeItem({ id: 'digits', options: optionsWithRule('\\d+') }))
    const words = pushHistoryItem(base, makeItem({ id: 'words', options: optionsWithRule('\\w+') }))
    const flags = pushHistoryItem(
      words,
      makeItem({ id: 'flags', options: optionsWithRule('\\d+', true) }),
    )
    expect(flags.map((it) => it.id)).toEqual(['flags', 'words', 'digits'])
  })

  it('置顶：去重替换后新条目恒在头部，其余条目相对顺序不变', () => {
    const a = makeItem({ id: 'a' })
    const b = makeItem({ id: 'b', left: 'x\ny' })
    const items = pushHistoryItem(pushHistoryItem([], a), b)
    const aNewer = makeItem({ id: 'a2', left: a.left, right: a.right })
    const next = pushHistoryItem(items, aNewer)
    expect(next.map((it) => it.id)).toEqual(['a2', 'b'])
    expect(next).toHaveLength(2)
  })

  it('默认截尾：超过 HISTORY_MAX_ITEMS（100）条时淘汰最旧的（数组尾部）', () => {
    let items: HistoryItem[] = []
    for (let i = 0; i < HISTORY_MAX_ITEMS + 10; i += 1) {
      // 每条文本不同，保证互不去重。
      items = pushHistoryItem(items, makeItem({ id: `id-${i}`, left: `text-${i}` }))
    }
    expect(items).toHaveLength(HISTORY_MAX_ITEMS)
    // 共入 110 条、截尾 10 条：最新是 id-109，最旧幸存者是 id-10。
    expect(items[0].id).toBe(`id-${HISTORY_MAX_ITEMS + 9}`)
    expect(items[items.length - 1].id).toBe('id-10')
  })

  it('自定义 max：max=2 时只保留最新两条；非法 max（0 / 负数 / NaN）截为空数组', () => {
    const a = makeItem({ id: 'a', left: 'a-1' })
    const b = makeItem({ id: 'b', left: 'b-2' })
    const c = makeItem({ id: 'c', left: 'c-3' })
    let items: HistoryItem[] = []
    items = pushHistoryItem(items, a, 2)
    items = pushHistoryItem(items, b, 2)
    items = pushHistoryItem(items, c, 2)
    expect(items.map((it) => it.id)).toEqual(['c', 'b'])

    expect(pushHistoryItem([], a, 0)).toEqual([])
    expect(pushHistoryItem([], a, -1)).toEqual([])
    expect(pushHistoryItem([], a, Number.NaN)).toEqual([])
  })

  it('不可变：入参数组与其元素经 structuredClone 快照比对，调用后原样不变', () => {
    const original = pushHistoryItem([], makeItem({ id: 'a', options: optionsWithRule('\\d+') }))
    const snapshot = structuredClone(original)
    const next = pushHistoryItem(original, makeItem({ id: 'b' }))
    // 新数组是新引用；入参数组（含嵌套 options 规则对象）深度不变。
    expect(next).not.toBe(original)
    expect(original).toEqual(snapshot)
    expect(original).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* searchHistoryItems                                                          */
/* -------------------------------------------------------------------------- */

describe('searchHistoryItems', () => {
  const items = [
    makeItem({ id: 'a', title: '配置文件对比', left: 'alpha=1\nbeta=2', right: 'alpha=2\nbeta=2' }),
    makeItem({ id: 'b', title: '代码评审', left: 'function foo() {}', right: 'function bar() {}' }),
    makeItem({ id: 'c', title: 'README', left: '# 项目说明\n正文', right: '# 项目简介\n正文' }),
  ]

  it('空查询（空串 / 纯空白）返回原数组（同一引用，不做过滤拷贝）', () => {
    expect(searchHistoryItems(items, '')).toBe(items)
    expect(searchHistoryItems(items, '   ')).toBe(items)
    expect(searchHistoryItems(items, '\t \n')).toBe(items)
  })

  it('大小写不敏感：关键字 FOO 命中 left 的 function 行内容', () => {
    expect(searchHistoryItems(items, 'FOO').map((it) => it.id)).toEqual(['b'])
  })

  it('标题命中：按 title 子串匹配', () => {
    expect(searchHistoryItems(items, '配置').map((it) => it.id)).toEqual(['a'])
  })

  it('内容命中：left 或 right 任一侧子串匹配', () => {
    expect(searchHistoryItems(items, '项目简介').map((it) => it.id)).toEqual(['c'])
    expect(searchHistoryItems(items, 'beta=2').map((it) => it.id)).toEqual(['a'])
  })

  it('无命中 → 空数组；多命中保持原有顺序', () => {
    expect(searchHistoryItems(items, '不存在的关键字')).toEqual([])
    const both = [
      makeItem({ id: 'x', title: '第一份 alpha 报告' }),
      makeItem({ id: 'y', left: 'alpha 内容' }),
      makeItem({ id: 'z', title: '别的' }),
    ]
    expect(searchHistoryItems(both, 'alpha').map((it) => it.id)).toEqual(['x', 'y'])
  })
})

/* -------------------------------------------------------------------------- */
/* deriveHistoryTitle                                                          */
/* -------------------------------------------------------------------------- */

describe('deriveHistoryTitle', () => {
  it('文件名对存在 → `nameA ↔ nameB`（两侧 trim）', () => {
    expect(deriveHistoryTitle('a\nb', 'a\nc', 'a.txt', 'b.ts')).toBe('a.txt ↔ b.ts')
    expect(deriveHistoryTitle('a', 'b', ' old.js ', ' new.ts ')).toBe('old.js ↔ new.ts')
  })

  it('单侧文件名（仅左 / 仅右）→ 定义为回退内容摘要（文件名【对】才用文件名标题）', () => {
    // 定义行为：spec 的「否则」分支 —— 单侧文件名不足以建立「文件 ↔ 文件」
    // 的标题语义，回退 left 首非空行摘要，不混拼「name ↔ 未命名」。
    expect(deriveHistoryTitle('第一行\n第二行', 'x', 'only.txt', '')).toBe('第一行')
    expect(deriveHistoryTitle('第一行\n第二行', 'x', '', 'only.txt')).toBe('第一行')
    expect(deriveHistoryTitle('第一行', 'x', undefined, 'only.txt')).toBe('第一行')
  })

  it('首非空行摘要：跳过前导空行与纯空白行，取首行 trim 后内容', () => {
    expect(deriveHistoryTitle('\n', 'x')).toBe(UNTITLED_HISTORY_TEXT)
    expect(deriveHistoryTitle('\n\n   \n\t\n真正的首行\n次行', 'x')).toBe('真正的首行')
    expect(deriveHistoryTitle('   带缩进的首行   \n次行', 'x')).toBe('带缩进的首行')
  })

  it('截断：超过 24 字符截断并追加省略号；恰好 24 字符不截断', () => {
    const exactly24 = '一二三四五六七八九一二三四五六七八九一二三四' // 22 个汉字
    expect(deriveHistoryTitle(exactly24 + 'ab', 'x')).toBe(`${exactly24}ab`) // 24 字符
    expect(deriveHistoryTitle(exactly24 + 'abc', 'x')).toBe(`${exactly24}ab…`) // 25 → 24 + …
  })

  it('空文本与全空白文本 → 未命名对比', () => {
    expect(deriveHistoryTitle('', 'x')).toBe(UNTITLED_HISTORY_TEXT)
    expect(deriveHistoryTitle('', '', '', '')).toBe(UNTITLED_HISTORY_TEXT)
    expect(deriveHistoryTitle(' \n \t \n ', 'x')).toBe(UNTITLED_HISTORY_TEXT)
  })

  it('码点安全：emoji 等增补平面字符按码点截断，不产生残缺代理对', () => {
    const text = '🚀'.repeat(30) // 30 个码点，每个占 2 个 UTF-16 码元
    expect(deriveHistoryTitle(text, 'x')).toBe('🚀'.repeat(24) + '…')
    // 断言按码点数（25 = 24 码点 + 省略号），而非 UTF-16 code units。
    expect(Array.from(deriveHistoryTitle(text, 'x')).length).toBe(25)
  })
})

/* -------------------------------------------------------------------------- */
/* historyItemKey：节流与去重共用同一身份键                                      */
/* -------------------------------------------------------------------------- */

describe('historyItemKey', () => {
  it('身份相同的条目（不同 id / savedAt）→ 同键', () => {
    const a = makeItem({ id: 'x', savedAt: 1 })
    const b = makeItem({ id: 'y', savedAt: 2 })
    expect(historyItemKey(a)).toBe(historyItemKey(b))
  })

  it('身份不同（文本 / 选项 / 上下文行数任一不同）→ 不同键', () => {
    const base = makeItem({})
    expect(historyItemKey(base)).not.toBe(historyItemKey(makeItem({ left: 'a\nb\n+' })))
    expect(historyItemKey(base)).not.toBe(historyItemKey(makeItem({ contextLines: 5 })))
    expect(historyItemKey(base)).not.toBe(
      historyItemKey(makeItem({ options: { ...DEFAULT_OPTIONS, ignoreRules: [], ignoreCase: true } })),
    )
  })
})
