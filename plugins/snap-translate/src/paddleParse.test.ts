import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parsePaddleOutput } from './paddleParse'

const requireCjs = createRequire(import.meta.url)
const cjs = requireCjs(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/preload/paddleParse.cjs')
)

describe('parsePaddleOutput', () => {
  it('reads PaddleOCR-json data[] with text+score', () => {
    const out = parsePaddleOutput(
      JSON.stringify({
        code: 100,
        data: [
          { text: 'Hello', score: 0.9 },
          { text: 'World', score: 0.8 }
        ]
      })
    )
    expect(out.blocks).toEqual(['Hello', 'World'])
    expect(out.text).toBe('Hello\nWorld')
    expect(out.confidence).toBeCloseTo(0.85, 5)
    expect(out.boxes).toEqual([])
  })

  it('keeps detection boxes for in-place overlay', () => {
    const out = parsePaddleOutput(
      JSON.stringify({
        code: 100,
        data: [
          {
            text: 'Hello',
            score: 0.9,
            box: [
              [10, 20],
              [80, 20],
              [80, 40],
              [10, 40]
            ]
          }
        ]
      })
    )
    expect(out.boxes).toEqual([{ text: 'Hello', left: 10, top: 20, right: 80, bottom: 40 }])
  })

  it('CJS preload helper matches TS', () => {
    const raw = JSON.stringify({ code: 100, data: [{ text: 'a', score: 1 }] })
    expect(cjs.parsePaddleOutput(raw)).toEqual(parsePaddleOutput(raw))
  })

  it('throws on empty stdout', () => {
    expect(() => parsePaddleOutput('')).toThrow(/无输出/)
  })
})
