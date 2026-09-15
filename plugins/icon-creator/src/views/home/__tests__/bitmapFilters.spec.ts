import { describe, expect, it } from 'vitest'
import {
  BITMAP_FILTER_TYPES,
  blendModeToCompositeOperation,
  compositeOperationToBlendMode,
  createDefaultBitmapFilterSetting,
  normalizeBlendMode,
  normalizeBitmapFilterSetting,
  normalizeBitmapFilterSettings,
  readBitmapFilterSettings
} from '../bitmapFilters'

/**
 * 位图滤镜与混合模式纯数据模型的归一化语义：
 * 这些函数同时被属性面板、运行时与 MCP 调度层复用，
 * 归一化行为（类型白名单、区间收敛、固定顺序、回退识别）是三处一致性的基础。
 */
describe('normalizeBitmapFilterSetting', () => {
  it('类型白名单外的条目返回 null，非对象输入返回 null', () => {
    expect(normalizeBitmapFilterSetting({ type: 'vignette' })).toBeNull()
    expect(normalizeBitmapFilterSetting({ type: '' })).toBeNull()
    expect(normalizeBitmapFilterSetting('blur')).toBeNull()
    expect(normalizeBitmapFilterSetting(null)).toBeNull()
  })

  it('enabled 缺省视为启用，仅显式 false 视为禁用', () => {
    expect(normalizeBitmapFilterSetting({ type: 'grayscale' })?.enabled).toBe(true)
    expect(normalizeBitmapFilterSetting({ type: 'grayscale', enabled: false })?.enabled).toBe(false)
    // 非布尔值（如字符串）与缺失同义，视为启用
    expect(normalizeBitmapFilterSetting({ type: 'grayscale', enabled: 'yes' })?.enabled).toBe(true)
  })

  it('参数按各自区间收敛：blur 0-1，颜色类 -1~1', () => {
    expect(normalizeBitmapFilterSetting({ type: 'blur', strength: 5 })).toMatchObject({ strength: 1 })
    expect(normalizeBitmapFilterSetting({ type: 'blur', strength: -1 })).toMatchObject({ strength: 0 })
    expect(normalizeBitmapFilterSetting({ type: 'brightness', brightness: 3 })).toMatchObject({ brightness: 1 })
    expect(normalizeBitmapFilterSetting({ type: 'contrast', contrast: -3 })).toMatchObject({ contrast: -1 })
    expect(normalizeBitmapFilterSetting({ type: 'saturation', saturation: 0.35 })).toMatchObject({ saturation: 0.35 })
  })

  it('未提供的参数补启用默认值：blur 0.1，颜色类 0', () => {
    expect(normalizeBitmapFilterSetting({ type: 'blur' })).toMatchObject({ strength: 0.1 })
    expect(normalizeBitmapFilterSetting({ type: 'brightness' })).toMatchObject({ brightness: 0 })
    expect(normalizeBitmapFilterSetting({ type: 'contrast' })).toMatchObject({ contrast: 0 })
    expect(normalizeBitmapFilterSetting({ type: 'saturation' })).toMatchObject({ saturation: 0 })
  })

  it('无参滤镜（灰度/反色/褐色）不携带参数键', () => {
    const setting = normalizeBitmapFilterSetting({ type: 'sepia' })
    expect(setting).toEqual({ type: 'sepia', enabled: true })
  })
})

describe('normalizeBitmapFilterSettings', () => {
  it('按面板固定顺序重建并去重（同类型后项覆盖前项），非法条目跳过', () => {
    const settings = normalizeBitmapFilterSettings([
      { type: 'saturation' },
      { type: 'blur', strength: 0.5 },
      { type: 'invalid' } as never,
      { type: 'grayscale' },
      { type: 'blur', strength: 0.2 }
    ])
    expect(settings.map((setting) => setting.type)).toEqual(['grayscale', 'blur', 'saturation'])
    expect(settings[1]).toMatchObject({ strength: 0.2 })
  })

  it('非数组输入与空数组都返回空列表（整体清除语义）', () => {
    expect(normalizeBitmapFilterSettings('blur')).toEqual([])
    expect(normalizeBitmapFilterSettings(undefined)).toEqual([])
    expect(normalizeBitmapFilterSettings([])).toEqual([])
  })

  it('类型清单顺序即固定顺序（灰度/反色/褐色/模糊/亮度/对比度/饱和度）', () => {
    expect(BITMAP_FILTER_TYPES).toEqual([
      'grayscale',
      'invert',
      'sepia',
      'blur',
      'brightness',
      'contrast',
      'saturation'
    ])
  })
})

describe('混合模式映射', () => {
  it('normal 与 fabric source-over 互转，其余模式名原样映射', () => {
    expect(blendModeToCompositeOperation('normal')).toBe('source-over')
    expect(blendModeToCompositeOperation('multiply')).toBe('multiply')
    expect(blendModeToCompositeOperation('color-dodge')).toBe('color-dodge')
    expect(compositeOperationToBlendMode('source-over')).toBe('normal')
    expect(compositeOperationToBlendMode('multiply')).toBe('multiply')
    // fabric 未设置该属性（undefined/null）时按正常处理
    expect(compositeOperationToBlendMode(undefined)).toBe('normal')
  })

  it('normalizeBlendMode 仅接受受支持的模式名', () => {
    expect(normalizeBlendMode(' screen ')).toBe('screen')
    expect(normalizeBlendMode('wrap')).toBeNull()
    expect(normalizeBlendMode(42)).toBeNull()
  })
})

describe('readBitmapFilterSettings 回读', () => {
  it('优先读 bitmapFilters 元数据并归一化', () => {
    const obj = {
      bitmapFilters: [{ type: 'blur', enabled: false, strength: 0.6 }, { type: 'grayscale' }]
    }
    expect(readBitmapFilterSettings(obj)).toEqual([
      { type: 'grayscale', enabled: true },
      { type: 'blur', enabled: false, strength: 0.6 }
    ])
  })

  it('元数据缺失时回退到原生 filters 数组（fabric 大写 type 与 blur 参数名自动映射）', () => {
    const obj = {
      filters: [
        { type: 'Grayscale', mode: 'average' },
        { type: 'Blur', blur: 0.3 }
      ]
    }
    expect(readBitmapFilterSettings(obj)).toEqual([
      { type: 'grayscale', enabled: true },
      { type: 'blur', enabled: true, strength: 0.3 }
    ])
  })

  it('空对象/无数组字段返回空列表', () => {
    expect(readBitmapFilterSettings({})).toEqual([])
    expect(readBitmapFilterSettings(null)).toEqual([])
  })
})

describe('createDefaultBitmapFilterSetting', () => {
  it('生成带默认参数的设置，禁用态同样保留默认参数供再次启用', () => {
    expect(createDefaultBitmapFilterSetting('blur')).toEqual({ type: 'blur', enabled: true, strength: 0.1 })
    expect(createDefaultBitmapFilterSetting('contrast', false)).toEqual({ type: 'contrast', enabled: false, contrast: 0 })
  })
})
