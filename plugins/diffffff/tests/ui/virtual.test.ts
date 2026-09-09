/**
 * 虚拟滚动可视区间计算单元测试（roadmap 任务 UI-009）。
 *
 * 覆盖 `src/composables/virtual.ts` 的纯函数出口（useVirtualRows 依赖真实
 * DOM 几何与 ResizeObserver，归视图层集成验证；本文件专注可单测的
 * `computeVisibleRange`）：
 * - 常规窗口代数：中部 / 顶部 / 尾部窗口的 start / end / offsetTop /
 *   totalHeight 精确数值（对齐与非对齐 scrollTop）；
 * - 边界：0 行、1 行、scrollTop 越过内容底部（start 钳制）、负 scrollTop、
 *   viewport = 0、内容整体小于视口（退化为全渲染，小 diff 行为不变）；
 * - overscan：默认值 10、裁剪语义（start 不为负 / end 不超总量）、自定义 0；
 * - 防御：rowHeight ≤ 0（契约违约退化为全量直通）、NaN / Infinity 输入归零；
 * - 不变量扫描：任意 scrollTop 下 0 ≤ start ≤ end ≤ total、offsetTop 与
 *   totalHeight 的数值关系，以及「top spacer + 渲染行 + bottom spacer =
 *   totalHeight」的 spacer 代数（视图渲染结构的数学前提）；
 * - 常量一致性：DIFF_ROW_HEIGHT 与 main.css 的 --diff-line-height token
 *   严格一致（两者分叉会导致虚拟计高与真实行高漂移，见 virtual.ts 注释）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeVisibleRange, DIFF_ROW_HEIGHT } from '../../src/composables/virtual'

/* -------------------------------------------------------------------------- */
/* 常规窗口：start / end / offsetTop / totalHeight 的精确数值                    */
/* -------------------------------------------------------------------------- */

