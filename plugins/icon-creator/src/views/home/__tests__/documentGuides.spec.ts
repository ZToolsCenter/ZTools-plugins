import { describe, expect, it } from 'vitest'
import {
  MAX_DOCUMENT_GUIDES,
  clampGuidePosition,
  createGuideId,
  findGuideAt,
  isGuideOrientation,
  moveGuidePosition,
  normalizeDocumentGuides,
  removeGuideById
} from '../documentGuides'

describe('normalizeDocumentGuides', () => {
  it('任何非法输入都降级为空数组', () => {
    for (const value of [null, undefined, 'guides', 123, { id: 'g1' }, [42], [null], ['horizontal']]) {
      expect(normalizeDocumentGuides(value)).toEqual([])
    }
  })

  it('丢弃方向非法或 position 非有限数字的条目', () => {
    expect(normalizeDocumentGuides([
      { id: 'a', orientation: 'diagonal', position: 10 },
      { id: 'b', orientation: 'horizontal', position: 'x' },
      { id: 'c', orientation: 'vertical', position: Number.NaN },
      { id: 'd', orientation: 'horizontal', position: 0 }
    ])).toEqual([{ id: 'd', orientation: 'horizontal', position: 0 }])
  })

  it('缺 id 补生成、重复 id 重生成，保证 id 唯一', () => {
    const guides = normalizeDocumentGuides([
      { orientation: 'horizontal', position: 10 },
      { id: 'dup', orientation: 'vertical', position: 20 },
      { id: 'dup', orientation: 'vertical', position: 30 }
    ])
    expect(guides).toHaveLength(3)
    expect(new Set(guides.map((guide) => guide.id)).size).toBe(3)
    expect(guides[1].id).toBe('dup')
    expect(guides[2].id).not.toBe('dup')
  })

  it('超出上限时保留先出现的条目', () => {
    const raw = Array.from({ length: MAX_DOCUMENT_GUIDES + 10 }, (_, index) => ({
      id: `g-${index}`,
      orientation: 'horizontal' as const,
      position: index
    }))
    const guides = normalizeDocumentGuides(raw)
    expect(guides).toHaveLength(MAX_DOCUMENT_GUIDES)
    expect(guides[MAX_DOCUMENT_GUIDES - 1].id).toBe(`g-${MAX_DOCUMENT_GUIDES - 1}`)
  })

  it('position 允许小数与 0，不在此处做范围夹取（夹取发生在交互与 MCP 写入侧）', () => {
    expect(normalizeDocumentGuides([
      { id: 'a', orientation: 'vertical', position: -50 },
      { id: 'b', orientation: 'horizontal', position: 123.456 }
    ])).toEqual([
      { id: 'a', orientation: 'vertical', position: -50 },
      { id: 'b', orientation: 'horizontal', position: 123.456 }
    ])
  })
})

describe('clampGuidePosition', () => {
  it('水平线按画布高度夹取，垂直线按画布宽度夹取', () => {
    expect(clampGuidePosition('horizontal', -10, 512, 384)).toBe(0)
    expect(clampGuidePosition('horizontal', 999, 512, 384)).toBe(384)
    expect(clampGuidePosition('vertical', -1, 512, 384)).toBe(0)
    expect(clampGuidePosition('vertical', 600, 512, 384)).toBe(512)
  })

  it('非有限位置回退为 0', () => {
    expect(clampGuidePosition('horizontal', Number.NaN, 512, 512)).toBe(0)
  })
})

describe('findGuideAt / moveGuidePosition / removeGuideById', () => {
  const guides = [
    { id: 'a', orientation: 'horizontal' as const, position: 100 },
    { id: 'b', orientation: 'vertical' as const, position: 80 }
  ]

  it('findGuideAt 命中同方向容差内最近的一条，方向不同或超出容差不命中', () => {
    expect(findGuideAt(guides, 'horizontal', 97, 4)?.id).toBe('a')
    expect(findGuideAt(guides, 'horizontal', 95, 4)).toBeNull()
    expect(findGuideAt(guides, 'vertical', 100, 4)).toBeNull()
  })

  it('moveGuidePosition 返回新数组且只改目标条目，id 不存在时原样浅拷贝', () => {
    const moved = moveGuidePosition(guides, 'b', 90)
    expect(moved).not.toBe(guides)
    expect(moved[1]).toEqual({ id: 'b', orientation: 'vertical', position: 90 })
    expect(guides[1].position).toBe(80)
    const untouched = moveGuidePosition(guides, 'missing', 1)
    expect(untouched).toEqual(guides)
    expect(untouched).not.toBe(guides)
  })

  it('removeGuideById 只删除目标条目', () => {
    const next = removeGuideById(guides, 'a')
    expect(next).toEqual([{ id: 'b', orientation: 'vertical', position: 80 }])
    expect(guides).toHaveLength(2)
  })
})

describe('createGuideId / isGuideOrientation', () => {
  it('createGuideId 连续生成不重复', () => {
    const a = createGuideId()
    const b = createGuideId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^guide-\d+$/)
  })

  it('isGuideOrientation 只接受 horizontal/vertical', () => {
    expect(isGuideOrientation('horizontal')).toBe(true)
    expect(isGuideOrientation('vertical')).toBe(true)
    expect(isGuideOrientation('Horizontal')).toBe(false)
    expect(isGuideOrientation('')).toBe(false)
  })
})
