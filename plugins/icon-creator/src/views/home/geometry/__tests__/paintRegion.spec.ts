import { describe, expect, it } from 'vitest'
import {
  collectObjectsContainingPoint,
  extractObjectBoundary,
  isSolidFillMatched,
  resolvePaintRegionHit,
  toScenePolygon
} from '../paintRegion'

/**
 * 简单矩形对象工厂（模拟 fabric Rect：left/top 为包围盒左上角，场景坐标语义）。
 */
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height }
}

/** 圆形对象工厂（fabric Circle：left/top 为包围盒左上角，radius 为半径）。 */
function circle(left: number, top: number, radius: number) {
  return { left, top, radius }
}

/** 编组对象工厂。 */
function group(...children: unknown[]) {
  return { getObjects: () => children }
}

/** 2D 仿射变换矩阵结构 [a, b, c, d, e, f]（与 fabric/dominant 顺序一致）。 */
type Matrix = [number, number, number, number, number, number]

/** 对点应用仿射变换（fabric 变换矩阵约定：x' = a*x + c*y + e）。 */
function applyMatrix(m: Matrix, point: { x: number; y: number }) {
  return {
    x: m[0] * point.x + m[2] * point.y + m[4],
    y: m[1] * point.x + m[3] * point.y + m[5]
  }
}

/** 构造平移矩阵。 */
function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty]
}

/** 构造缩放矩阵。 */
function scale(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0]
}

/** 构造绕原点旋转矩阵（角度为弧度）。 */
function rotate(angle: number): Matrix {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cos, sin, -sin, cos, 0, 0]
}

describe('extractObjectBoundary', () => {
  it('矩形对象产出四角折线环', () => {
    const rings = extractObjectBoundary(rect(10, 10, 100, 60))
    expect(rings).toHaveLength(1)
    expect(rings[0].points).toHaveLength(4)
  })

  it('圆形对象参数化采样为多边形', () => {
    const rings = extractObjectBoundary(circle(0, 0, 50))
    expect(rings).toHaveLength(1)
    expect(rings[0].points.length).toBeGreaterThanOrEqual(8)
  })

  it('路径对象折线化曲线命令', () => {
    const pathObject = {
      path: [
        ['M', 0, 0],
        ['C', 0, 50, 100, 50, 100, 0],
        ['L', 0, 0]
      ]
    }
    const rings = extractObjectBoundary(pathObject)
    expect(rings).toHaveLength(1)
    // 曲线细分后点数应多于原始命令数
    expect(rings[0].points.length).toBeGreaterThan(3)
  })

  it('编组递归展开子对象边界', () => {
    const rings = extractObjectBoundary(group(rect(0, 0, 10, 10), circle(50, 50, 20)))
    expect(rings).toHaveLength(2)
  })

  it('无法判定边界（无尺寸信息）返回空数组', () => {
    expect(extractObjectBoundary({})).toHaveLength(0)
    expect(extractObjectBoundary(null)).toHaveLength(0)
    expect(extractObjectBoundary({ width: 0, height: 0 })).toHaveLength(0)
  })
})

describe('toScenePolygon', () => {
  it('平移变换：路径坐标随矩阵平移', () => {
    const pathObject = {
      path: [
        ['M', 0, 0],
        ['L', 10, 0],
        ['L', 10, 10],
        ['Z']
      ]
    }
    const rings = toScenePolygon(pathObject, translate(100, 50))
    expect(rings[0].points[0]).toEqual({ x: 100, y: 50 })
    expect(rings[0].points[1]).toEqual({ x: 110, y: 50 })
    expect(rings[0].points[2]).toEqual({ x: 110, y: 60 })
  })

  it('缩放 + 平移组合变换', () => {
    const pathObject = {
      path: [
        ['M', 0, 0],
        ['L', 10, 0],
        ['L', 10, 10],
        ['Z']
      ]
    }
    const rings = toScenePolygon(pathObject, [2, 0, 0, 3, 10, 20])
    expect(rings[0].points[1]).toEqual({ x: 30, y: 20 })
    expect(rings[0].points[2]).toEqual({ x: 30, y: 50 })
  })

  it('对象自身带变换矩阵时（无显式入参）按对象变换上屏', () => {
    const pathObject = {
      path: [
        ['M', 0, 0],
        ['L', 10, 0],
        ['L', 10, 10],
        ['Z']
      ],
      calcTransformMatrix: () => translate(5, 5) as unknown as Matrix
    }
    const rings = toScenePolygon(pathObject)
    expect(rings[0].points[0]).toEqual({ x: 5, y: 5 })
    expect(rings[0].points[1]).toEqual({ x: 15, y: 5 })
  })
})

