import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isTextInTargetLang } from './useLang'
import { translateLines, ocrTranslate } from './useOcrTranslate'

function installHost(stubs: {
  ocr?: any
  translate?: any
  providers?: any[]
}) {
  const storage = new Map<string, unknown>()
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).window.ztools = {
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

describe('isTextInTargetLang', () => {
  it('detects Chinese text correctly for zh-CN target', () => {
    expect(isTextInTargetLang('识别出来是目标语言', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('本来就是中文，点击翻译时', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('点击确定(OK)', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('打开 Chrome 浏览器', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('Hello World', 'zh-CN')).toBe(false)
    expect(isTextInTargetLang('Save and exit', 'zh-CN')).toBe(false)
  })

  it('detects Japanese containing Kana as NOT Chinese', () => {
    expect(isTextInTargetLang('こんにちは', 'zh-CN')).toBe(false)
    expect(isTextInTargetLang('日本語を勉強します', 'zh-CN')).toBe(false)
    expect(isTextInTargetLang('こんにちは', 'ja')).toBe(true)
    expect(isTextInTargetLang('日本語を勉強します', 'ja')).toBe(true)
  })

  it('detects Korean containing Hangul as NOT Chinese', () => {
    expect(isTextInTargetLang('안녕하세요', 'zh-CN')).toBe(false)
    expect(isTextInTargetLang('안녕하세요', 'ko')).toBe(true)
  })

  it('treats pure numbers and punctuation as already target lang without translating', () => {
    expect(isTextInTargetLang('123456', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('2026-09-30 11:20:00', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('---===...', 'zh-CN')).toBe(true)
  })

  it('treats explicitly matching fromLang and toLang as already matching', () => {
    expect(isTextInTargetLang('anything', 'zh-CN', 'zh-CN')).toBe(true)
    expect(isTextInTargetLang('anything', 'en', 'en')).toBe(true)
  })
})

describe('skip translating text that is already in target language', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT call translate when all blocks are Chinese and target is zh-CN', async () => {
    const translate = vi.fn()
    installHost({ translate })

    const result = await translateLines(['你好世界', '这是一段中文文本'], 'zh-CN')

    expect(translate).not.toHaveBeenCalled()
    expect(result.translateOk).toBe(true)
    expect(result.lines).toEqual([
      { text: '你好世界', translated: '你好世界' },
      { text: '这是一段中文文本', translated: '这是一段中文文本' }
    ])
    expect(result.diagnostics.some((d) => d.includes('skipped translate'))).toBe(true)
  })

  it('only translates non-target blocks in mixed language lines', async () => {
    const translate = vi.fn().mockResolvedValue({
      text: '世界你好',
      detectedFrom: 'en'
    })
    installHost({ translate })

    const result = await translateLines(
      ['已是中文第一行', 'Hello World', '已是中文第三行'],
      'zh-CN'
    )

    // Only 'Hello World' should be sent to translate, not the Chinese lines
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate).toHaveBeenCalledWith('Hello World', expect.objectContaining({ to: 'zh-CN' }))

    expect(result.translateOk).toBe(true)
    expect(result.lines).toEqual([
      { text: '已是中文第一行', translated: '已是中文第一行' },
      { text: 'Hello World', translated: '世界你好' },
      { text: '已是中文第三行', translated: '已是中文第三行' }
    ])
  })

  it('ocrTranslate skips translate when OCR recognizes Chinese text and target is zh-CN', async () => {
    const ocr = vi.fn().mockResolvedValue({
      text: '这是识别出的中文',
      blocks: ['这是识别出的中文']
    })
    const translate = vi.fn()
    installHost({ ocr, translate })

    const result = await ocrTranslate('img-data', 'zh-CN')

    expect(ocr).toHaveBeenCalled()
    expect(translate).not.toHaveBeenCalled()
    expect(result.translateOk).toBe(true)
    expect(result.lines[0].translated).toBe('这是识别出的中文')
  })
})
