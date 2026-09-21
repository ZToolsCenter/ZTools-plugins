import { describe, it, expect } from 'vitest'
import {
  boxFromOcrLine,
  expandBox,
  hasRealBoxes,
  layoutOverlayText,
  coverFillFromSample,
  mapTranslationToLines,
  zipOverlay,
  coverChipStyle,
  fitOverlayBox,
  wrapOverlayLines,
  readableOverlayLayout
} from './pinOverlay'

describe('pin overlay boxes', () => {
  it('prefers boxPoints AABB so the cover sits on the original glyphs', () => {
    const b = boxFromOcrLine({
      text: 'Hi',
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      boxPoints: [
        { x: 10, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 40 },
        { x: 10, y: 40 }
      ]
    })
    expect(b).toEqual({ text: 'Hi', left: 10, top: 20, right: 80, bottom: 40 })
  })

  it('reads left/top/right/bottom when points are missing', () => {
    const b = boxFromOcrLine({ text: 'Hello', left: 10, top: 20, right: 80, bottom: 40 })
    expect(b).toEqual({ text: 'Hello', left: 10, top: 20, right: 80, bottom: 40 })
  })

  it('skips empty or degenerate boxes', () => {
    expect(boxFromOcrLine({ text: '  ' })).toBeNull()
    expect(boxFromOcrLine({ text: 'x', left: 5, top: 5, right: 5, bottom: 9 })).toBeNull()
  })

  it('expands the box so anti-aliased original text is fully covered', () => {
    const e = expandBox({ text: 'a', left: 10, top: 10, right: 50, bottom: 26 }, 200, 100)
    expect(e.left).toBeLessThan(10)
    expect(e.top).toBeLessThan(10)
    expect(e.right).toBeGreaterThan(50)
    expect(e.bottom).toBeGreaterThan(26)
    expect(e.left).toBeGreaterThanOrEqual(0)
  })

  it('zips translations onto the original OCR boxes', () => {
    const out = zipOverlay(
      [{ text: 'Hello', left: 4, top: 4, right: 40, bottom: 18 }],
      ['你好'],
      100,
      50
    )
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('你好')
    expect(out[0].left).toBeLessThanOrEqual(4)
    expect(out[0].right).toBeGreaterThanOrEqual(40)
    expect(out[0].fontSize).toBeGreaterThanOrEqual(Math.round(14 * 0.72))
  })

  it('does not invent full-image rows when OCR has no coordinates', () => {
    expect(hasRealBoxes([{ text: 'a', left: 0, top: 0, right: 0, bottom: 0 }])).toBe(false)
    expect(
      zipOverlay([{ text: 'a', left: 0, top: 0, right: 0, bottom: 0 }], ['译'], 100, 40)
    ).toEqual([])
  })

  it('splits a single translated blob across original boxes by length', () => {
    const mapped = mapTranslationToLines(['aa', 'bb'], ['一二三四'], '一二三四')
    expect(mapped).toHaveLength(2)
    expect(mapped.join('')).toBe('一二三四')
  })
})

describe('overlay readable font', () => {
  it('keeps overlay font close to the original line height for short text', () => {
    const box = { text: 'Hi', left: 10, top: 10, right: 80, bottom: 34 }
    const laid = readableOverlayLayout(box, '你好', 400, 200)
    // 原框高 24px，覆盖字号至少约 85% 行高，不能掉到 10px 地板
    expect(laid.fontSize).toBeGreaterThanOrEqual(20)
    expect(laid.text).toBe('你好')
  })

  it('grows the box for a longer translation instead of shrinking below original line height', () => {
    const box = { text: 'OK', left: 10, top: 10, right: 50, bottom: 34 }
    const laid = readableOverlayLayout(box, '这是更长的一句译文应当完整显示且保持字号', 400, 200)
    expect(laid.fontSize).toBeGreaterThanOrEqual(20)
    expect(laid.right - laid.left).toBeGreaterThan(40)
    expect(laid.lines.join('')).toBe('这是更长的一句译文应当完整显示且保持字号')
  })
})

describe('overlay text layout', () => {
  it('shrinks to a single line when the box is wide enough', () => {
    const l = layoutOverlayText('Hi', 200, 24)
    expect(l.lines).toEqual(['Hi'])
    expect(l.fontSize).toBeGreaterThanOrEqual(8)
  })

  it('uses solid light or dark fill, never the muddy sampled average', () => {
    expect(coverFillFromSample(250, 250, 250)).toEqual({ fill: '#f3f4f6', color: '#111111' })
    expect(coverFillFromSample(20, 20, 20)).toEqual({ fill: '#1a1a1a', color: '#f5f5f5' })
    expect(coverFillFromSample(180, 40, 40).fill).not.toMatch(/^rgb\(/)
  })

  it('does not ellipsize long translations; wraps instead', () => {
    const l = layoutOverlayText('这是一段比较长的译文需要完整显示出来', 40, 16)
    expect(l.lines.join('')).not.toContain('…')
    expect(l.lines.join('').length).toBeGreaterThan(8)
    expect(wrapOverlayLines('one two three four', 10, 36).length).toBeGreaterThan(1)
  })

  it('grows the overlay box so the full translation fits', () => {
    const fitted = fitOverlayBox(
      { text: 'Hi', left: 4, top: 4, right: 24, bottom: 16 },
      '这是更长的一句译文应当完整显示',
      200,
      80
    )
    expect(fitted.text).toBe('这是更长的一句译文应当完整显示')
    expect(fitted.right - fitted.left).toBeGreaterThan(20)
  })

  it('scales overlay font from image pixels so pin zoom does not drop to a 9px floor', () => {
    const s = coverChipStyle(
      { text: '你好', left: 10, top: 10, right: 80, bottom: 34, fontSize: 21 },
      100,
      100,
      200,
      200
    )
    expect(s.fontSize).toBe('42px')
  })

  it('cover chips are percentage-positioned on the original box', () => {
    const s = coverChipStyle(
      { text: '你好', left: 10, top: 20, right: 60, bottom: 40 },
      100,
      100,
      200,
      200
    )
    expect(s.left).toBe('10%')
    expect(s.top).toBe('20%')
    expect(s.width).toBe('50%')
    expect(s.height).toBe('20%')
  })

  it('caps overlay height when a slot is tighter than the expanded box', () => {
    const out = readableOverlayLayout(
      { text: 'Hi', left: 10, top: 10, right: 90, bottom: 34 },
      '这是一段较长的译文',
      400,
      200,
      { maxHeight: 20 }
    )
    expect(out.bottom - out.top).toBeLessThanOrEqual(20)
  })

  it('does not let stacked in-place overlays overlap after layout', () => {
    const out = zipOverlay(
      [
        { text: 'Hello', left: 10, top: 10, right: 90, bottom: 30 },
        { text: 'World', left: 10, top: 34, right: 90, bottom: 54 }
      ],
      ['你好世界', '世界'],
      400,
      200
    )
    expect(out).toHaveLength(2)
    expect(out[0].bottom + 2).toBeLessThanOrEqual(out[1].top)
  })
})
