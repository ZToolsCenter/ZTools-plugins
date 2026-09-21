import { describe, expect, it, vi } from 'vitest'
import { createHomePaintBucketModule } from '../createHomePaintBucketModule'

/**
 * 油漆桶模块单测：聚焦 PS 式前景/背景双颜料与上色行为模式语义（不依赖 Fabric 运行时）。
 * Canvas 相关路径以空实现注入——activate 的 discard 只在画布存在时才被调用。
 */
function createModule(overrides: { foreground?: string; background?: string } = {}) {
  const fillGetter = vi.fn(() => overrides.foreground ?? '#000000')
  const strokeGetter = vi.fn(() => overrides.background ?? '#ffffff')
  const { controller } = createHomePaintBucketModule({
    getFabricCanvas: () => null,
    getForegroundColor: fillGetter,
    getBackgroundColor: strokeGetter,
    isExcludedTarget: (obj) => !obj,
    applyObjectFill: vi.fn(() => true),
    applyObjectStroke: vi.fn(() => true)
  })
  return { controller, fillGetter, strokeGetter }
}

describe('createHomePaintBucketModule 颜料状态', () => {
  it('构造时播种一次颜料，默认前景黑背景白', () => {
    const { controller } = createModule()
    expect(controller.state.paintForegroundColor.value).toBe('#000000')
    expect(controller.state.paintBackgroundColor.value).toBe('#ffffff')
    expect(controller.state.paintBehavior.value).toBe('fill')
    expect(controller.state.paintBucketActive.value).toBe(false)
  })

  it('显式种子覆盖默认黑白', () => {
    const { controller } = createModule({ foreground: '#0aff0a', background: '#ff0000' })
    expect(controller.state.paintForegroundColor.value).toBe('#0aff0a')
    expect(controller.state.paintBackgroundColor.value).toBe('#ff0000')
  })

  it('颜料跨激活持久：退出再激活不重新播种', () => {
    const { controller, fillGetter } = createModule()
    controller.commands.activate()
    controller.commands.setForegroundColor('#111111')
    controller.commands.activate() // 退出
    expect(fillGetter).toHaveBeenCalledTimes(1)
    controller.commands.activate() // 再次激活
    expect(controller.state.paintForegroundColor.value).toBe('#111111')
    controller.commands.deactivate()
  })

  it('swapColors 交换前景/背景', () => {
    const { controller } = createModule()
    controller.commands.setForegroundColor('#123456')
    controller.commands.setBackgroundColor('#654321')
    controller.commands.swapColors()
    expect(controller.state.paintForegroundColor.value).toBe('#654321')
    expect(controller.state.paintBackgroundColor.value).toBe('#123456')
  })

  it('setForegroundColor 静默忽略非法值', () => {
    const { controller } = createModule()
    controller.commands.setForegroundColor('#abcdef')
    controller.commands.setForegroundColor('')
    controller.commands.setForegroundColor('   ')
    expect(controller.state.paintForegroundColor.value).toBe('#abcdef')
  })
})

describe('createHomePaintBucketModule 上色行为', () => {
  it('toggleBehavior 在填充/描边间切换；setBehavior 只接受合法值', () => {
    const { controller } = createModule()
    expect(controller.state.paintBehavior.value).toBe('fill')
    controller.commands.toggleBehavior()
    expect(controller.state.paintBehavior.value).toBe('stroke')
    controller.commands.toggleBehavior()
    expect(controller.state.paintBehavior.value).toBe('fill')
    controller.commands.setBehavior('stroke')
    expect(controller.state.paintBehavior.value).toBe('stroke')
    controller.commands.setBehavior('inside' as never)
    expect(controller.state.paintBehavior.value).toBe('stroke')
  })

  it('描边行为下 Fabric 命中对象优先，应用描边色', () => {
    const applyObjectStroke = vi.fn(() => true)
    const { controller } = createHomePaintBucketModule({
      getFabricCanvas: () => null,
      isExcludedTarget: (obj) => !obj,
      applyObjectFill: vi.fn(() => true),
      applyObjectStroke
    })
    controller.commands.activate()
    controller.commands.setBehavior('stroke')
    const target = { stroke: '#999999', fill: '#cccccc' }
    const result = controller.commands.handlePaintBucketClick({ x: 5, y: 5 }, target as never)
    expect(result.applied).toBe(true)
    expect(result.mode).toBe('stroke')
    expect(result.target).toBe(target)
    expect(applyObjectStroke).toHaveBeenCalledWith(target, '#000000')
    controller.commands.deactivate()
  })

  it('描边行为下命中对象已是目标描边色时跳过', () => {
    const { controller } = createModule()
    controller.commands.activate()
    controller.commands.setBehavior('stroke')
    const target = { stroke: '#000000', fill: '#cccccc' } // 前景默认 #000000
    const result = controller.commands.handlePaintBucketClick({ x: 5, y: 5 }, target as never)
    expect(result.applied).toBe(false)
    expect(result.skipped).toBe(1)
    controller.commands.deactivate()
  })

  it('未激活时点击不产生任何效果', () => {
    const { controller } = createModule()
    const result = controller.commands.handlePaintBucketClick({ x: 5, y: 5 }, {} as never)
    expect(result.applied).toBe(false)
    expect(result.target).toBeNull()
  })
})

