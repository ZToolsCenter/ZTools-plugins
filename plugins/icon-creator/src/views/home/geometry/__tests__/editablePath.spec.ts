import { describe, expect, it } from 'vitest'
import {
  evalCubicBezierAt,
  getClosestParameterOnCubicSegment,
  getClosestParameterOnLineSegment,
  getContourMinPointCount,
  getContourSegmentParameterAt,
  getEditableAnchorHandleRefs,
  insertEditablePointIntoContour,
  insertEditablePointOnObjectSegment,
  lerpPointOnLine,
  removeEditablePointsFromContour,
  removeEditablePointsFromObject,
  resolveEditableSegmentRef,
  setEditableSegmentControlPoint,
  splitCubicBezierAt,
  type EditablePathContour,
  type EditablePathModel,
  type EditablePathObject,
  type EditablePathSegment,
  type EditableSegmentRef
} from '../editablePath'

/**
 * 锚点插入/删除的纯几何用例（node 环境，无 DOM）：
 * - de Casteljau 三次贝塞尔分割：分割点求值一致 + 两侧子曲线形状保持；
 * - 直线段插值与最近点投影；
 * - 曲线段最近点采样（插入定位用）；
 * - 轮廓插入/删除锚点后的点/段索引重排与段合并控制柄策略；
 * - 对象级插删（用替身验证 cornerRadiusOverrides 的同步）。
 */

/** 构造一条三次贝塞尔轮廓（可选闭合），segments 显式给出。 */
function makeCubicContour(options: {
  closed: boolean
  segments: EditablePathSegment[]
  points: Array<{ x: number, y: number }>
}): EditablePathContour {
  return {
    closed: options.closed,
    points: options.points.map((point) => ({ ...point })),
    segments: options.segments
  }
}

/** 构造纯直线轮廓；segments 留空表示隐式直线段（与 polygonEditablePath 一致）。 */
function makePolylineContour(points: Array<{ x: number, y: number }>, closed: boolean): EditablePathContour {
  return { closed, points: points.map((point) => ({ ...point })), segments: [] }
}

/** 常用测试曲线：起点 (0,0)，cp1 (0,100)，cp2 (100,100)，终点 (100,0)。 */
const CURVE = {
  from: { x: 0, y: 0 },
  cp1: { x: 0, y: 100 },
  cp2: { x: 100, y: 100 },
  to: { x: 100, y: 0 }
}

/** 构造可编辑路径对象替身：提供 rebuild 所需的最小几何接口（单位矩阵、零偏移）。 */
function makeStubEditableObject(model: EditablePathModel, overrides: Array<number | null>): EditablePathObject {
  const stub = {
    editablePath: model,
    cornerRadius: 0,
    cornerRadiusOverrides: overrides,
    editablePathVersion: 2,
    pathOffset: { x: 0, y: 0 },
    dirty: false,
    _setPath() {
      // 替身：不需要真正解析 path 数据
    },
    setCoords() {
      // 替身：无坐标缓存
    },
    calcOwnMatrix() {
      return [1, 0, 0, 1, 0, 0]
    }
  }
  return stub as unknown as EditablePathObject
}

/** 读取替身对象经过 ensure 归一化后的当前模型（插删都是作用在这份克隆上）。 */
function getStubModel(obj: EditablePathObject): EditablePathModel {
  return obj.editablePath as EditablePathModel
}

describe('getContourMinPointCount', () => {
  it('闭合轮廓最少保留 3 点，开放轮廓最少保留 2 点', () => {
    expect(getContourMinPointCount({ closed: true, points: [], segments: [] })).toBe(3)
    expect(getContourMinPointCount({ closed: false, points: [], segments: [] })).toBe(2)
  })
})

