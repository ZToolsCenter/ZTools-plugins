/**
 * 驱动 shipped copy/save bytes + OCR 结果 payload 构造。
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  dataUrlToBytes,
  dataUrlExt,
  buildOcrResultPayload
} from './pinGeometry'

/** 1×1 PNG（真实 PNG 头，非空） */
const TINY_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('copy/save image bytes', () => {
  it('dataUrlToBytes returns non-empty PNG payload', () => {
    const bytes = dataUrlToBytes(TINY_PNG)
    expect(bytes.byteLength).toBeGreaterThan(20)
    // PNG magic
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(dataUrlExt(TINY_PNG)).toBe('png')
  })

  it('writes those bytes to a file (save path)', () => {
    const dest = path.join(tmpdir(), 'snap-pin-save-' + Date.now() + '.png')
    const bytes = dataUrlToBytes(TINY_PNG)
    writeFileSync(dest, bytes)
    const onDisk = readFileSync(dest)
    expect(onDisk.length).toBe(bytes.byteLength)
    expect(onDisk[0]).toBe(137)
    unlinkSync(dest)
  })
})

describe('buildOcrResultPayload', () => {
  it('includes line-level text', () => {
    const p = buildOcrResultPayload({
      image: TINY_PNG,
      lines: [{ text: 'hello' }, { text: 'world' }]
    })
    expect(p.image).toBe(TINY_PNG)
    expect(p.lines.map((l) => l.text)).toEqual(['hello', 'world'])
    expect(p.lines.every((l) => l.translated === '')).toBe(true)
    expect(p.translateOk).toBe(false)
  })

  it('includes translated when translate succeeds', () => {
    const p = buildOcrResultPayload({
      image: TINY_PNG,
      lines: [
        { text: 'hello', translated: '你好' },
        { text: 'world', translated: '世界' }
      ],
      translateOk: true,
      targetLang: 'zh-CN'
    })
    expect(p.translateOk).toBe(true)
    expect(p.lines.map((l) => l.translated)).toEqual(['你好', '世界'])
    expect(p.targetLang).toBe('zh-CN')
  })
})
