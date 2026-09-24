/**
 * 结果框「复制原文 / 复制译文」必须实心底 + 实字色，避免透明 inherit 发糊。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const resultView = readFileSync(path.join(dir, 'views/ResultView.vue'), 'utf8')
const ocrResult = readFileSync(path.join(dir, 'views/OcrResult.vue'), 'utf8')

describe('result copy buttons contrast', () => {
  it.each([
    ['ResultView', resultView],
    ['OcrResult', ocrResult]
  ])('%s uses solid copy-solid buttons with explicit colors', (_name, vue) => {
    expect(vue).toContain('class="copy-solid"')
    expect(vue).toContain('复制原文')
    expect(vue).toContain('复制译文')
    const block = vue.match(/\.copy-solid\s*\{[^}]+\}/)
    expect(block).toBeTruthy()
    const s = block![0]
    expect(s).toMatch(/background:\s*#111827/)
    expect(s).toMatch(/color:\s*#ffffff/)
    expect(s).not.toMatch(/background:\s*transparent/)
    expect(s).not.toMatch(/color:\s*inherit/)
  })

  it('OCR popup can copy source and request translate', () => {
    expect(resultView).toContain('class="panes"')
    expect(resultView).toContain('requestTranslate')
    expect(resultView).toContain('>翻译</button>')
    expect(resultView).not.toContain('对照')
    expect(resultView).not.toContain('仅译文')
  })

  it('side popup shows engine names discreetly at the bottom', () => {
    expect(resultView).toContain('engine-hint')
    expect(resultView).toContain('prettyProviderName')
    expect(resultView).toMatch(/\.engine-hint\s*\{[^}]*font-size:\s*10px/s)
  })

  it('main-window OCR result shows engines and solid foot buttons', () => {
    expect(ocrResult).toContain('engine-hint')
    expect(ocrResult).toContain('prettyProviderName')
    expect(ocrResult).toContain('class="action-btn primary"')
    expect(ocrResult).toContain('再截一张')
    expect(ocrResult).not.toContain('ZButton')
  })

  it('OCR-only result can pick languages and translate', () => {
    expect(ocrResult).toContain('doTranslate')
    expect(ocrResult).toContain('LANG_OPTIONS')
    expect(ocrResult).toContain('源语言')
    expect(ocrResult).toContain('目标语言')
    expect(ocrResult).toContain('{{ translating ? \'翻译中…\' : \'翻译\' }}')
    expect(ocrResult).toMatch(/\.panes\s*\{[^}]*display:\s*flex/s)
  })
})