describe('splitCubicBezierAt（de Casteljau 分割）', () => {
  it('分割点与原曲线在 t 处的求值一致', () => {
    const split = splitCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, 0.3)
    expect(split.point.x).toBeCloseTo(evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, 0.3).x, 10)
    expect(split.point.y).toBeCloseTo(evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, 0.3).y, 10)
  })

  it('前半段子曲线经重参数化后与原曲线重合（形状保持）', () => {
    const t = 0.4
    const split = splitCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, t)
    // 前半段覆盖原曲线参数 [0, t]：子曲线参数 v 对应原曲线参数 u = t * v
    for (const v of [0.25, 0.5, 0.8]) {
      const expected = evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, t * v)
      const actual = evalCubicBezierAt(CURVE.from, split.left.cp1, split.left.cp2, split.point, v)
      expect(actual.x).toBeCloseTo(expected.x, 8)
      expect(actual.y).toBeCloseTo(expected.y, 8)
    }
  })

  it('后半段子曲线经重参数化后与原曲线重合（形状保持）', () => {
    const t = 0.4
    const split = splitCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, t)
    // 原曲线参数 u = t + (1 - t) * v 对应后半段子曲线参数 v
    for (const v of [0.2, 0.5, 0.8]) {
      const u = t + (1 - t) * v
      const expected = evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, u)
      const actual = evalCubicBezierAt(split.point, split.right.cp1, split.right.cp2, CURVE.to, v)
      expect(actual.x).toBeCloseTo(expected.x, 8)
      expect(actual.y).toBeCloseTo(expected.y, 8)
    }
  })

  it('端点参数退化：t=0 得到起点，t=1 得到终点', () => {
    const atStart = splitCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, 0)
    expect(atStart.point).toEqual({ x: 0, y: 0 })
    const atEnd = splitCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, 1)
    expect(atEnd.point).toEqual({ x: 100, y: 0 })
  })
})

describe('lerpPointOnLine（直线段插值）', () => {
  it('t=0/0.5/1 分别返回起点、中点、终点', () => {
    const from = { x: 10, y: 20 }
    const to = { x: 30, y: 60 }
    expect(lerpPointOnLine(from, to, 0)).toEqual({ x: 10, y: 20 })
    expect(lerpPointOnLine(from, to, 0.5)).toEqual({ x: 20, y: 40 })
    expect(lerpPointOnLine(from, to, 1)).toEqual({ x: 30, y: 60 })
  })

  it('t 超出 [0,1] 时钳制到端点', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 10, y: 10 }
    expect(lerpPointOnLine(from, to, -0.5)).toEqual({ x: 0, y: 0 })
    expect(lerpPointOnLine(from, to, 1.5)).toEqual({ x: 10, y: 10 })
  })
})

