import { describe, expect, it } from 'vitest'
import { normalizePixelPaintBrushSize } from '../../canvasSettings'
import {
  getBrushPaintRegion,
  getGridPaintAnchorCell,
  gridRectArea,
  gridRectIntersectionArea,
  isGridRegionCovered,
  mergeGridPaintRect,
  planGridPaintWrite,
  subtractGridRect,
  type GridRect
} from '../gridPaint'

/** 网格矩形工厂（场景坐标：网格自 (0,0) 起、gridSize 等距）。 */
function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height }
}

/** 带编号的网格色块（模拟页面层的 fabric 对象身份）。 */
type FakeShape = { id: string; rect: GridRect; color: string }
let shapeSeed = 0
function shape(r: GridRect, color: string): FakeShape {
  return { id: `s-${++shapeSeed}`, rect: r, color }
}

/** 单格单元格矩形（gridSize=16 的整格）。 */
function cellRect(col: number, row: number, gridSize = 16) {
  return rect(col * gridSize, row * gridSize, gridSize, gridSize)
}

/** 色块集合不变量：互不重叠，且任意两块不满足"可合并为矩形"的贪心条件（视觉无冗余）。 */
function expectNoOverlap(shapes: FakeShape[]) {
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      expect(gridRectIntersectionArea(shapes[i].rect, shapes[j].rect)).toBe(0)
    }
  }
}

/** 区域被色块集合完整覆盖（无半格缺口）。 */
function expectCovered(region: GridRect, shapes: FakeShape[]) {
  const covered = shapes.reduce((sum, s) => sum + gridRectIntersectionArea(region, s.rect), 0)
  expect(covered).toBeGreaterThanOrEqual(gridRectArea(region))
}

describe('getGridPaintAnchorCell', () => {
  it('返回点击点所在的网格单元格', () => {
    // 网格间距 8：点 (10, 3) 落在第 1 列、第 0 行
    expect(getGridPaintAnchorCell({ x: 10, y: 3 }, 64, 64, 8)).toEqual({ col: 1, row: 0 })
    // 点 (0, 0) 落在第 0 列、第 0 行
    expect(getGridPaintAnchorCell({ x: 0, y: 0 }, 64, 64, 8)).toEqual({ col: 0, row: 0 })
  })

  it('画布外（负坐标 / 压在下右边界）返回 null', () => {
    expect(getGridPaintAnchorCell({ x: -1, y: 0 }, 64, 64, 8)).toBeNull()
    expect(getGridPaintAnchorCell({ x: 0, y: -0.5 }, 64, 64, 8)).toBeNull()
    expect(getGridPaintAnchorCell({ x: 64, y: 0 }, 64, 64, 8)).toBeNull()
    expect(getGridPaintAnchorCell({ x: 0, y: 64 }, 64, 64, 8)).toBeNull()
  })
})

describe('getBrushPaintRegion', () => {
  it('画笔区域为 N × N 个单元格', () => {
    expect(getBrushPaintRegion({ col: 1, row: 2 }, 1, 64, 64, 8)).toEqual(rect(8, 16, 8, 8))
    expect(getBrushPaintRegion({ col: 0, row: 0 }, 2, 64, 64, 8)).toEqual(rect(0, 0, 16, 16))
  })

  it('画笔超出画布右下边界时裁剪到画布范围', () => {
    // 64px 画布、间距 8、锚点在第 7 列：2 格画笔只保留 1 格宽
    expect(getBrushPaintRegion({ col: 7, row: 0 }, 2, 64, 64, 8)).toEqual(rect(56, 0, 8, 16))
  })

  it('画笔大小小于 1 时按 1 格处理', () => {
    expect(getBrushPaintRegion({ col: 0, row: 0 }, 0, 64, 64, 8)).toEqual(rect(0, 0, 8, 8))
  })
})

describe('subtractGridRect', () => {
  it('无相交时返回原矩形', () => {
    expect(subtractGridRect(rect(0, 0, 8, 8), rect(16, 16, 8, 8))).toEqual([rect(0, 0, 8, 8)])
  })

  it('完全覆盖时返回空数组', () => {
    expect(subtractGridRect(rect(8, 8, 8, 8), rect(0, 0, 64, 64))).toEqual([])
  })

  it('中心挖去后返回上下左右四条残余', () => {
    // 3×3 挖去中间 1×1 → 上、下、左、右四条
    const pieces = subtractGridRect(rect(0, 0, 24, 24), rect(8, 8, 8, 8))
    expect(pieces).toEqual([
      rect(0, 0, 24, 8),
      rect(0, 16, 24, 8),
      rect(0, 8, 8, 8),
      rect(16, 8, 8, 8)
    ])
    // 残余面积之和等于原矩形面积减去挖去部分（面积守恒）
    expect(pieces.reduce((sum, piece) => sum + gridRectArea(piece), 0)).toBe(gridRectArea(rect(0, 0, 24, 24)) - gridRectArea(rect(8, 8, 8, 8)))
  })

  it('边缘相交时只保留不重叠的部分', () => {
    // 左半被挖去 → 只剩右半
    expect(subtractGridRect(rect(0, 0, 16, 8), rect(0, 0, 8, 8))).toEqual([rect(8, 0, 8, 8)])
  })
})

