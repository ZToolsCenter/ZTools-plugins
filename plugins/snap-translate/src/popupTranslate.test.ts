/**
 * 契约测试：在贴图 OCR 之后的弹窗中点击翻译，必须是在小窗中展示翻译（弹小窗翻译），而不是覆盖贴图。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const resultView = readFileSync(path.join(dir, 'views/ResultView.vue'), 'utf8')
const snapHub = readFileSync(path.join(dir, 'views/SnapHub.vue'), 'utf8')
const services = readFileSync(
  path.join(dir, '../public/preload/services.js'),
  'utf8'
)

describe('popup translate instead of board overlay', () => {
  it('ResultView sends target: popup and fromResultWindow: true', () => {
    expect(resultView).toContain("action: 'translate'")
    expect(resultView).toContain("target: 'popup'")
    expect(resultView).toContain('fromResultWindow: true')
  })

  it('SnapHub identifies popup translate requests and sets forcePopup', () => {
    expect(snapHub).toMatch(
      /const forcePopup =\s*data\?\.target === 'popup' \|\| data\?\.fromResultWindow === true \|\| !data\?\.image/
    )
    expect(snapHub).toMatch(/presentTranslateResult\([\s\S]*?\{ forcePopup \}/)
  })

  it('presentTranslateResult respects options.forcePopup over overlay setting', () => {
    expect(snapHub).toMatch(
      /const mode = options\?\.forcePopup\s*\?\s*'popup'\s*:\s*\(loadBoardSettings\(\)\.translateResultMode \|\| 'popup'\)/
    )
  })

  it('services updates existing sideWin in place instead of closing and recreating', () => {
    expect(services).toContain('sideWin && !sideWin.isDestroyed?.()')
    expect(services).toContain('sideWin.setBounds')
    expect(services).toContain('injectSideResult')
    expect(services).toMatch(/window\.services\s*=\s*\{[\s\S]*?injectSideResult/)
  })
})