describe('getClosestParameterOnLineSegment', () => {
  it('内部投影返回正确 t 与最近点', () => {
    const result = getClosestParameterOnLineSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.t).toBeCloseTo(0.5)
    expect(result.point).toEqual({ x: 5, y: 0 })
  })

  it('投影超出段范围时钳制到端点', () => {
    const before = getClosestParameterOnLineSegment({ x: -4, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(before.t).toBe(0)
    const after = getClosestParameterOnLineSegment({ x: 14, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(after.t).toBe(1)
  })

  it('零长度线段退化为起点', () => {
    const result = getClosestParameterOnLineSegment({ x: 3, y: 3 }, { x: 2, y: 2 }, { x: 2, y: 2 })
    expect(result.t).toBe(0)
    expect(result.point).toEqual({ x: 2, y: 2 })
  })
})

describe('getClosestParameterOnCubicSegment', () => {
  it('目标取自曲线上某采样点时还原该参数（±0.01）', () => {
    const target = evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, 0.25)
    const result = getClosestParameterOnCubicSegment(target, CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to)
    expect(Math.abs(result.t - 0.25)).toBeLessThan(0.01)
    expect(result.point.x).toBeCloseTo(target.x, 4)
    expect(result.point.y).toBeCloseTo(target.y, 4)
  })

  it('目标取自曲线端点时收敛到端部参数', () => {
    const result = getClosestParameterOnCubicSegment({ x: 100, y: 0 }, CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to)
    expect(Math.abs(result.t - 1)).toBeLessThan(0.01)
  })

  it('远离曲线的目标点仍返回曲线上最近点', () => {
    const target = { x: 50, y: 500 }
    const result = getClosestParameterOnCubicSegment(target, CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to)
    // 曲线关于 x=50 大致对称，最近点应在中部附近
    expect(result.t).toBeGreaterThan(0.3)
    expect(result.t).toBeLessThan(0.7)
  })
})

describe('getContourSegmentParameterAt', () => {
  it('直线轮廓返回投影参数；越界段索引返回 null', () => {
    const contour = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false)
    const result = getContourSegmentParameterAt(contour, 1, { x: 10, y: 4 })
    expect(result?.t).toBeCloseTo(0.4)
    expect(getContourSegmentParameterAt(contour, 5, { x: 0, y: 0 })).toBeNull()
  })
})

describe('insertEditablePointIntoContour', () => {
  it('隐式直线段插入：新锚点落在线性插值位置，后续段索引顺延', () => {
    const contour = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false)
    const inserted = insertEditablePointIntoContour(contour, 0, 0.5)
    expect(inserted?.pointIndex).toBe(1)
    expect(contour.points).toHaveLength(4)
    expect(contour.points[1]).toEqual({ x: 5, y: 0 })
    expect(contour.segments.map((segment) => segment.to)).toEqual([1, 2, 3])
  })

  it('闭合轮廓收尾段（绕回起点）插入：新锚点追加到末尾且不移动既有点', () => {
    const contour = makePolylineContour([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }
    ], true)
    const inserted = insertEditablePointIntoContour(contour, 3, 0.5)
    expect(inserted?.pointIndex).toBe(4)
    expect(contour.points).toHaveLength(5)
    // 原有点位置不动，新点为 (3,4)→(0,0) 的中点
    expect(contour.points[0]).toEqual({ x: 0, y: 0 })
    expect(contour.points[4]).toEqual({ x: 0, y: 5 })
    expect(contour.segments.map((segment) => segment.to)).toEqual([1, 2, 3, 4, 0])
  })

  it('曲线段插入按 de Casteljau 分割，采样验证曲线形状保持', () => {
    const contour = makeCubicContour({
      closed: false,
      points: [CURVE.from, CURVE.to],
      segments: [{ type: 'cubic', cp1: CURVE.cp1, cp2: CURVE.cp2, to: 1 }]
    })
    const t = 0.4
    insertEditablePointIntoContour(contour, 0, t)
    expect(contour.points).toHaveLength(3)
    expect(contour.segments).toHaveLength(2)
    // 前半段在 v 处的采样应与原曲线在 u = t * v 处重合
    for (const v of [0.3, 0.6, 1]) {
      const segment = contour.segments[0]
      if (segment.type !== 'cubic') throw new Error('分割后应仍为曲线段')
      const expected = evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, t * v)
      const actual = evalCubicBezierAt(contour.points[0], segment.cp1, segment.cp2, contour.points[1], v)
      expect(actual.x).toBeCloseTo(expected.x, 6)
      expect(actual.y).toBeCloseTo(expected.y, 6)
    }
    // 后半段在 v 处的采样应与原曲线在 u = t + (1 - t) * v 处重合
    for (const v of [0.3, 0.7]) {
      const segment = contour.segments[1]
      if (segment.type !== 'cubic') throw new Error('分割后应仍为曲线段')
      const expected = evalCubicBezierAt(CURVE.from, CURVE.cp1, CURVE.cp2, CURVE.to, t + (1 - t) * v)
      const actual = evalCubicBezierAt(contour.points[1], segment.cp1, segment.cp2, contour.points[2], v)
      expect(actual.x).toBeCloseTo(expected.x, 6)
      expect(actual.y).toBeCloseTo(expected.y, 6)
    }
  })

  it('参数钳制到 (0.001, 0.999)，避免与端点重合的退化段', () => {
    const contour = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }], false)
    insertEditablePointIntoContour(contour, 0, 0)
    expect(contour.points[1].x).toBeGreaterThan(0)
  })
})