describe('resolvePaintRegionHit', () => {
  it('矩形：内部命中 inside，外部命中 outside', () => {
    const obj = rect(10, 10, 100, 60)
    expect(resolvePaintRegionHit({ x: 60, y: 40 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 5, y: 5 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 200, y: 200 }, obj)).toBe('outside')
  })

  it('矩形：边界上的点按内部处理', () => {
    const obj = rect(10, 10, 100, 60)
    expect(resolvePaintRegionHit({ x: 10, y: 10 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 110, y: 40 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 60, y: 70 }, obj)).toBe('inside')
  })

  it('圆：包围盒内且半径内命中，半径外不命中（left/top 为左上角）', () => {
    // Circle left/top = 包围盒左上角，圆心在 (left+r, top+r)
    const obj = circle(0, 0, 50)
    expect(resolvePaintRegionHit({ x: 50, y: 50 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 90, y: 50 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 90, y: 80 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 110, y: 50 }, obj)).toBe('outside')
  })

  it('路径：闭合三角形内命中、外不命中', () => {
    const triangle = {
      path: [
        ['M', 0, 0],
        ['L', 100, 0],
        ['L', 50, 80],
        ['Z']
      ]
    }
    expect(resolvePaintRegionHit({ x: 50, y: 10 }, triangle)).toBe('inside')
    // 左斜边外侧的左下角区域
    expect(resolvePaintRegionHit({ x: 5, y: 60 }, triangle)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 50, y: 90 }, triangle)).toBe('outside')
  })

  it('路径：贝塞尔封闭曲线（半圆拱形）判定', () => {
    const arch = {
      path: [
        ['M', 0, 0],
        ['C', 0, 100, 200, 100, 200, 0],
        ['Z']
      ]
    }
    // 拱内靠下位置（曲线下方）
    expect(resolvePaintRegionHit({ x: 100, y: 30 }, arch)).toBe('inside')
    // 拱外（高于端点连线）
    expect(resolvePaintRegionHit({ x: 100, y: -10 }, arch)).toBe('outside')
  })

  it('路径：偶奇规则处理带洞图形（回字形）', () => {
    const ringShape = {
      path: [
        ['M', 0, 0],
        ['L', 100, 0],
        ['L', 100, 100],
        ['L', 0, 100],
        ['Z'],
        ['M', 30, 30],
        ['L', 70, 30],
        ['L', 70, 70],
        ['L', 30, 70],
        ['Z']
      ]
    }
    // 外环与内环之间（实体部分）
    expect(resolvePaintRegionHit({ x: 15, y: 50 }, ringShape)).toBe('inside')
    // 洞内：两次环绕，射线偶数交点，判为外部
    expect(resolvePaintRegionHit({ x: 50, y: 50 }, ringShape)).toBe('outside')
  })

  it('多子路径（paths 数组）：任一子环命中即命中', () => {
    const twoIslands = {
      paths: [
        [
          ['M', 0, 0],
          ['L', 20, 0],
          ['L', 20, 20],
          ['Z']
        ],
        [
          ['M', 100, 100],
          ['L', 120, 100],
          ['L', 120, 120],
          ['Z']
        ]
      ]
    }
    expect(resolvePaintRegionHit({ x: 10, y: 10 }, twoIslands)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 110, y: 110 }, twoIslands)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 60, y: 60 }, twoIslands)).toBe('outside')
  })

  it('编组：任一子对象包含点击点即命中', () => {
    const obj = group(rect(0, 0, 20, 20), rect(100, 100, 20, 20))
    expect(resolvePaintRegionHit({ x: 10, y: 10 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 110, y: 110 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 50, y: 50 }, obj)).toBe('outside')
  })

  it('嵌套编组递归判定', () => {
    const obj = group(group(rect(0, 0, 40, 40)))
    expect(resolvePaintRegionHit({ x: 20, y: 20 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 60, y: 60 }, obj)).toBe('outside')
  })

  it('场景变换：旋转 90° 后的三角形命中随图形旋转', () => {
    const triangle = {
      path: [
        ['M', 0, 0],
        ['L', 100, 0],
        ['L', 50, 80],
        ['Z']
      ]
    }
    // 顶点朝下的三角形旋转 90°（顺时针）后尖头朝左：原"内部点"(50,10) 变换到 (10,-50) 附近
    const rings = toScenePolygon(triangle, rotate(Math.PI / 2))
    // 用 toScenePolygon 输出直接做判定：把旋转后的环传给逐点判定
    // 场景点 (10, -50) 应在旋转后图形内部
    const rotatedPoint = applyMatrix(rotate(Math.PI / 2), { x: 50, y: 10 })
    let hit = 'outside'
    for (const ring of rings) {
      if (resolvePaintRegionHit(rotatedPoint, { path: ringToPathCommands(ring.points) }) === 'inside') {
        hit = 'inside'
        break
      }
    }
    expect(hit).toBe('inside')
  })
})