describe('isGridRegionCovered', () => {
  it('区域被完整覆盖时返回 true', () => {
    // 16×16 区域由两个 8×16 块拼成
    expect(isGridRegionCovered(rect(0, 0, 16, 16), [rect(0, 0, 8, 16), rect(8, 0, 8, 16)])).toBe(true)
  })

  it('存在缺口时返回 false', () => {
    expect(isGridRegionCovered(rect(0, 0, 24, 8), [rect(0, 0, 8, 8), rect(16, 0, 8, 8)])).toBe(false)
    expect(isGridRegionCovered(rect(0, 0, 8, 8), [])).toBe(false)
  })
})

describe('mergeGridPaintRect', () => {
  it('相邻同色块合并为更大的矩形', () => {
    const { merged, consumed } = mergeGridPaintRect(rect(0, 0, 8, 8), [rect(8, 0, 8, 8)])
    expect(merged).toEqual(rect(0, 0, 16, 8))
    expect(consumed).toEqual([0])
  })

  it('横条与纵条拼成 L 形缺口时不合并（避免外接矩形填洞）', () => {
    // (0,0)-(8,8) 与 (8,0)-(16,8) 先连成 16×8 横条；
    // 再与 (8,8)-(16,8) 只能拼出带洞的 L 形，外接矩形面积不守恒 → 不合并
    const horizontal = mergeGridPaintRect(rect(0, 0, 8, 8), [rect(8, 0, 8, 8)])
    expect(horizontal.merged).toEqual(rect(0, 0, 16, 8))
    expect(horizontal.consumed).toEqual([0])
    const lShape = mergeGridPaintRect(rect(0, 0, 16, 8), [rect(8, 8, 8, 8)])
    expect(lShape.merged).toEqual(rect(0, 0, 16, 8))
    expect(lShape.consumed).toEqual([])
  })

  it('对角块不合并', () => {
    const { merged, consumed } = mergeGridPaintRect(rect(0, 0, 8, 8), [rect(8, 8, 8, 8)])
    expect(merged).toEqual(rect(0, 0, 8, 8))
    expect(consumed).toEqual([])
  })

  it('同一矩形重复出现时合并为一份', () => {
    const { merged, consumed } = mergeGridPaintRect(rect(0, 0, 8, 8), [rect(0, 0, 8, 8)])
    expect(merged).toEqual(rect(0, 0, 8, 8))
    expect(consumed).toEqual([0])
  })
})

describe('gridRectIntersectionArea', () => {
  it('相交面积与不相交为 0', () => {
    expect(gridRectIntersectionArea(rect(0, 0, 8, 8), rect(4, 0, 8, 8))).toBe(32)
    expect(gridRectIntersectionArea(rect(0, 0, 8, 8), rect(8, 0, 8, 8))).toBe(0)
  })
})

describe('normalizePixelPaintBrushSize', () => {
  it('画笔大小限制在 1..32 并取整', () => {
    expect(normalizePixelPaintBrushSize(3.6)).toBe(4)
    expect(normalizePixelPaintBrushSize(0)).toBe(1)
    expect(normalizePixelPaintBrushSize(-5)).toBe(1)
    expect(normalizePixelPaintBrushSize(999)).toBe(32)
    expect(normalizePixelPaintBrushSize('abc')).toBe(1)
  })
})