describe('removeEditablePointsFromContour', () => {
  it('开放轮廓删除中间点：两侧直线段合并为一段，存活点保持顺序', () => {
    const contour = makePolylineContour([
      { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 15, y: 5 }
    ], false)
    expect(removeEditablePointsFromContour(contour, [1])).toBe(true)
    expect(contour.points.map((point) => point.x)).toEqual([0, 10, 15])
    expect(contour.segments.map((segment) => segment.to)).toEqual([1, 2])
    expect(contour.segments[0].type).toBe('line')
  })

  it('闭合轮廓删除锚点：段环重排且收尾段指向新起点', () => {
    const contour = makePolylineContour([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }
    ], true)
    expect(removeEditablePointsFromContour(contour, [0])).toBe(true)
    expect(contour.points).toHaveLength(3)
    expect(contour.closed).toBe(true)
    expect(contour.segments).toHaveLength(3)
    expect(contour.segments.map((segment) => segment.to)).toEqual([1, 2, 0])
  })

  it('低于最少点数时整体失败：闭合 3 点、开放 2 点均不可删', () => {
    const closed = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], true)
    expect(removeEditablePointsFromContour(closed, [0])).toBe(false)
    expect(closed.points).toHaveLength(3)
    const open = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }], false)
    expect(removeEditablePointsFromContour(open, [1])).toBe(false)
    expect(open.points).toHaveLength(2)
  })

  it('删除曲线锚点：合并段取被删点两侧柄（前段 cp2 / 后段 cp1）', () => {
    const contour = makeCubicContour({
      closed: false,
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      segments: [
        { type: 'cubic', cp1: { x: 10, y: 30 }, cp2: { x: 30, y: 40 }, to: 1 },
        { type: 'cubic', cp1: { x: 70, y: 60 }, cp2: { x: 90, y: -20 }, to: 2 }
      ]
    })
    expect(removeEditablePointsFromContour(contour, [1])).toBe(true)
    expect(contour.points).toHaveLength(2)
    expect(contour.segments).toHaveLength(1)
    const merged = contour.segments[0]
    expect(merged.type).toBe('cubic')
    if (merged.type !== 'cubic') return
    expect(merged.cp1).toEqual({ x: 30, y: 40 })
    expect(merged.cp2).toEqual({ x: 70, y: 60 })
    expect(merged.to).toBe(1)
  })

  it('删除相邻多锚点：整条被删链路合并为一段（全直线时保持直线）', () => {
    const contour = makePolylineContour([
      { x: 0, y: 0 }, { x: 5, y: 1 }, { x: 10, y: 2 }, { x: 15, y: 0 }, { x: 20, y: 5 }
    ], false)
    expect(removeEditablePointsFromContour(contour, [1, 2])).toBe(true)
    expect(contour.points.map((point) => point.x)).toEqual([0, 15, 20])
    expect(contour.segments.map((segment) => segment.to)).toEqual([1, 2])
  })

  it('曲线段与直线段跨删合并：直线侧用被删锚点位置充当柄以保持端点切线', () => {
    const contour = makeCubicContour({
      closed: false,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 0 }],
      segments: [
        { type: 'cubic', cp1: { x: 2, y: 8 }, cp2: { x: 6, y: 12 }, to: 1 },
        { type: 'line', to: 2 },
        { type: 'line', to: 3 }
      ]
    })
    expect(removeEditablePointsFromContour(contour, [1])).toBe(true)
    expect(contour.segments).toHaveLength(2)
    const merged = contour.segments[0]
    if (merged.type !== 'cubic') throw new Error('含曲线侧的合并段应为曲线段')
    // cp1 取前段 cp2；前段为直线时用被删点位置，这里前段是曲线段
    expect(merged.cp1).toEqual({ x: 6, y: 12 })
    // 后段为直线段：cp2 用链路最后被删锚点（点 1）的位置
    expect(merged.cp2).toEqual({ x: 10, y: 10 })
    expect(merged.to).toBe(1)
  })
})