/** 把折线环转回 M/L/Z 命令序列，便于复用 resolvePaintRegionHit 做变换后判定。 */
function ringToPathCommands(points: Array<{ x: number; y: number }>) {
  const commands: Array<[string, number, number]> = []
  points.forEach((point, index) => {
    commands.push([index === 0 ? 'M' : 'L', point.x, point.y])
  })
  commands.push(['Z', 0, 0] as unknown as [string, number, number])
  return commands
}

describe('collectObjectsContainingPoint', () => {
  it('收集全部包含点击点的对象', () => {
    const objects = [
      rect(0, 0, 100, 100),
      rect(50, 50, 100, 100),
      rect(500, 500, 10, 10)
    ]
    const hits = collectObjectsContainingPoint({ x: 75, y: 75 }, objects)
    expect(hits).toHaveLength(2)
    expect(hits).toContain(objects[0])
    expect(hits).toContain(objects[1])
  })
})

describe('isSolidFillMatched', () => {
  it('纯色字符串匹配（大小写不敏感）', () => {
    expect(isSolidFillMatched({ fill: '#ff0000' }, '#FF0000')).toBe(true)
    expect(isSolidFillMatched({ fill: '#ff0000' }, '#00ff00')).toBe(false)
    expect(isSolidFillMatched({ fill: '' }, '#ff0000')).toBe(false)
  })

  it('渐变/图案/编组/空对象不视为同色', () => {
    expect(isSolidFillMatched({ fill: { colorStops: [] } }, '#ff0000')).toBe(false)
    expect(isSolidFillMatched(group(), '#ff0000')).toBe(false)
    expect(isSolidFillMatched(null, '#ff0000')).toBe(false)
  })

  it('未开启填充（transparent/none）不视为同色，油漆桶不会跳过它', () => {
    expect(isSolidFillMatched({ fill: 'transparent' }, '#ff0000')).toBe(false)
    expect(isSolidFillMatched({ fill: 'none' }, '#ff0000')).toBe(false)
    expect(isSolidFillMatched({ fill: null }, '#ff0000')).toBe(false)
  })
})

// ── fabric 对象（自带 calcTransformMatrix）：按渲染帧 + 矩阵上屏 ──

type TransformOptions = { scaleX?: number; scaleY?: number; angle?: number }

/**
 * 组合 fabric 风格的对象矩阵：translate(center) · rotate(angle) · scale(sx, sy)，
 * 与 fabric calcOwnMatrix（无斜切）的结果一致。
 */
function composeMatrix(centerX: number, centerY: number, options: TransformOptions = {}): Matrix {
  const sx = options.scaleX ?? 1
  const sy = options.scaleY ?? 1
  const cos = Math.cos(options.angle ?? 0)
  const sin = Math.sin(options.angle ?? 0)
  return [cos * sx, sin * sx, -sin * sy, cos * sy, centerX, centerY]
}

/** fabric 7 风格圆形：left/top 为中心（默认 originX/originY=center），带 type 与矩阵；fill 缺省透明模拟"未开启填充"。 */
function fabricCircle(centerX: number, centerY: number, radius: number, options: TransformOptions & { fill?: string } = {}) {
  return {
    type: 'circle',
    radius,
    left: centerX,
    top: centerY,
    width: radius * 2,
    height: radius * 2,
    fill: options.fill ?? 'transparent',
    calcTransformMatrix: () => composeMatrix(centerX, centerY, options)
  }
}

