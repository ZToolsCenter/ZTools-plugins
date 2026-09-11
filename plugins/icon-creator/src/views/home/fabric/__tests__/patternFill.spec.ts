import { describe, expect, it } from 'vitest'
import { Pattern } from 'fabric'
import {
  MAX_PATTERN_FILL_SCALE,
  MIN_PATTERN_FILL_SCALE,
  buildPatternTransform,
  normalizePatternFillRepeat,
  normalizePatternFillScale,
  readPatternFillState,
  validatePatternSourceString
} from '../patternFill'

/**
 * 图案填充数据模型的纯逻辑用例：
 * - 序列化契约实证（fabric 7.3.1）：Pattern.toObject 的 source 只在 source 为"图片元素"
 *   （含 .src）时输出 src 字符串；直接传字符串 source 会序列化为空串导致丢图，
 *   因此运行时必须经 util.loadImage 加载后再构建 Pattern（本用例用带 src 的替身元素验证）。
 * - patternTransform（缩放矩阵）随 toObject 输出，fromObject 端由 loadImage+slice 还原，
 *   dataURL/http 源的完整 round-trip 已在 Node + fabric/node 环境实证通过。
 */

const TILE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('图案平铺与缩放归一化', () => {
  it('repeat 仅接受四个 CSS 同名值', () => {
    expect(normalizePatternFillRepeat('repeat-x')).toBe('repeat-x')
    expect(normalizePatternFillRepeat('mirror')).toBeNull()
    expect(normalizePatternFillRepeat(42)).toBeNull()
  })

  it('scale 收敛到 [0.05, 20]，非正数/非有限数返回 null', () => {
    expect(normalizePatternFillScale(2)).toBe(2)
    expect(normalizePatternFillScale(0.01)).toBe(MIN_PATTERN_FILL_SCALE)
    expect(normalizePatternFillScale(99)).toBe(MAX_PATTERN_FILL_SCALE)
    expect(normalizePatternFillScale(0)).toBeNull()
    expect(normalizePatternFillScale(-1)).toBeNull()
    expect(normalizePatternFillScale('abc')).toBeNull()
  })

  it('buildPatternTransform：缩放为 1 时省略矩阵，其余输出等比矩阵', () => {
    expect(buildPatternTransform(1)).toBeUndefined()
    expect(buildPatternTransform(2)).toEqual([2, 0, 0, 2, 0, 0])
    expect(buildPatternTransform(0.5)).toEqual([0.5, 0, 0, 0.5, 0, 0])
  })

  it('source 仅接受 dataURL 图片与 http(s) URL', () => {
    expect(validatePatternSourceString(TILE_DATA_URL)).toBe(TILE_DATA_URL)
    expect(validatePatternSourceString('https://example.com/tile.png')).toBe('https://example.com/tile.png')
    expect(() => validatePatternSourceString('ftp://example.com/tile.png')).toThrowError(/source 必须是 dataURL 图片/)
  })
})

describe('Pattern 序列化契约（source 必须为图片元素）', () => {
  it('source 为带 src 的图片元素时，toObject 输出 src/repeat/patternTransform', () => {
    const pattern = new Pattern({
      source: { src: TILE_DATA_URL } as unknown as HTMLImageElement,
      repeat: 'repeat-y',
      patternTransform: [2, 0, 0, 2, 0, 0]
    })
    const serialized = pattern.toObject()
    expect(serialized.source).toBe(TILE_DATA_URL)
    expect(serialized.repeat).toBe('repeat-y')
    expect(serialized.patternTransform).toEqual([2, 0, 0, 2, 0, 0])
  })

  it('source 为纯字符串时 toObject 输出空串（运行时禁止直接传字符串的实证依据）', () => {
    const pattern = new Pattern({ source: TILE_DATA_URL as unknown as HTMLImageElement })
    expect(pattern.toObject().source).toBe('')
  })
})

describe('readPatternFillState 面板回显', () => {
  it('fill 为 Pattern 时从实例读取实时参数，缺失字段回退元数据', () => {
    const obj = {
      fill: new Pattern({
        source: { src: TILE_DATA_URL } as unknown as HTMLImageElement,
        repeat: 'repeat-x',
        patternTransform: [2, 0, 0, 2, 0, 0]
      }),
      fillPatternSrc: TILE_DATA_URL,
      fillPatternName: '贴图.png',
      fillPatternRepeat: 'repeat',
      fillPatternScale: 1
    } as unknown as Parameters<typeof readPatternFillState>[0]
    const state = readPatternFillState(obj)
    expect(state.active).toBe(true)
    expect(state.source).toBe(TILE_DATA_URL)
    expect(state.repeat).toBe('repeat-x')
    expect(state.scale).toBe(2)
    expect(state.name).toBe('贴图.png')
  })

  it('fill 非 Pattern 时 active=false 且参数取元数据/默认值', () => {
    const obj = {
      fill: '#ff0000',
      fillPatternSrc: TILE_DATA_URL,
      fillPatternName: '贴图.png'
    } as unknown as Parameters<typeof readPatternFillState>[0]
    const state = readPatternFillState(obj)
    expect(state.active).toBe(false)
    expect(state.source).toBe(TILE_DATA_URL)
    expect(state.repeat).toBe('repeat')
    expect(state.scale).toBe(1)
  })
})