describe('对象级插删（cornerRadiusOverrides 同步）', () => {
  it('插入锚点时覆盖数组在对应全局索引处插入 null，并返回全局索引', () => {
    const contour = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }], false)
    const obj = makeStubEditableObject({ contours: [contour] }, [4, 8])
    const segmentRef: EditableSegmentRef = {
      contour,
      contourIndex: 0,
      segment: { type: 'line', to: 1 },
      segmentIndex: 0,
      fromPoint: contour.points[0],
      toPoint: contour.points[1],
      fromPointIndex: 0,
      toPointIndex: 1,
      fromGlobalIndex: 0,
      toGlobalIndex: 1
    }
    const globalIndex = insertEditablePointOnObjectSegment(obj, segmentRef, 0.5)
    expect(globalIndex).toBe(1)
    expect(obj.cornerRadiusOverrides).toEqual([4, null, 8])
    expect(obj.dirty).toBe(true)
    expect(getStubModel(obj).contours[0].points).toHaveLength(3)
  })

  it('删除锚点时覆盖数组按全局索引收缩', () => {
    const contour = makePolylineContour([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }
    ], false)
    const obj = makeStubEditableObject({ contours: [contour] }, [2, 4, 6])
    expect(removeEditablePointsFromObject(obj, [1])).toBe(true)
    expect(obj.cornerRadiusOverrides).toEqual([2, 6])
    expect(getStubModel(obj).contours[0].points).toHaveLength(2)
  })

  it('任一轮廓低于最少点数时多选删除整体失败', () => {
    const contourA = makePolylineContour([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true)
    const contourB = makePolylineContour([{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }], true)
    const obj = makeStubEditableObject(
      { contours: [contourA, contourB] },
      [null, null, null, null, null, null, null]
    )
    // 轮廓 B 只有 3 点（闭合下限），删除其中 1 点应整体失败
    expect(removeEditablePointsFromObject(obj, [0, 4])).toBe(false)
    expect(getStubModel(obj).contours[0].points).toHaveLength(4)
    expect(getStubModel(obj).contours[1].points).toHaveLength(3)
    expect(obj.cornerRadiusOverrides).toHaveLength(7)
  })
})

