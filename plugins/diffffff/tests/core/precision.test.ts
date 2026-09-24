/**
 * 智能精度策略与缓存会话单元测试（roadmap 任务 ENG-004）。
 *
 * 覆盖 `src/core/precision.ts` 与 `src/core/diff.ts` 的再导出接线：
 * - `diffSmartPrecision`：行级有差异 → 与 `diffWordPrecision` 深度一致
 *   （骨架一致 + 差异行带 words，equal 行不带）；两侧相同 → 直接返回全
 *   equal 骨架、无 words；降级分支（骨架全 equal 但串不同，如尾部换行 /
 *   CRLF-LF 行尾差异）不抛错且返回合法 DiffRow[]；
 * - `createDiffSession`：惰性槽位缓存 —— 同一 (left,right) 每种精度最多算
 *   一次（computations = 4）、cacheHits 递增、重复 get 不重算、line 骨架
 *   在同一 key 下只算一次（word/char/smart 复用 line 槽位）、不同输入各算
 *   各的；`resetDefaultSession` 清空后重新计算；
 * - `getDiffRows`：四种精度分发结果与各自独立入口深度相等（用独立 session
 *   对比，避免缓存共享引用干扰断言）。
 */
import { describe, expect, it } from 'vitest'
import {
  diffCharPrecision,
  diffLinesCore,
  diffSmartPrecision as diffSmartPrecisionViaDiff,
  diffWordPrecision,
  getDiffRows as getDiffRowsViaDiff,
} from '../../src/core/diff'
import {
  createDiffSession,
  defaultSession,
  diffSmartPrecision,
  getDiffRows,
  resetDefaultSession,
} from '../../src/core/precision'
import type { DiffPrecision, DiffRow } from '../../src/core/types'

/* -------------------------------------------------------------------------- */
/* 辅助：断言结果与 ENG-001 行级骨架逐行一致（type / 双侧 lineNo / text）        */
/* -------------------------------------------------------------------------- */

function expectSameSkeleton(actual: DiffRow[], left: string, right: string) {
  const skeleton = diffLinesCore(left, right)
  expect(actual).toHaveLength(skeleton.length)
  actual.forEach((row, idx) => {
    expect(row.type).toBe(skeleton[idx].type)
    expect(row.left?.lineNo).toBe(skeleton[idx].left?.lineNo)
    expect(row.left?.text).toBe(skeleton[idx].left?.text)
    expect(row.right?.lineNo).toBe(skeleton[idx].right?.lineNo)
    expect(row.right?.text).toBe(skeleton[idx].right?.text)
  })
}

/* -------------------------------------------------------------------------- */
/* diffSmartPrecision：主路径（行级有差异）                                      */
/* -------------------------------------------------------------------------- */

