import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { resolveEngineDownloadUrls, resumeDownloadHeaders, shouldResumePartial } from './engineDownload'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const requireCjs = createRequire(import.meta.url)
const cjs = requireCjs(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/preload/engineDownload.cjs')
)

const plugin = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/plugin.json'),
    'utf8'
  )
) as {
  native?: { win?: { downloadUrl?: string } }
  nativePaddle?: { win?: { downloadUrl?: string } }
}

describe('resolveEngineDownloadUrls', () => {
  it('prefixes github releases with credential-free mirrors then original', () => {
    const raw = 'https://github.com/kaineooo/f-provider/releases/download/v1.1.0/native-win.zip'
    const urls = resolveEngineDownloadUrls(raw)
    expect(urls[0]).toContain('native-win.zip')
    expect(urls[0]).not.toBe(raw)
    expect(urls[urls.length - 1]).toBe(raw)
    expect(urls.some((u) => u.startsWith('https://ghfast.top/'))).toBe(true)
  })

  it('leaves non-github URLs alone', () => {
    expect(resolveEngineDownloadUrls('https://example.com/a.zip')).toEqual([
      'https://example.com/a.zip'
    ])
  })

  it('CJS preload helper matches TS', () => {
    const raw = 'https://github.com/kaineooo/f-provider/releases/download/v1.1.0/native-win.zip'
    expect(cjs.resolveEngineDownloadUrls(raw)).toEqual(resolveEngineDownloadUrls(raw))
  })
})

describe('resumeDownloadHeaders', () => {
  it('omits Range on a fresh download', () => {
    expect(resumeDownloadHeaders(0).Range).toBeUndefined()
  })

  it('asks for bytes from the existing partial size', () => {
    expect(resumeDownloadHeaders(12345).Range).toBe('bytes=12345-')
    expect(cjs.resumeDownloadHeaders(12345)).toEqual(resumeDownloadHeaders(12345))
  })

  it('only treats HTTP 206 as a resume', () => {
    expect(shouldResumePartial(206, 100)).toBe(true)
    expect(shouldResumePartial(200, 100)).toBe(false)
  })
})

describe('plugin engine URLs', () => {
  it('declares wechat OCR and paddle downloads the plugin itself can fetch', () => {
    expect(plugin.native?.win?.downloadUrl).toMatch(/native-win\.zip$/)
    expect(plugin.nativePaddle?.win?.downloadUrl).toMatch(/PaddleOCR-json/i)
  })
})
