/**
 * 管线单元测试：驱动真实 ocrTranslate，stub 宿主真实契约：
 *   ztools.translate(text, { from, to, providerId? })
 *   ztools.providers.getProviders('translation')
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ocrTranslate,
  ocrOnly,
  ocrWithBoxes,
  OcrUnavailableError,
  translateWithFallback
} from './useOcrTranslate'

type OcrFn = (image: string) => Promise<OcrProviderOutput>
type TranslateFn = (
  text: string,
  options?: { from?: string; to?: string; providerId?: string }
) => Promise<TranslateProviderOutput>

function installHost(stubs: {
  ocr?: OcrFn
  translate?: TranslateFn
  providers?: Array<{ id: string; type: string; key?: string; label?: string; isDefault?: boolean }>
  savedTargetLang?: string | null
}) {
  const storage = new Map<string, unknown>()
  if (stubs.savedTargetLang) {
    storage.set('snap-translate.targetLang', stubs.savedTargetLang)
  }
  ;(globalThis as any).window = globalThis
  ;(window as any).ztools = {
    ocr: stubs.ocr ?? vi.fn(),
    translate: stubs.translate ?? vi.fn(),
    providers: {
      getProviders: vi.fn(async (type?: string) => {
        const all = stubs.providers ?? []
        return type ? all.filter((p) => p.type === type) : all
      }),
      getDefaultProvider: vi.fn(async () => null),
      invokeProvider: vi.fn()
    },
    dbStorage: {
      getItem: (k: string) => storage.get(k),
      setItem: (k: string, v: unknown) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k)
    }
  }
}

const FP_CHANNELS = [
  {
    id: 'plugin:f-provider:google',
    type: 'translation',
    key: 'google',
    label: '谷歌翻译',
    isDefault: true
  },
  {
    id: 'plugin:f-provider:microsoft',
    type: 'translation',
    key: 'microsoft',
    label: '微软翻译',
    isDefault: false
  },
  {
    id: 'plugin:f-provider:baidu',
    type: 'translation',
    key: 'baidu',
    label: '百度翻译',
    isDefault: false
  }
]

describe('ocrTranslate pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('merges blocks when default translate succeeds', async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue({
      text: 'Hello\nWorld',
      blocks: ['Hello', 'World'],
      confidence: 0.9
    })
    const translate = vi.fn<TranslateFn>().mockResolvedValue({
      text: '你好\n世界',
      detectedFrom: 'en'
    })
    installHost({ ocr, translate, providers: FP_CHANNELS })

    const result = await ocrTranslate('data:image/png;base64,aaa', 'zh-CN')

    expect(result.translateOk).toBe(true)
    expect(result.lines).toEqual([
      { text: 'Hello', translated: '你好' },
      { text: 'World', translated: '世界' }
    ])
    expect(translate).toHaveBeenCalledWith('Hello\nWorld', { from: 'auto', to: 'zh-CN' })
  })

  it('falls back to microsoft via providerId when default 404s', async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue({
      text: 'hi',
      blocks: ['hi']
    })
    const translate = vi.fn<TranslateFn>(async (_text, opts) => {
      if (!opts?.providerId) {
        throw new Error('HTTP 404: DEPLOYMENT_NOT_FOUND')
      }
      if (opts.providerId === 'plugin:f-provider:microsoft') {
        return { text: '你好', detectedFrom: 'en' }
      }
      throw new Error('no ' + opts.providerId)
    })
    installHost({ ocr, translate, providers: FP_CHANNELS })

    const result = await ocrTranslate('img', 'zh-CN')

    expect(result.translateOk).toBe(true)
    expect(result.lines[0].translated).toBe('你好')
    expect(result.translateProvider).toBe('plugin:f-provider:microsoft')
    expect(translate).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ providerId: 'plugin:f-provider:microsoft' })
    )
  })

  it('keeps a single merged translate call when line counts mismatch', async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue({
      text: 'Hello\nWorld',
      blocks: ['Hello', 'World']
    })
    const translate = vi.fn<TranslateFn>().mockResolvedValue({
      text: '你好世界',
      detectedFrom: 'en'
    })
    installHost({ ocr, translate, providers: FP_CHANNELS })

    const result = await ocrTranslate('img', 'zh-CN')

    expect(translate).toHaveBeenCalledTimes(1)
    expect(result.translateOk).toBe(true)
    expect(result.lines[0].translated).toBe('你好世界')
    expect(result.lines[1].translated).toBe('')
    expect(result.diagnostics.some((d) => d.includes('merge align miss'))).toBe(true)
  })

  it('does not spam line-by-line when all channels fail once', async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue({
      text: 'a\nb\nc',
      blocks: ['a', 'b', 'c']
    })
    const translate = vi.fn<TranslateFn>().mockRejectedValue(new Error('HTTP 404'))
    installHost({ ocr, translate, providers: FP_CHANNELS })

    const result = await ocrTranslate('img', 'en')

    expect(result.translateOk).toBe(false)
    expect(result.lines.every((l) => l.translated === '')).toBe(true)
    // 默认 1 次 + 非默认渠道各 1 次（microsoft, baidu）≈ 少量，绝不是 3 行 × N
    expect(translate.mock.calls.length).toBeLessThan(10)
    expect(result.diagnostics.some((d) => d.includes('aborted'))).toBe(true)
  })

  it('throws OcrUnavailableError when OCR fails', async () => {
    installHost({
      ocr: vi.fn().mockRejectedValue(new Error('no default OCR provider')),
      translate: vi.fn()
    })
    await expect(ocrTranslate('img')).rejects.toBeInstanceOf(OcrUnavailableError)
  })

  it('ocrOnly skips translate', async () => {
    const translate = vi.fn()
    installHost({
      ocr: vi.fn().mockResolvedValue({ text: 'a\nb', blocks: ['a', 'b'] }),
      translate
    })
    const result = await ocrOnly('img')
    expect(result.lines).toEqual([
      { text: 'a', translated: '' },
      { text: 'b', translated: '' }
    ])
    expect(translate).not.toHaveBeenCalled()
  })

  it('translateWithFallback uses correct providerId shape', async () => {
    const translate = vi.fn<TranslateFn>(async (_t, opts) => {
      if (opts?.providerId === 'plugin:f-provider:microsoft') {
        return { text: 'ok' }
      }
      throw new Error('fail ' + (opts?.providerId || 'default'))
    })
    installHost({ translate, providers: FP_CHANNELS })
    const logs: string[] = []
    const out = await translateWithFallback('x', 'zh-CN', logs)
    expect(out.provider).toBe('plugin:f-provider:microsoft')
    expect(logs.some((l) => l.includes('plugin:f-provider:microsoft'))).toBe(true)
  })

  it('ocrWithBoxes prefers host default OCR over wechat/paddle', async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue({ text: 'host', blocks: ['host'] })
    installHost({
      ocr,
      providers: [{ id: 'plugin:snap-translate:ocr', type: 'ocr', key: 'ocr', isDefault: true }]
    })
    ;(window as any).services = {
      ocrImageDetail: vi.fn(async () => ({
        ok: true,
        lines: [{ text: 'Hi', rate: 0.9, left: 1, top: 2, right: 10, bottom: 12 }]
      })),
      paddleStatus: () => ({ ready: true }),
      paddleRecognize: vi.fn()
    }
    const result = await ocrWithBoxes('img')
    expect(result.lines[0].text).toBe('host')
    expect(result.boxes).toEqual([])
    expect(result.ocrProvider).toContain('ocr')
    expect(ocr).toHaveBeenCalled()
    expect((window as any).services.ocrImageDetail).not.toHaveBeenCalled()
  })

  it('ocrWithBoxes preferBoxes uses wechat boxes before host default', async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue({ text: 'host', blocks: ['host'] })
    installHost({ ocr })
    ;(window as any).services = {
      ocrImageDetail: vi.fn(async () => ({
        ok: true,
        lines: [{ text: 'Hi', rate: 0.9, left: 1, top: 2, right: 10, bottom: 12 }]
      }))
    }
    const result = await ocrWithBoxes('img', { preferBoxes: true })
    expect(result.ocrProvider).toBe('ocr')
    expect(result.boxes).toEqual([{ text: 'Hi', left: 1, top: 2, right: 10, bottom: 12 }])
    expect(ocr).not.toHaveBeenCalled()
  })

  it('ocrWithBoxes falls back to wechat detail with boxes when host default fails', async () => {
    const ocr = vi.fn<OcrFn>().mockRejectedValue(new Error('no default ocr'))
    installHost({ ocr, translate: vi.fn() })
    ;(window as any).services = {
      ocrImageDetail: vi.fn(async () => ({
        ok: true,
        lines: [{ text: 'Hi', rate: 0.9, left: 1, top: 2, right: 10, bottom: 12 }]
      }))
    }
    const result = await ocrWithBoxes('img')
    expect(result.boxes).toEqual([{ text: 'Hi', left: 1, top: 2, right: 10, bottom: 12 }])
    expect(result.ocrProvider).toBe('ocr')
    expect(ocr).toHaveBeenCalled()
  })

  it('ocrWithBoxes falls back to host default text path when no boxes providers', async () => {
    installHost({
      ocr: vi.fn<OcrFn>().mockResolvedValue({ text: 'a', blocks: ['a'] }),
      translate: vi.fn()
    })
    ;(window as any).services = {}
    const result = await ocrWithBoxes('img')
    expect(result.lines[0].text).toBe('a')
    expect(result.boxes).toEqual([])
  })
})
