/**
 * 设置页必须能在主窗里滚动（右侧详情溢出时）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const vue = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'views/Settings.vue'),
  'utf8'
)
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.css'),
  'utf8'
)

describe('settings layout', () => {
  it('right detail pane scrolls; outer shell is a split flex row', () => {
    expect(vue).toMatch(/\.detail\s*\{[^}]*overflow-y:\s*auto/s)
    expect(vue).toMatch(/\.settings\s*\{[^}]*display:\s*flex/s)
  })

  it('#app is the scrollport fallback', () => {
    expect(css).toMatch(/#app\s*\{[^}]*overflow:\s*auto/s)
  })

  it('does not use the old 3-column card grid', () => {
    expect(vue).not.toMatch(/grid-template-columns:\s*repeat\(3,\s*1fr\)/)
  })

  it('keeps paddle and adds AI / image-host', () => {
    expect(vue).toContain('Paddle OCR')
    expect(vue).toContain("'ai-translation'")
    expect(vue).toContain("'ai-ocr'")
    expect(vue).toContain("'image-host'")
    expect(vue).toContain('getImageHostSettings')
    expect(vue).toContain('allAiModels')
  })

  it('forces readable ZSelect dropdown option colors', () => {
    expect(vue).toMatch(/:global\(\.select-menu\)[\s\S]*color:\s*#1f2329/)
    expect(vue).toMatch(/:global\(html\.dark \.select-menu\)[\s\S]*color:\s*#e8e8e8/)
  })

  it('toast is non-blocking so success/error feedback never covers menus', () => {
    expect(css).toMatch(/\.toast\s*\{[^}]*pointer-events:\s*none/s)
  })
})
