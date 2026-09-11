import { describe, expect, it } from 'vitest'
import {
  TRANSPARENT_COLOR_KEY,
  isGradientLikeColor,
  normalizeColorKey,
  replaceDocumentColor,
  scanDocumentColors
} from '../colorReplace'

describe('normalizeColorKey', () => {
  it('hex 统一为小写，短写法按位扩展', () => {
    expect(normalizeColorKey('#FF0000')).toBe('#ff0000')
    expect(normalizeColorKey('#f00')).toBe('#ff0000')
    expect(normalizeColorKey('#F0f')).toBe('#ff00ff')
    // 4 位为 #rgba：每位翻倍展开
    expect(normalizeColorKey('#f00c')).toBe('#ff0000cc')
    expect(normalizeColorKey('#ff000080')).toBe('#ff000080')
  })

  it('rgb/rgba 折算为 hex，alpha=1 时省略 alpha 段', () => {
    expect(normalizeColorKey('rgb(255, 0, 0)')).toBe('#ff0000')
    expect(normalizeColorKey('rgba(0,0,0,1)')).toBe('#000000')
    expect(normalizeColorKey('rgba(0 0 0 / 0.25)')).toBe('#00000040')
    expect(normalizeColorKey('RGB( 0 , 128 , 255 )')).toBe('#0080ff')
    expect(normalizeColorKey('rgb(100%, 0%, 0%)')).toBe('#ff0000')
    expect(normalizeColorKey('rgba(255, 0, 0, 50%)')).toBe('#ff000080')
  })

  it('transparent 单独成键；非法取值返回 null', () => {
    expect(normalizeColorKey('  Transparent ')).toBe(TRANSPARENT_COLOR_KEY)
    for (const value of ['', 'none', 'red', '#12', '#12345', '#1234567', 'rgb(1,2)', 'rgb(a,b,c)', null, undefined, 42, {}]) {
      expect(normalizeColorKey(value)).toBeNull()
    }
  })

  it('大小写与写法简并：同一颜色的不同写法归一到同一个键', () => {
    const keys = new Set([
      normalizeColorKey('#FF0000'),
      normalizeColorKey('#f00'),
      normalizeColorKey('rgb(255,0,0)'),
      normalizeColorKey('rgba(255, 0, 0, 1)')
    ])
    expect(keys.size).toBe(1)
  })
})

describe('isGradientLikeColor', () => {
  it('只把带 colorStops 数组的对象识别为渐变', () => {
    expect(isGradientLikeColor({ colorStops: [{ offset: 0, color: '#000' }] })).toBe(true)
    expect(isGradientLikeColor({ colorStops: [] })).toBe(true)
    for (const value of ['#fff', null, undefined, 1, [], { stops: [] }, { colorStops: 'x' }]) {
      expect(isGradientLikeColor(value)).toBe(false)
    }
  })
})

describe('scanDocumentColors', () => {
  it('扫描 fill/stroke 字符串颜色并按出现次数排序', () => {
    const objects = [
      { fill: '#ff0000', stroke: '#00ff00' },
      { fill: '#f00', stroke: null },
      { fill: 'rgba(0, 255, 0, 1)' }
    ]
    const entries = scanDocumentColors(objects)
    expect(entries).toEqual([
      // 次数并列时按键名升序，保证输出稳定；stroke: null 不参与扫描
      { key: '#00ff00', display: '#00ff00', count: 2 },
      { key: '#ff0000', display: '#ff0000', count: 2 }
    ])
  })

  it('渐变色标逐个计数；' + '编组递归且跳过自身 fill/stroke', () => {
    const gradient = {
      colorStops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: 'rgb(0, 0, 255)' }
      ]
    }
    const group = {
      // 编组自身 fill 是 fabric 默认值，无视觉意义，不应被扫描
      fill: 'rgb(0, 0, 0)',
      getObjects: () => [
        { fill: gradient, stroke: '#00ff00' },
        { fill: '#ff0000' }
      ]
    }
    const entries = scanDocumentColors([group])
    expect(entries).toEqual([
      { key: '#ff0000', display: '#ff0000', count: 2 },
      { key: '#0000ff', display: '#0000ff', count: 1 },
      { key: '#00ff00', display: '#00ff00', count: 1 }
    ])
  })

  it('isExcluded 命中的对象（含编组子树）不参与扫描', () => {
    const preview = { fill: '#123456', getObjects: () => [{ fill: '#123456' }] }
    const objects = [{ fill: '#ff0000' }, preview]
    const entries = scanDocumentColors(objects, { isExcluded: (obj) => obj === preview })
    expect(entries).toEqual([{ key: '#ff0000', display: '#ff0000', count: 1 }])
  })

  it('空文档与全非法颜色返回空列表', () => {
    expect(scanDocumentColors([])).toEqual([])
    expect(scanDocumentColors([{ fill: 'none', stroke: undefined }, { fill: 123 }])).toEqual([])
  })
})

