import { describe, expect, it } from 'vitest'
import { Rect, Shadow } from 'fabric'
import { applyShadowEffectsToFabricObject } from '../objectMetadata'
import {
  buildMultiShadowFilterMarkup,
  getEnabledShadowEffects,
  isMultiShadowActive
} from '../multiShadow'

// 导入 multiShadow 模块即完成原型补丁安装，本文件按多阴影接管语义验证状态判定、
// 序列化安全性与 SVG 导出输出。
import '../multiShadow'

function createDropEffect(overrides: Record<string, unknown> = {}) {
  return {
    id: `effect-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    type: 'drop',
    offsetX: 2,
    offsetY: 4,
    blur: 8,
    spread: 0,
    color: 'rgba(0, 0, 0, 0.25)',
    ...overrides
  }
}

describe('多阴影接管语义', () => {
  it('单个启用投影仍走 fabric 原生 shadow', () => {
    const rect = new Rect({ width: 10, height: 10 })
    ;(rect as any).shadowEffects = [createDropEffect()]
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeInstanceOf(Shadow)
    expect(isMultiShadowActive(rect)).toBe(false)
  })

  it('多个投影时原生 shadow 置空并切换为自绘，序列化仍可用', () => {
    const rect = new Rect({ width: 10, height: 10 })
    ;(rect as any).shadowEffects = [createDropEffect(), createDropEffect({ offsetY: 12 })]
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeNull()
    expect(isMultiShadowActive(rect)).toBe(true)
    // 自绘路径下 shadowEffects 元数据必须完整随 toObject round-trip（保存/撤销/克隆依赖）
    // toObject 的 propertiesToInclude 类型约束为对象已知键，自定义元数据键需透传
    const serialized = rect.toObject(['shadowEffects'] as unknown as Parameters<Rect['toObject']>[0]) as Record<string, any>
    expect(serialized.shadow ?? null).toBeNull()
    expect(serialized.shadowEffects).toHaveLength(2)
  })

  it('唯一效果是内阴影时也切换为自绘（原生 shadow 无内阴影实现）', () => {
    const rect = new Rect({ width: 10, height: 10 })
    ;(rect as any).shadowEffects = [createDropEffect({ type: 'inner' })]
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeNull()
    expect(isMultiShadowActive(rect)).toBe(true)
  })

  it('全部禁用后回到无阴影状态', () => {
    const rect = new Rect({ width: 10, height: 10 })
    ;(rect as any).shadowEffects = [createDropEffect(), createDropEffect({ type: 'inner' })]
    applyShadowEffectsToFabricObject(rect)
    ;(rect as any).shadowEffects.forEach((effect: { enabled: boolean }) => { effect.enabled = false })
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeNull()
    expect(isMultiShadowActive(rect)).toBe(false)
    expect(getEnabledShadowEffects(rect)).toEqual([])
  })

  it('多阴影对象强制独立缓存并补足缓存外扩', () => {
    const rect = new Rect({ width: 100, height: 100 })
    ;(rect as any).shadowEffects = [
      createDropEffect({ offsetX: 0, offsetY: 20, blur: 20 }),
      createDropEffect({ offsetY: 0 })
    ]
    applyShadowEffectsToFabricObject(rect)
    expect(rect.needsItsOwnCache()).toBe(true)
    const dims = (rect as any)._getCacheCanvasDimensions()
    // 本地外扩 = blur(20) + |offsetY|(20) + 余量(2) = 42，双边补足
    expect(dims.width).toBeGreaterThanOrEqual(100 + 42 * 2)
    expect(dims.height).toBeGreaterThanOrEqual(100 + 42 * 2)
  })
})

describe('多阴影 SVG 导出', () => {
  it('两条投影输出多分支 filter 并包一层 <g filter>', () => {
    const rect = new Rect({ width: 50, height: 50, fill: 'red' })
    ;(rect as any).shadowEffects = [createDropEffect(), createDropEffect({ color: 'rgba(255, 0, 0, 0.5)' })]
    applyShadowEffectsToFabricObject(rect)
    const svg = rect.toSVG()
    expect(svg).toContain('<g filter="url(#MSVGID_')
    // sRGB 插值保证与画布渲染观色一致
    expect(svg).toContain('color-interpolation-filters="sRGB"')
    // 每条投影一条 feFlood 支路
    expect(svg.match(/<feFlood /g)).toHaveLength(2)
    // 合并次序：两条投影 + 对象本体（SourceGraphic 最后一条投影之上）
    expect(svg.match(/<feMergeNode /g)).toHaveLength(3)
    expect(svg).toContain('<feMergeNode in="SourceGraphic"/>')
  })

  it('投影与内阴影混合时内阴影走 α 相减支路并叠在对象之上', () => {
    const rect = new Rect({ width: 50, height: 50 })
    ;(rect as any).shadowEffects = [createDropEffect(), createDropEffect({ type: 'inner' })]
    applyShadowEffectsToFabricObject(rect)
    const svg = rect.toSVG()
    // 内阴影支路：SourceAlpha 减去模糊偏移剪影
    expect(svg).toContain('operator="out"')
    const merge = svg.slice(svg.indexOf('<feMerge>'), svg.indexOf('</feMerge>'))
    expect(merge.indexOf('msShadow0')).toBeLessThan(merge.indexOf('SourceGraphic'))
    expect(merge.indexOf('SourceGraphic')).toBeLessThan(merge.indexOf('msInner'))
  })

  it('单投影仍输出 fabric 原生 SVG filter，不产生多阴影包装', () => {
    const rect = new Rect({ width: 50, height: 50 })
    ;(rect as any).shadowEffects = [createDropEffect()]
    applyShadowEffectsToFabricObject(rect)
    const svg = rect.toSVG()
    expect(svg).toContain('filter: url(#SVGID_')
    expect(svg).not.toContain('MSVGID_')
  })

  it('filter 偏移按对象角度反向旋转，与原生 Shadow.toSVG 语义一致', () => {
    const rect = new Rect({ width: 50, height: 50, angle: 90 })
    ;(rect as any).shadowEffects = [
      createDropEffect({ offsetX: 10, offsetY: 0, blur: 10 }),
      createDropEffect({ offsetY: 0 })
    ]
    applyShadowEffectsToFabricObject(rect)
    const markup = buildMultiShadowFilterMarkup(rect as any)
    expect(markup).not.toBeNull()
    // stdDeviation = blur / 2
    expect(markup!.def).toContain('stdDeviation="5"')
    // angle=90° 时偏移 (10, 0) 旋转后变为 (0, -10)
    expect(markup!.def).toContain('dy="-10"')
  })
})