/** fabric 7 风格矩形：带圆角 rx/ry 字段（默认 0），type 为 rect。 */
function fabricRect(centerX: number, centerY: number, width: number, height: number, options: TransformOptions & { rx?: number; ry?: number } = {}) {
  return {
    type: 'rect',
    left: centerX,
    top: centerY,
    width,
    height,
    rx: options.rx ?? 0,
    ry: options.ry ?? 0,
    calcTransformMatrix: () => composeMatrix(centerX, centerY, options)
  }
}

/** fabric 7 风格路径：path 命令 + pathOffset + 矩阵（渲染位置 = matrix · (命令 − pathOffset)）。 */
function fabricPath(path: unknown[], pathOffset: { x: number; y: number }, centerX: number, centerY: number, options: TransformOptions = {}) {
  return {
    type: 'path',
    path,
    pathOffset,
    left: centerX,
    top: centerY,
    calcTransformMatrix: () => composeMatrix(centerX, centerY, options)
  }
}

describe('fabric 对象：中心原点 + 变换矩阵上屏', () => {
  it('圆形（left/top 为中心）：点击视觉圆心命中，旧"左上角语义"推算的假圆心不命中', () => {
    // 复刻运行时实测对象：left=226/top=192 即圆心，半径 49（bbox 177,143,98,98）
    const obj = fabricCircle(226, 192, 49)
    expect(resolvePaintRegionHit({ x: 226, y: 192 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 270, y: 192 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 179, y: 192 }, obj)).toBe('inside')
    // 若把 left/top 当左上角，会把圆心误算到 (275, 241)：该点距真实圆心 69 > 49，必须判外
    expect(resolvePaintRegionHit({ x: 275, y: 241 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 226, y: 252 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 300, y: 300 }, obj)).toBe('outside')
  })

  it('圆形缩放：半径随矩阵缩放（scaleX=2 时横向可达 2r）', () => {
    const obj = fabricCircle(226, 192, 49, { scaleX: 2 })
    expect(resolvePaintRegionHit({ x: 226 + 80, y: 192 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 226, y: 192 + 40 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 226, y: 192 + 60 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 226 + 80, y: 192 + 40 }, obj)).toBe('outside')
  })

  it('椭圆：按 rx/ry 采样，以矩阵平移量为圆心', () => {
    const obj = { type: 'ellipse', rx: 60, ry: 20, width: 120, height: 40, calcTransformMatrix: () => translate(100, 100) }
    expect(resolvePaintRegionHit({ x: 150, y: 100 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 100, y: 115 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 100, y: 125 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 150, y: 115 }, obj)).toBe('outside')
  })

  it('带圆角的 Rect（rx/ry>0）按矩形判定，不误判为半径 rx 的椭圆', () => {
    const obj = fabricRect(100, 100, 80, 40, { rx: 8, ry: 8 })
    expect(resolvePaintRegionHit({ x: 135, y: 115 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 100, y: 100 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 145, y: 100 }, obj)).toBe('outside')
  })

  it('矩形旋转 90°：命中区域随矩阵旋转（100×20 变为 20×100）', () => {
    const obj = fabricRect(100, 100, 100, 20, { angle: Math.PI / 2 })
    expect(resolvePaintRegionHit({ x: 100, y: 140 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 100, y: 60 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 130, y: 100 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 100, y: 45 }, obj)).toBe('outside')
  })

  it('形状库路径（命令以 (0,0) 为中心、pathOffset 为 0）：按对象位置命中，不再落在画布原点附近', () => {
    const obj = fabricPath(
      [['M', -49, -49], ['L', 49, -49], ['L', 49, 49], ['L', -49, 49], ['Z']],
      { x: 0, y: 0 },
      256,
      256
    )
    expect(resolvePaintRegionHit({ x: 256, y: 256 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 300, y: 300 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 310, y: 256 }, obj)).toBe('outside')
    // 直接拿原始命令判定会把画布原点判为内部，这是旧实现的错误结果
    expect(resolvePaintRegionHit({ x: 0, y: 0 }, obj)).toBe('outside')
  })

  it('钢笔路径（命令即场景坐标、pathOffset 为包围盒中心、对象定位在 pathOffset）：原位命中', () => {
    const obj = fabricPath(
      [['M', 200, 200], ['L', 300, 200], ['L', 300, 300], ['L', 200, 300], ['Z']],
      { x: 250, y: 250 },
      250,
      250
    )
    expect(resolvePaintRegionHit({ x: 250, y: 250 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 210, y: 210 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 310, y: 250 }, obj)).toBe('outside')
  })

  it('路径缩放 + 旋转：命中随矩阵变换', () => {
    // 本体 ±10 的正方形，放大 5 倍后旋转 45°，落点 (400, 400)：对角线半长 50√2≈70.7
    const obj = fabricPath(
      [['M', -10, -10], ['L', 10, -10], ['L', 10, 10], ['L', -10, 10], ['Z']],
      { x: 0, y: 0 },
      400,
      400,
      { scaleX: 5, scaleY: 5, angle: Math.PI / 4 }
    )
    expect(resolvePaintRegionHit({ x: 400, y: 400 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 460, y: 400 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 445, y: 445 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 480, y: 400 }, obj)).toBe('outside')
  })

  it('折线/多边形（points + pathOffset）：顶点减去 pathOffset 后套矩阵', () => {
    const obj = {
      type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
      pathOffset: { x: 20, y: 20 },
      calcTransformMatrix: () => translate(500, 500)
    }
    expect(resolvePaintRegionHit({ x: 500, y: 500 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 515, y: 505 }, obj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 530, y: 500 }, obj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 20, y: 20 }, obj)).toBe('outside')
  })

  it('编组：逐子对象按各自（已复合编组变换的）矩阵上屏，编组包围盒内但子对象外不命中', () => {
    // fabric 子对象的 calcTransformMatrix 已复合编组矩阵：编组在 (300,300)，子圆本体偏移 (20,0) → 场景 (320,300)
    const child = { type: 'circle', radius: 10, width: 20, height: 20, calcTransformMatrix: () => translate(320, 300) }
    const groupObj = {
      type: 'group',
      width: 60,
      height: 30,
      getObjects: () => [child],
      calcTransformMatrix: () => translate(300, 300)
    }
    expect(resolvePaintRegionHit({ x: 320, y: 300 }, groupObj)).toBe('inside')
    expect(resolvePaintRegionHit({ x: 300, y: 300 }, groupObj)).toBe('outside')
    expect(resolvePaintRegionHit({ x: 335, y: 300 }, groupObj)).toBe('outside')
  })

  it('extractObjectBoundary 对 fabric 对象产出以中心为原点的本体帧边界', () => {
    const rings = extractObjectBoundary(fabricCircle(226, 192, 49))
    expect(rings).toHaveLength(1)
    const xs = rings[0].points.map((point) => point.x)
    const ys = rings[0].points.map((point) => point.y)
    expect(Math.max(...xs)).toBeCloseTo(49)
    expect(Math.min(...xs)).toBeCloseTo(-49)
    expect(Math.max(...ys)).toBeCloseTo(49)
    expect(Math.min(...ys)).toBeCloseTo(-49)
  })

  it('toScenePolygon 显式矩阵：先减 pathOffset 再套传入矩阵', () => {
    const obj = fabricPath(
      [['M', 200, 200], ['L', 300, 200], ['L', 300, 300], ['Z']],
      { x: 250, y: 250 },
      250,
      250
    )
    const rings = toScenePolygon(obj, translate(1000, 1000))
    expect(rings[0].points[0]).toEqual({ x: 950, y: 950 })
    expect(rings[0].points[1]).toEqual({ x: 1050, y: 950 })
  })

  it('collectObjectsContainingPoint 不依赖填充状态：透明填充的圆同样被收集', () => {
    const transparentCircle = fabricCircle(226, 192, 49, { fill: 'transparent' })
    const farCircle = fabricCircle(400, 400, 10, { fill: '#ff0000' })
    const hits = collectObjectsContainingPoint({ x: 226, y: 192 }, [transparentCircle, farCircle])
    expect(hits).toEqual([transparentCircle])
    expect((hits[0] as { fill: string }).fill).toBe('transparent')
  })
})
