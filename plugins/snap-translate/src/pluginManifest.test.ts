/**
 * 插件入口契约：主搜索默认应进截图翻译，而不是设置。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const plugin = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/plugin.json'),
    'utf8'
  )
) as {
  features: { code: string; cmds: Array<string | object> }[]
  providers: Record<string, { type: string }>
  native?: { win?: { downloadUrl?: string }; mac?: { downloadUrl?: string } }
  nativePaddle?: { win?: { downloadUrl?: string } }
}

describe('plugin default enter', () => {
  it('lists snap-translate before settings so 贴图 is the start command', () => {
    const codes = plugin.features.map((f) => f.code)
    expect(codes.indexOf('snap-translate')).toBeGreaterThanOrEqual(0)
    expect(codes.indexOf('settings')).toBeGreaterThan(codes.indexOf('snap-translate'))
    expect(codes[0]).toBe('snap-translate')
  })

  it('binds 贴图 to snap-translate, not settings', () => {
    const snap = plugin.features.find((f) => f.code === 'snap-translate')
    const settings = plugin.features.find((f) => f.code === 'settings')
    const snapCmds = (snap?.cmds || []).filter((c) => typeof c === 'string') as string[]
    const setCmds = (settings?.cmds || []).filter((c) => typeof c === 'string') as string[]
    expect(snapCmds[0]).toBe('贴图')
    expect(snapCmds).toContain('贴图')
    expect(setCmds).not.toContain('贴图')
  })

  it('exposes three screenshot commands: 贴图 / OCR / OCR翻译', () => {
    const codes = plugin.features.map((f) => f.code)
    expect(codes.slice(0, 3)).toEqual(['snap-translate', 'snap-ocr-only', 'snap-ocr-translate'])
    expect(codes).not.toContain('snap-ocr')
    expect(codes).not.toContain('snap-board')
    const pin = plugin.features.find((f) => f.code === 'snap-translate')
    const only = plugin.features.find((f) => f.code === 'snap-ocr-only')
    const tr = plugin.features.find((f) => f.code === 'snap-ocr-translate')
    const pinCmds = (pin?.cmds || []).filter((c) => typeof c === 'string') as string[]
    const onlyCmds = (only?.cmds || []).filter((c) => typeof c === 'string') as string[]
    const trCmds = (tr?.cmds || []).filter((c) => typeof c === 'string') as string[]
    expect(pinCmds[0]).toBe('贴图')
    expect(onlyCmds[0]).toBe('OCR')
    expect(onlyCmds).not.toContain('只OCR')
    expect(trCmds[0]).toBe('OCR翻译')
  })

  it('declares f-provider 1.1.0 AI providers plus paddle', () => {
    const keys = Object.keys(plugin.providers)
    expect(keys).toEqual(
      expect.arrayContaining([
        'ocr',
        'paddle',
        'baidu',
        'google',
        'youdao',
        'microsoft',
        'ai-translation',
        'ai-ocr'
      ])
    )
    expect(plugin.providers['ai-translation'].type).toBe('translation')
    expect(plugin.providers['ai-ocr'].type).toBe('ocr')
  })

  it('ships native + paddle GitHub zip URLs', () => {
    expect(plugin.native?.win?.downloadUrl).toMatch(/native-win\.zip$/)
    expect(plugin.native?.mac?.downloadUrl).toMatch(/native-mac\.zip$/)
    expect(plugin.nativePaddle?.win?.downloadUrl).toMatch(/PaddleOCR-json/)
  })
})
