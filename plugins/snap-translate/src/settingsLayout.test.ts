import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const vue = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'views/Settings.vue'),
  'utf8'
)

describe('settings four-group nav', () => {
  it('groups OCR: wechat, paddle, ai-ocr', () => {
    expect(vue).toContain("key: 'wechat', label: '微信 OCR'")
    expect(vue).toContain("key: 'paddle', label: 'Paddle OCR'")
    expect(vue).toContain("key: 'ai-ocr', label: 'AI 识图'")
  })

  it('groups 翻译: microsoft, google, baidu, youdao, ai-translation', () => {
    for (const [key, label] of [
      ['microsoft', '微软翻译'],
      ['google', '谷歌翻译'],
      ['baidu', '百度翻译'],
      ['youdao', '有道翻译'],
      ['ai-translation', 'AI 翻译']
    ]) {
      expect(vue).toContain(`key: '${key}', label: '${label}'`)
    }
  })

  it('groups 附加: image-host only', () => {
    expect(vue).toContain("key: 'image-host', label: '图床'")
    expect(vue).toMatch(/附加/)
  })

  it('has no card grid', () => {
    expect(vue).not.toMatch(/grid-template-columns:\s*repeat\(3/)
  })

  it('keeps engine download/install-folder capabilities', () => {
    expect(vue).toContain('openEngineDir')
    expect(vue).toContain('engineCatalog')
    expect(vue).toContain('runEngineDownload')
    expect(vue).toContain('copyUrl')
  })
})