describe('diffSmartPrecision 主路径（行级有差异）', () => {
  const left = 'a\nb\nc\nd\ne\nf'
  const right = 'a\nX\nY\nd\nZ\nf'

  it('行级有差异 → 与 diffWordPrecision 深度一致（骨架一致 + 差异行带 words）', () => {
    const smart = diffSmartPrecision(left, right)
    // 与词级精度完全一致：同一骨架 + 同一份词级投影。
    expect(smart).toEqual(diffWordPrecision(left, right))
    expectSameSkeleton(smart, left, right)
    expect(smart.map((r) => r.type)).toEqual([
      'equal', 'del', 'del', 'add', 'add', 'equal', 'del', 'add', 'equal',
    ])
  })

  it('变化行带词级高亮，equal 行不带', () => {
    const smart = diffSmartPrecision(left, right)
    // 变化区域内的行带 words（中英混合场景：b↔X、e↔Z 整词标红）。
    expect(smart[1].left!.words).toEqual([{ text: 'b', changed: true }])
    expect(smart[3].right!.words).toEqual([{ text: 'X', changed: true }])
    expect(smart[6].left!.words).toEqual([{ text: 'e', changed: true }])
    expect(smart[7].right!.words).toEqual([{ text: 'Z', changed: true }])
    // equal 行不带（下标 0/5/8 为 equal 行）。
    expect(smart[0].left!.words).toBeUndefined()
    expect(smart[5].left!.words).toBeUndefined()
    expect(smart[5].right!.words).toBeUndefined()
    expect(smart[8].right!.words).toBeUndefined()
  })

  it('中文行级差异：智能精度经词级投影定位到行内变化的字', () => {
    const rows = diffSmartPrecision('你好世界', '你好地球')
    expectSameSkeleton(rows, '你好世界', '你好地球')
    expect(rows[0].left!.words).toEqual([
      { text: '你好', changed: false },
      { text: '世界', changed: true },
    ])
    expect(rows[1].right!.words).toEqual([
      { text: '你好', changed: false },
      { text: '地球', changed: true },
    ])
  })

  it('空侧边界：纯 add / 纯 del / 双空串均返回合法骨架', () => {
    expect(diffSmartPrecision('', 'a\nb')).toEqual(diffWordPrecision('', 'a\nb'))
    expect(diffSmartPrecision('a\nb', '')).toEqual(diffWordPrecision('a\nb', ''))
    expect(diffSmartPrecision('', '')).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* diffSmartPrecision：全等输入与降级路径                                        */
/* -------------------------------------------------------------------------- */

describe('diffSmartPrecision 全等输入与降级路径', () => {
  it('两侧相同 → 直接返回全 equal 骨架，无 words（不做词级尝试）', () => {
    const rows = diffSmartPrecision('a\nb\nc', 'a\nb\nc')
    // 与行级骨架深度相等：全 equal。
    expect(rows).toEqual(diffLinesCore('a\nb\nc', 'a\nb\nc'))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    for (const row of rows) {
      expect(row.left!.words).toBeUndefined()
      expect(row.right!.words).toBeUndefined()
    }
  })

  it('两侧相同（含中文与空串）→ 全 equal / 空数组', () => {
    expect(diffSmartPrecision('你好世界', '你好世界')).toEqual(
      diffLinesCore('你好世界', '你好世界'),
    )
    expect(diffSmartPrecision('', '')).toEqual([])
  })

  it('降级分支：骨架全 equal 但串不同（"a\\n" vs "a"）→ 不抛错，返回合法全 equal 骨架', () => {
    // 'a\n' 与 'a' 在 splitLines 契约下切出同一行序列（尾部换行差异是
    // ENG-010 规范化接入前的已知降级形态）：骨架全 equal 但输入串不同，
    // 进入「尝试词级投影」的降级路径。
    const rows = diffSmartPrecision('a\n', 'a') // 不抛错即通过第一层断言
    // 合法 DiffRow[]：全 equal 干净骨架（词级投影无可定位差异时的现状）。
    expect(rows).toEqual(diffLinesCore('a\n', 'a'))
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    // 走降级分支的行为区分（取舍说明）：当前词级投影基于同一套严格相等
    // 比较，对全 equal 骨架必然也无可定位差异，因此「与 diffWordPrecision
    // 深度一致」和「结果不含 words」两个判据在此输入上重合 —— 两者都断言。
    // ENG-006/ENG-010 接入后词级投影会在等价行上产出 words，届时「与词级
    // 一致」仍是稳定判据（届时两判据将分离，按新契约更新本用例）。
    expect(rows).toEqual(diffWordPrecision('a\n', 'a'))
    for (const row of rows) {
      expect(row.left?.words).toBeUndefined()
      expect(row.right?.words).toBeUndefined()
    }
  })

  it('降级分支：CRLF / LF 行尾差异（ENG-010 前形态）→ 同样全 equal 不抛错', () => {
    const rows = diffSmartPrecision('a\r\nb', 'a\nb')
    expect(rows).toEqual(diffLinesCore('a\r\nb', 'a\nb'))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal'])
  })
})

/* -------------------------------------------------------------------------- */
/* createDiffSession：缓存会话                                                  */
/* -------------------------------------------------------------------------- */

describe('createDiffSession 缓存会话', () => {
  it('同一 (left,right) 连续 get 四种精度：computations 为 4，cacheHits 递增', () => {
    const session = createDiffSession()
    const left = 'a\nb\nc'
    const right = 'a\nX\nc'

    const hits: number[] = []
    for (const precision of ['line', 'word', 'char', 'smart'] as const) {
      session.get(left, right, precision)
      hits.push(session.stats().cacheHits)
    }

    const stats = session.stats()
    // 每种精度最多（恰好）算一次：line / word / char / smart 各计 1。
    expect(stats.computations).toBe(4)
    expect(stats.cacheSize).toBe(1)
    // cacheHits 递增 0→1→2→3：word/char/smart 首算时各自命中一次 line 槽位
    // （复用骨架，不再重算 diffLinesCore），该内部复用计入 cacheHits。
    expect(hits).toEqual([0, 1, 2, 3])
  })

  it('重复 get 同精度：computations 不变、cacheHits 增加，绝不重算', () => {
    const session = createDiffSession()
    const left = 'a\nb'
    const right = 'a\nX'

    for (const precision of ['line', 'word', 'char', 'smart'] as const) {
      session.get(left, right, precision)
    }
    expect(session.stats().computations).toBe(4)
    expect(session.stats().cacheHits).toBe(3)

    // 反向再取一轮：全部命中缓存，computations 恒为 4。
    for (const precision of ['smart', 'char', 'word', 'line'] as const) {
      session.get(left, right, precision)
      expect(session.stats().computations).toBe(4)
    }
    expect(session.stats().cacheHits).toBe(7)
  })

  it('line 骨架在同一 key 下只算一次：word 首算连带惰性触发 line，line 再取直接命中', () => {
    const session = createDiffSession()
    // 先只请求 word：惰性触发 line 骨架计算（1）+ word 投影（1）= 2 次。
    session.get('a\nb', 'a\nX', 'word')
    expect(session.stats().computations).toBe(2)
    expect(session.stats().cacheSize).toBe(1)
    // 再请求 line：命中已算过的骨架槽位，不再计算。
    session.get('a\nb', 'a\nX', 'line')
    expect(session.stats().computations).toBe(2)
    expect(session.stats().cacheHits).toBe(1)
  })

  it('不同 (left,right) → computations 增加，cacheSize 随之增长', () => {
    const session = createDiffSession()

    session.get('a', 'b', 'line')
    expect(session.stats()).toEqual({ computations: 1, cacheHits: 0, cacheSize: 1 })

    session.get('a', 'c', 'line')
    expect(session.stats()).toEqual({ computations: 2, cacheHits: 0, cacheSize: 2 })

    // 同一 key 换精度：新增该精度的投影计算，但不再新增缓存条目。
    session.get('a', 'b', 'word')
    expect(session.stats().computations).toBe(3)
    expect(session.stats().cacheSize).toBe(2)
  })

  it('同一 (left,right) 切换精度：各精度结果与独立入口深度相等（缓存重投影不重算原始 diff）', () => {
    const session = createDiffSession()
    const left = 'a\nb\nc'
    const right = 'a\nX\nc'

    // 依次切换精度：line 命中骨架后 word/char/smart 只做各自的投影计算
    // （computations 2→3→4，其中各含一次 line 槽位命中）。
    expect(session.get(left, right, 'line')).toEqual(diffLinesCore(left, right))
    expect(session.stats().computations).toBe(1)
    expect(session.get(left, right, 'word')).toEqual(diffWordPrecision(left, right))
    expect(session.stats().computations).toBe(2)
    expect(session.get(left, right, 'char')).toEqual(diffCharPrecision(left, right))
    expect(session.stats().computations).toBe(3)
    expect(session.get(left, right, 'smart')).toEqual(diffSmartPrecision(left, right))
    expect(session.stats().computations).toBe(4)
  })
})

/* -------------------------------------------------------------------------- */
/* defaultSession 与 resetDefaultSession                                        */
/* -------------------------------------------------------------------------- */

describe('defaultSession 与 resetDefaultSession', () => {
  it('resetDefaultSession：cacheSize 归零、计数清零，之后重新计算', () => {
    resetDefaultSession()
    defaultSession.get('x1\nx2', 'x1\ny2', 'smart')
    // smart 首算：line 槽位未算过 → 内部惰性触发 line 计算（1）+ smart 投影（1）
    // = 2 次计算；内部拉取是计算而非命中，cacheHits 为 0。
    expect(defaultSession.stats()).toEqual({ computations: 2, cacheHits: 0, cacheSize: 1 })

    resetDefaultSession()
    expect(defaultSession.stats()).toEqual({ computations: 0, cacheHits: 0, cacheSize: 0 })

    // 清空后同一输入重新计算（computations 从 0 重新增长）。
    defaultSession.get('x1\nx2', 'x1\ny2', 'smart')
    expect(defaultSession.stats()).toEqual({ computations: 2, cacheHits: 0, cacheSize: 1 })
  })

  it('resetDefaultSession 重复调用安全，单例门面身份不变', () => {
    resetDefaultSession()
    resetDefaultSession()
    expect(defaultSession.stats().cacheSize).toBe(0)
    // 重建内部状态后单例仍可用。
    defaultSession.get('p', 'q', 'line')
    expect(defaultSession.stats().computations).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* getDiffRows：统一分发                                                        */
/* -------------------------------------------------------------------------- */

describe('getDiffRows 统一分发', () => {
  const left = 'a\nb\nc\nd\ne\nf'
  const right = 'a\nX\nY\nd\nZ\nf'

  it("precision 'line' 与 diffLinesCore 深度相等（独立 session，避免缓存干扰）", () => {
    expect(getDiffRows(left, right, 'line', createDiffSession())).toEqual(
      diffLinesCore(left, right),
    )
  })

  it("precision 'word' 与 diffWordPrecision 深度相等", () => {
    expect(getDiffRows(left, right, 'word', createDiffSession())).toEqual(
      diffWordPrecision(left, right),
    )
  })

  it("precision 'char' 与 diffCharPrecision 深度相等", () => {
    expect(getDiffRows(left, right, 'char', createDiffSession())).toEqual(
      diffCharPrecision(left, right),
    )
  })

  it("precision 'smart' 与 diffSmartPrecision 深度相等", () => {
    expect(getDiffRows(left, right, 'smart', createDiffSession())).toEqual(
      diffSmartPrecision(left, right),
    )
  })

  it('session 参数缺省时走 defaultSession', () => {
    resetDefaultSession()
    expect(getDiffRows(left, right, 'smart')).toEqual(diffSmartPrecision(left, right))
  })

  it('diff.ts 再导出与 precision.ts 为同一实现（接线出口可用）', () => {
    expect(diffSmartPrecisionViaDiff).toBe(diffSmartPrecision)
    expect(getDiffRowsViaDiff).toBe(getDiffRows)
  })
})