describe('computeVisibleRange：常规窗口', () => {
  it('中部窗口（对齐 scrollTop）：start = scrollTop/行高 − overscan，end 含视口行 + overscan', () => {
    // scrollTop=600（第 30 行顶），视口 100px（5 行）：
    // start = 30 − 10 = 20；end = ceil(700/20) + 10 = 45。
    expect(computeVisibleRange(600, 100, 20, 100)).toEqual({
      start: 20,
      end: 45,
      offsetTop: 400,
      totalHeight: 2000,
    })
  })

  it('非对齐 scrollTop：floor / ceil 按行边界取整（1234px 落在第 61 行内）', () => {
    // floor(1234/20)=61 → start = 51；ceil(1334/20)=67 → end = 77。
    expect(computeVisibleRange(1234, 100, 20, 500)).toEqual({
      start: 51,
      end: 77,
      offsetTop: 1020,
      totalHeight: 10000,
    })
  })

  it('顶部窗口：start 钳为 0（overscan 前置缓冲不产生负下标）', () => {
    expect(computeVisibleRange(0, 100, 20, 100)).toEqual({
      start: 0,
      end: 15,
      offsetTop: 0,
      totalHeight: 2000,
    })
  })

  it('尾部窗口：end 钳为 totalCount（overscan 后置缓冲不越界）', () => {
    // scrollTop=1900（第 95 行顶）+ 视口 5 行 → 恰好内容底；end = min(100, 110) = 100。
    expect(computeVisibleRange(1900, 100, 20, 100)).toEqual({
      start: 85,
      end: 100,
      offsetTop: 1700,
      totalHeight: 2000,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* 边界：0 行 / 1 行 / 超界 scrollTop / 负 scrollTop / 零视口 / 全量可视          */
/* -------------------------------------------------------------------------- */

describe('computeVisibleRange：边界', () => {
  it('totalCount = 0 → 全零区间（空 diff 不渲染任何单元）', () => {
    expect(computeVisibleRange(500, 100, 20, 0)).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    })
  })

  it('totalCount = 1 + 大视口 → 只渲染 1 行（end 钳在总量内）', () => {
    expect(computeVisibleRange(0, 500, 20, 1)).toEqual({
      start: 0,
      end: 1,
      offsetTop: 0,
      totalHeight: 20,
    })
  })

  it('scrollTop 远超内容底部 → start 钳到 totalCount，与 end 相等（空 slice + 满高顶部 spacer，不产生负宽区间）', () => {
    expect(computeVisibleRange(10000, 100, 20, 10)).toEqual({
      start: 10,
      end: 10,
      offsetTop: 200,
      totalHeight: 200,
    })
  })

  it('scrollTop 恰好超出内容底 10px（轻微越界）→ 窗口覆盖到内容尾，start 仍钳在 [0, total]', () => {
    expect(computeVisibleRange(210, 100, 20, 10)).toEqual({
      start: 0,
      end: 10,
      offsetTop: 0,
      totalHeight: 200,
    })
  })

  it('负 scrollTop → 归 0 处理（与 scrollTop = 0 结果一致）', () => {
    expect(computeVisibleRange(-50, 100, 20, 100)).toEqual(computeVisibleRange(0, 100, 20, 100))
  })

  it('viewportHeight = 0 → end 只由 scrollTop 与 overscan 决定（渲染 overscan 行作首帧缓冲）', () => {
    expect(computeVisibleRange(200, 0, 20, 1000)).toEqual({
      start: 0,
      end: 20,
      offsetTop: 0,
      totalHeight: 20000,
    })
  })

  it('内容整体小于视口 → 退化为全渲染（小 diff 的 DOM 与总行数一致，行为不变）', () => {
    expect(computeVisibleRange(0, 2000, 20, 100)).toEqual({
      start: 0,
      end: 100,
      offsetTop: 0,
      totalHeight: 2000,
    })
    // 滚动到中部依然全渲染（视口覆盖全部内容）。
    expect(computeVisibleRange(100, 2000, 20, 100)).toEqual({
      start: 0,
      end: 100,
      offsetTop: 0,
      totalHeight: 2000,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* overscan：默认值与裁剪语义                                                   */
/* -------------------------------------------------------------------------- */

describe('computeVisibleRange：overscan', () => {
  it('省略 overscan 时默认 10（与显式传 10 结果一致）', () => {
    expect(computeVisibleRange(600, 100, 20, 100)).toEqual(
      computeVisibleRange(600, 100, 20, 100, 10),
    )
  })

  it('overscan = 0 → 恰好渲染视口覆盖的行（ceil 取整到行边界）', () => {
    // ceil(305/20) = 16（305px 落在第 16 行内）。
    expect(computeVisibleRange(205, 100, 20, 1000, 0)).toEqual({
      start: 10,
      end: 16,
      offsetTop: 200,
      totalHeight: 20000,
    })
  })

  it('overscan 不把 start 推为负、不把 end 推过总量（裁剪语义，多种 overscan 值）', () => {
    for (const overscan of [0, 1, 10, 50, 1000]) {
      const range = computeVisibleRange(30, 100, 20, 40, overscan)
      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.end).toBeLessThanOrEqual(40)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 防御：非法输入                                                               */
/* -------------------------------------------------------------------------- */

describe('computeVisibleRange：非法输入防御', () => {
  it('rowHeight ≤ 0（契约违约，无法计高）→ 防御性退化为全量直通（spacer 归零、内容自然撑高）', () => {
    expect(computeVisibleRange(100, 100, 0, 50)).toEqual({
      start: 0,
      end: 50,
      offsetTop: 0,
      totalHeight: 0,
    })
    expect(computeVisibleRange(100, 100, -5, 50)).toEqual({
      start: 0,
      end: 50,
      offsetTop: 0,
      totalHeight: 0,
    })
  })

  it('NaN / Infinity 输入归零或钳制，不产生 NaN 下标', () => {
    // NaN scrollTop → 视同 0。
    expect(computeVisibleRange(Number.NaN, 100, 20, 50)).toEqual({
      start: 0,
      end: 15,
      offsetTop: 0,
      totalHeight: 1000,
    })
    // Infinity viewport → 非有限归 0（与 viewport=0 同型）。
    expect(computeVisibleRange(100, Number.POSITIVE_INFINITY, 20, 50)).toEqual({
      start: 0,
      end: 15,
      offsetTop: 0,
      totalHeight: 1000,
    })
    // NaN rowHeight → 契约违约路径（全量直通）。
    expect(computeVisibleRange(0, 100, Number.NaN, 50)).toEqual({
      start: 0,
      end: 50,
      offsetTop: 0,
      totalHeight: 0,
    })
    // Infinity totalCount → 非有限归 0（空区间）。
    expect(computeVisibleRange(0, 100, 20, Number.POSITIVE_INFINITY)).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* 不变量扫描：任意滚动位置下的区间代数                                          */
/* -------------------------------------------------------------------------- */

describe('computeVisibleRange：不变量', () => {
  it('任意 scrollTop 下：0 ≤ start ≤ end ≤ total，offsetTop = start×行高，totalHeight 恒定', () => {
    const total = 200
    const rowHeight = 20
    for (const scrollTop of [0, 7, 20, 123, 999, 2000, 3999, 4000, 100000]) {
      const range = computeVisibleRange(scrollTop, 300, rowHeight, total)
      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.start).toBeLessThanOrEqual(range.end)
      expect(range.end).toBeLessThanOrEqual(total)
      expect(range.offsetTop).toBe(range.start * rowHeight)
      expect(range.totalHeight).toBe(total * rowHeight)
      // spacer 代数：bottom spacer = totalHeight − offsetTop − 渲染行高恒非负，
      // 即「top spacer + 渲染行 + bottom spacer = totalHeight」恒可满足
      // （网格总高与滚动位置无关，滚动条 / 锚定不抖动的数学前提）。
      expect(range.offsetTop + (range.end - range.start) * rowHeight).toBeLessThanOrEqual(
        range.totalHeight,
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 常量一致性：DIFF_ROW_HEIGHT ↔ main.css 的 --diff-line-height                 */
/* -------------------------------------------------------------------------- */

describe('DIFF_ROW_HEIGHT 与 CSS token 一致性', () => {
  it('DIFF_ROW_HEIGHT = 20 且与 main.css 的 --diff-line-height 严格一致', () => {
    expect(DIFF_ROW_HEIGHT).toBe(20)
    const css = readFileSync(new URL('../../src/main.css', import.meta.url), 'utf-8')
    const match = /--diff-line-height:\s*(\d+)px/.exec(css)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBe(DIFF_ROW_HEIGHT)
  })
})