describe('getEditableAnchorHandleRefs（锚点入/出控制柄解析）', () => {
  /** 点位模式下控制柄语义的锚点用例：闭合曲线四边形，点 1 为曲线交点，点 2 一侧为直线。 */
  function makeMixedContourObject(closed: boolean) {
    const contour = makeCubicContour({
      closed,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      segments: [
        { type: 'cubic', cp1: { x: 3, y: 0 }, cp2: { x: 7, y: 0 }, to: 1 },
        { type: 'line', to: 2 },
        ...(closed ? [{ type: 'line' as const, to: 0 }] : [])
      ]
    })
    return makeStubEditableObject({ contours: [contour] }, [null, null, null])
  }

  it('两侧邻段均为曲线时返回入/出段引用，入柄对应入段 cp2、出柄对应出段 cp1', () => {
    const obj = makeMixedContourObject(true)
    const curveChain = makeCubicContour({
      closed: true,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      segments: [
        { type: 'cubic', cp1: { x: 3, y: 0 }, cp2: { x: 7, y: 0 }, to: 1 },
        { type: 'cubic', cp1: { x: 13, y: 0 }, cp2: { x: 17, y: 0 }, to: 2 },
        { type: 'cubic', cp1: { x: 13, y: 10 }, cp2: { x: 3, y: 10 }, to: 0 }
      ]
    })
    const curveObj = makeStubEditableObject({ contours: [curveChain] }, [null, null, null])
    const refs = getEditableAnchorHandleRefs(curveObj, 1)
    expect(refs.inSegmentRef?.segmentIndex).toBe(0)
    expect(refs.inSegmentRef?.toGlobalIndex).toBe(1)
    expect(refs.outSegmentRef?.segmentIndex).toBe(1)
    expect(refs.outSegmentRef?.fromGlobalIndex).toBe(1)
  })

  it('邻段为直线段时仍返回该段引用（幻影柄位，拖拽转曲线）', () => {
    const obj = makeMixedContourObject(true)
    const refs = getEditableAnchorHandleRefs(obj, 1)
    // 入段（0→1）为 cubic：入柄取真实 cp2
    expect(refs.inSegmentRef?.segmentIndex).toBe(0)
    expect(refs.inSegmentRef?.segment.type).toBe('cubic')
    // 出段（1→2）为 line：仍返回引用，柄显示在幻影位，拖拽时经 setEditableSegmentControlPoint 转曲线
    expect(refs.outSegmentRef?.segmentIndex).toBe(1)
    expect(refs.outSegmentRef?.segment.type).toBe('line')

    // 模拟拖拽幻影出柄：写入 cp1 后直线段转为 cubic，两侧引用均保持有效
    setEditableSegmentControlPoint(obj, refs.outSegmentRef!, 'cp1', { x: 4, y: 6 })
    const after = getEditableAnchorHandleRefs(obj, 1)
    expect(after.inSegmentRef).not.toBeNull()
    expect(after.outSegmentRef?.segment.type).toBe('cubic')
    const liveOut = resolveEditableSegmentRef(obj, after.outSegmentRef!)
    expect(liveOut && liveOut.segment.type === 'cubic' ? liveOut.segment.cp1 : null).toEqual({ x: 4, y: 6 })
  })

  it('开放轮廓端点缺入段或出段时对应侧返回 null', () => {
    const obj = makeMixedContourObject(false)
    // 起点 0：无入段（出段为 cubic）
    const startRefs = getEditableAnchorHandleRefs(obj, 0)
    expect(startRefs.inSegmentRef).toBeNull()
    expect(startRefs.outSegmentRef?.segmentIndex).toBe(0)
    // 终点 2：无出段（入段为 line，仍返回引用）
    const endRefs = getEditableAnchorHandleRefs(obj, 2)
    expect(endRefs.inSegmentRef?.segmentIndex).toBe(1)
    expect(endRefs.outSegmentRef).toBeNull()
  })

  it('闭合轮廓首点的入柄来自绕回的末段', () => {
    const curveChain = makeCubicContour({
      closed: true,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      segments: [
        { type: 'cubic', cp1: { x: 3, y: 0 }, cp2: { x: 7, y: 0 }, to: 1 },
        { type: 'cubic', cp1: { x: 13, y: 0 }, cp2: { x: 17, y: 0 }, to: 2 },
        { type: 'cubic', cp1: { x: 13, y: 10 }, cp2: { x: 3, y: 10 }, to: 0 }
      ]
    })
    const obj = makeStubEditableObject({ contours: [curveChain] }, [null, null, null])
    const refs = getEditableAnchorHandleRefs(obj, 0)
    expect(refs.inSegmentRef?.segmentIndex).toBe(2)
    expect(refs.outSegmentRef?.segmentIndex).toBe(0)
  })

  it('无效索引返回两侧均为 null', () => {
    const obj = makeMixedContourObject(true)
    const refs = getEditableAnchorHandleRefs(obj, 99)
    expect(refs.inSegmentRef).toBeNull()
    expect(refs.outSegmentRef).toBeNull()
  })
})