describe('planGridPaintWrite（网格上色增量写入算法）', () => {
  /** 按计划推进画布色块状态（模拟 runtime 的 applyGridPaintRegion）。 */
  function apply(shapes: FakeShape[], region: GridRect, color: string): { shapes: FakeShape[]; changed: boolean } {
    const plan = planGridPaintWrite(shapes, region, color)
    const kept = shapes.filter((s) => !plan.remove.includes(s))
    const added = plan.add.map((item) => shape(item.rect, item.color))
    return { shapes: [...kept, ...added], changed: plan.changed }
  }

  it('对角拖动逐格上色：每格满色、无重叠、无半格拖影', () => {
    let shapes: FakeShape[] = []
    for (const [col, row] of [[0, 0], [1, 1], [2, 2], [3, 3]] as const) {
      const result = apply(shapes, cellRect(col, row), '#ff0000')
      shapes = result.shapes
      expect(result.changed).toBe(true)
    }
    expectNoOverlap(shapes)
    // 4 个对角单元格总面积 = 4 × 16 × 16，一块不多一块不少
    expect(shapes.reduce((sum, s) => sum + gridRectArea(s.rect), 0)).toBe(4 * 256)
    for (const [col, row] of [[0, 0], [1, 1], [2, 2], [3, 3]] as const) {
      expectCovered(cellRect(col, row), shapes)
    }
  })

  it('横向连续拖动合并为单条满格色带', () => {
    let shapes: FakeShape[] = []
    for (const col of [0, 1, 2]) {
      shapes = apply(shapes, cellRect(col, 0), '#111111').shapes
    }
    expect(shapes).toHaveLength(1)
    expect(shapes[0].rect).toEqual(rect(0, 0, 48, 16))
    expectCovered(rect(0, 0, 48, 16), shapes)
  })

  it('同色重复上色（点击/来回拖动）不产生新对象', () => {
    let shapes: FakeShape[] = [shape(cellRect(0, 0), '#111111')]
    const first = apply(shapes, cellRect(0, 0), '#111111')
    expect(first.changed).toBe(false)
    expect(first.shapes).toEqual(shapes)
    // 来回拖动：中间再涂一格后回头重涂
    shapes = apply(shapes, cellRect(1, 0), '#111111').shapes
    const back = apply(shapes, cellRect(0, 0), '#111111')
    expect(back.changed).toBe(false)
  })

  it('换色上色只改变目标格：旧色块被挖切、其余部分保持原色', () => {
    let shapes: FakeShape[] = []
    for (const col of [0, 1, 2]) {
      shapes = apply(shapes, cellRect(col, 0), '#ff0000').shapes
    }
    expect(shapes).toHaveLength(1)
    shapes = apply(shapes, cellRect(1, 0), '#0000ff').shapes
    expectNoOverlap(shapes)
    expect(shapes.find((s) => s.color === '#0000ff')?.rect).toEqual(cellRect(1, 0))
    expect(shapes.find((s) => s.color === '#ff0000' && s.rect.x === 0)?.rect).toEqual(cellRect(0, 0))
    expect(shapes.find((s) => s.color === '#ff0000' && s.rect.x === 32)?.rect).toEqual(cellRect(2, 0))
    expect(shapes).toHaveLength(3)
  })

  it('L 形连续上色不会被外接矩形填洞（不涂未扫过的格）', () => {
    let shapes: FakeShape[] = []
    shapes = apply(shapes, cellRect(0, 0), '#00aa00').shapes
    shapes = apply(shapes, cellRect(1, 0), '#00aa00').shapes
    shapes = apply(shapes, cellRect(0, 1), '#00aa00').shapes
    expectNoOverlap(shapes)
    // 只有 3 个格子被上色：总面积 3 × 256（若被填洞则为 4 × 256）
    expect(shapes.reduce((sum, s) => sum + gridRectArea(s.rect), 0)).toBe(3 * 256)
    // 未扫过的 (1,1) 格不被染色
    const uncovered = shapes.reduce((sum, s) => sum + gridRectIntersectionArea(cellRect(1, 1), s.rect), 0)
    expect(uncovered).toBe(0)
  })

  it('2×2 画笔拖动：扫过的每个格子都是满色整格', () => {
    let shapes: FakeShape[] = []
    // 画笔 2×2：先锚 (0,0) 覆盖 0-1 列 0-1 行，再锚 (1,0) 覆盖 1-2 列 0-1 行
    shapes = apply(shapes, rect(0, 0, 32, 32), '#123456').shapes
    shapes = apply(shapes, rect(16, 0, 32, 32), '#123456').shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].rect).toEqual(rect(0, 0, 48, 32))
    expectCovered(rect(0, 0, 48, 32), shapes)
  })

  it('返回的计划携带被移除色块的原对象身份，供页面层同步 fabric', () => {
    const existing = shape(cellRect(0, 0), '#ff0000')
    const plan = planGridPaintWrite([existing], cellRect(0, 0), '#0000ff')
    expect(plan.changed).toBe(true)
    expect(plan.remove).toEqual([existing])
    expect(plan.add).toEqual([{ rect: cellRect(0, 0), color: '#0000ff' }])
  })
})
