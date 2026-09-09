/**
 * 行号列宽自适应映射单元测试（roadmap 任务 UI-015）。
 *
 * 覆盖 `src/stores/view.ts` 的纯函数出口 `diffGutterWidthPx`（按结果总行数
 * 的十进制位数映射行号列宽，App.vue 计算后以 `--gutter-w` 注入 .result-stage，
 * 两个 diff 视图的行号列 grid 模板与记号列 sticky 偏移消费同一来源）：
 * - 位数分档：≤3 位 → 40px（UI-006 时代 52px 固定宽在小 diff 下收窄，
 *   窄窗少占横向空间）；4–5 位 → 52px（与原固定宽持平）；≥6 位 → 64px
 *   （ENG-011 输入上限 10 万行 = 100000 为 6 位数字）；
 * - 边界：1 / 999 / 1000 / 99999 / 100000 等档位边界值精确断言；
 * - 防御：0（无结果 / 错误结果时调用方传 0）、负数、NaN、Infinity、小数
 *   一律落最小档 40px，不产生 NaN 或异常宽度。
 */
import { describe, expect, it } from 'vitest'
import { diffGutterWidthPx } from '../../src/stores/view'

describe('diffGutterWidthPx：位数分档', () => {
  it('≤3 位（1–999 行）→ 40px', () => {
    expect(diffGutterWidthPx(1)).toBe(40)
    expect(diffGutterWidthPx(9)).toBe(40)
    expect(diffGutterWidthPx(10)).toBe(40)
    expect(diffGutterWidthPx(99)).toBe(40)
    expect(diffGutterWidthPx(100)).toBe(40)
    expect(diffGutterWidthPx(999)).toBe(40)
  })

  it('4–5 位（1000–99999 行）→ 52px（与原固定列宽持平）', () => {
    expect(diffGutterWidthPx(1000)).toBe(52)
    expect(diffGutterWidthPx(1234)).toBe(52)
    expect(diffGutterWidthPx(9999)).toBe(52)
    expect(diffGutterWidthPx(10000)).toBe(52)
    expect(diffGutterWidthPx(50000)).toBe(52)
    expect(diffGutterWidthPx(99999)).toBe(52)
  })

  it('≥6 位（≥10 万行）→ 64px（ENG-011 上限 100000 行 = 6 位）', () => {
    expect(diffGutterWidthPx(100000)).toBe(64)
    expect(diffGutterWidthPx(123456)).toBe(64)
    expect(diffGutterWidthPx(1000000)).toBe(64)
  })
})

describe('diffGutterWidthPx：防御分支', () => {
  it('0（无结果 / 错误结果）、负数 → 最小档 40px', () => {
    expect(diffGutterWidthPx(0)).toBe(40)
    expect(diffGutterWidthPx(-1)).toBe(40)
    expect(diffGutterWidthPx(-100000)).toBe(40)
  })

  it('NaN / Infinity → 最小档 40px（不产生 NaN 宽度）', () => {
    expect(diffGutterWidthPx(Number.NaN)).toBe(40)
    expect(diffGutterWidthPx(Number.POSITIVE_INFINITY)).toBe(40)
    expect(diffGutterWidthPx(Number.NEGATIVE_INFINITY)).toBe(40)
  })

  it('小数向下取整按整数位数分档', () => {
    expect(diffGutterWidthPx(99.9)).toBe(40) // floor → 99 → 2 位
    expect(diffGutterWidthPx(1000.9)).toBe(52) // floor → 1000 → 4 位
    expect(diffGutterWidthPx(99999.9)).toBe(52)
  })
})