describe('replaceDocumentColor', () => {
  it('替换 fill/stroke 中相等的字符串颜色并返回对象与槽位统计', () => {
    const a = { fill: '#ff0000', stroke: '#ff0000' }
    const b = { fill: '#f00' }
    const c = { fill: '#00ff00' }
    const result = replaceDocumentColor([a, b, c], '#FF0000', '#00ff00')
    expect(result).toEqual({ objectCount: 2, slotCount: 3 })
    expect(a).toEqual({ fill: '#00ff00', stroke: '#00ff00' })
    expect(b).toEqual({ fill: '#00ff00' })
    expect(c).toEqual({ fill: '#00ff00' })
  })

  it('替换渐变色标时保留渐变实例身份，只更新命中的色标', () => {
    const gradient = {
      colorStops: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: 'rgba(255, 0, 0, 1)' }
      ]
    }
    const obj = { fill: gradient, stroke: '#ff0000' }
    const result = replaceDocumentColor([obj], '#f00', 'rgb(0, 0, 255)')
    expect(result).toEqual({ objectCount: 1, slotCount: 3 })
    // 同一实例被就地更新，不会变成普通对象
    expect(obj.fill).toBe(gradient)
    expect(gradient.colorStops[0]).toEqual({ offset: 0, color: '#0000ff' })
    expect(gradient.colorStops[1]).toEqual({ offset: 0.5, color: '#00ff00' })
    expect(gradient.colorStops[2]).toEqual({ offset: 1, color: '#0000ff' })
    expect(obj.stroke).toBe('#0000ff')
  })

  it('同步更新 fillGradientStops 元数据，避免保存/撤销后按元数据重建回退', () => {
    const obj = {
      fill: '#ff0000',
      fillGradientStops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#ffffff' }
      ]
    }
    const result = replaceDocumentColor([obj], '#ff0000', '#123456')
    expect(result).toEqual({ objectCount: 1, slotCount: 2 })
    expect(obj.fill).toBe('#123456')
    expect(obj.fillGradientStops).toEqual([
      { offset: 0, color: '#123456' },
      { offset: 1, color: '#ffffff' }
    ])
  })

  it('编组子树内的颜色同样替换且编组计入对象数', () => {
    const child = { fill: '#ff0000' }
    const group = { getObjects: () => [child] }
    const result = replaceDocumentColor([group], '#f00', '#00ff00')
    expect(result).toEqual({ objectCount: 1, slotCount: 1 })
    expect(child.fill).toBe('#00ff00')
  })

  it('transparent 可作为源色参与替换，也可作为目标色', () => {
    const a = { fill: 'transparent', stroke: '#ffffff00' }
    const toTransparent = replaceDocumentColor([a], '#ffffff00', 'transparent')
    expect(toTransparent).toEqual({ objectCount: 1, slotCount: 1 })
    expect(a.stroke).toBe('transparent')
    const fromTransparent = replaceDocumentColor([a], 'transparent', '#ff0000')
    // fill 与 stroke 都已是 transparent，两处同时被替换
    expect(fromTransparent).toEqual({ objectCount: 1, slotCount: 2 })
    expect(a.fill).toBe('#ff0000')
    expect(a.stroke).toBe('#ff0000')
  })

  it('源色与目标色相同或非法时不做任何替换', () => {
    const obj = { fill: '#ff0000' }
    expect(replaceDocumentColor([obj], '#f00', '#ff0000')).toEqual({ objectCount: 0, slotCount: 0 })
    expect(replaceDocumentColor([obj], 'none', '#00ff00')).toEqual({ objectCount: 0, slotCount: 0 })
    expect(replaceDocumentColor([obj], '#f00', 'red')).toEqual({ objectCount: 0, slotCount: 0 })
    expect(obj.fill).toBe('#ff0000')
  })

  it('isExcluded 跳过的对象不替换', () => {
    const skipped = { fill: '#ff0000' }
    const kept = { fill: '#ff0000' }
    const result = replaceDocumentColor([skipped, kept], '#f00', '#00ff00', { isExcluded: (obj) => obj === skipped })
    expect(result).toEqual({ objectCount: 1, slotCount: 1 })
    expect(skipped.fill).toBe('#ff0000')
    expect(kept.fill).toBe('#00ff00')
  })
})