/**
 * fabric 7 风格圆形（left/top 为中心、自带 calcTransformMatrix）；
 * fill 缺省 transparent，模拟属性面板"关闭填充"后的目标。
 */
function fabricCircle(centerX: number, centerY: number, radius: number, fill = 'transparent') {
  return {
    type: 'circle',
    radius,
    left: centerX,
    top: centerY,
    width: radius * 2,
    height: radius * 2,
    fill,
    calcTransformMatrix: () => [1, 0, 0, 1, centerX, centerY]
  }
}

/** 以画布桩（getObjects 返回给定对象）创建并激活填充模式的油漆桶模块。 */
function createFillModule(objects: unknown[]) {
  const applyObjectFill = vi.fn(() => true)
  const canvas = { getObjects: () => objects, discardActiveObject: vi.fn(), requestRenderAll: vi.fn() }
  const { controller } = createHomePaintBucketModule({
    getFabricCanvas: () => canvas as never,
    isExcludedTarget: (obj) => !obj,
    applyObjectFill,
    applyObjectStroke: vi.fn(() => true)
  })
  controller.commands.activate()
  return { controller, applyObjectFill }
}

describe('createHomePaintBucketModule 填充行为（区域命中）', () => {
  it('未开启填充（transparent）的目标：点击视觉中心命中并交给 applyObjectFill 上色', () => {
    const circle = fabricCircle(226, 192, 49)
    const { controller, applyObjectFill } = createFillModule([circle])
    controller.commands.setForegroundColor('#ff0000')
    const result = controller.commands.handlePaintBucketClick({ x: 226, y: 192 }, null)
    expect(result).toEqual({ applied: true, mode: 'fill', target: circle, skipped: 0 })
    expect(applyObjectFill).toHaveBeenCalledWith(circle, '#ff0000')
  })

  it('点击落在目标区域外时不上色，也不计入跳过', () => {
    const circle = fabricCircle(226, 192, 49)
    const { controller, applyObjectFill } = createFillModule([circle])
    const result = controller.commands.handlePaintBucketClick({ x: 300, y: 300 }, null)
    expect(result.applied).toBe(false)
    expect(result.skipped).toBe(0)
    expect(applyObjectFill).not.toHaveBeenCalled()
  })

  it('目标已是前景色时跳过（skipped=1），不重复上色', () => {
    const circle = fabricCircle(226, 192, 49, '#000000')
    const { controller, applyObjectFill } = createFillModule([circle])
    const result = controller.commands.handlePaintBucketClick({ x: 226, y: 192 }, null)
    expect(result.applied).toBe(false)
    expect(result.skipped).toBe(1)
    expect(applyObjectFill).not.toHaveBeenCalled()
  })

  it('多层重叠时优先给最上层（z 序靠后）的对象上色', () => {
    const bottom = fabricCircle(226, 192, 49)
    const top = fabricCircle(226, 192, 30)
    const { controller, applyObjectFill } = createFillModule([bottom, top])
    const result = controller.commands.handlePaintBucketClick({ x: 226, y: 192 }, null)
    expect(result.target).toBe(top)
    expect(applyObjectFill).toHaveBeenCalledTimes(1)
    expect(applyObjectFill).toHaveBeenCalledWith(top, '#000000')
  })

  it('previewHitAt：未开启填充的目标区域内为 inside，区域外为 null', () => {
    const circle = fabricCircle(226, 192, 49)
    const { controller } = createFillModule([circle])
    expect(controller.commands.previewHitAt({ x: 226, y: 192 }, null)).toBe('inside')
    expect(controller.commands.previewHitAt({ x: 300, y: 300 }, null)).toBeNull()
  })
})
