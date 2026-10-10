import { describe, expect, it } from 'vitest'
import { applyNumberRule, formatSequence } from './number'
import type { FileItem, NumberRule, SequenceStyle } from './session'

function file(extension = '.txt'): FileItem {
  return {
    id: 'id', sourcePath: `C:\\files\\name${extension}`, directory: 'C:\\files',
    currentName: `name${extension}`, baseName: 'name', extension
  }
}

describe('formatSequence', () => {
  it.each([
    ['arabic', 3, '003'],
    ['chinese-lower', 12, '十二'],
    ['chinese-upper', 12, '壹拾贰'],
    ['alpha-lower', 27, 'aa'],
    ['alpha-upper', 27, 'AA']
  ] as [SequenceStyle, number, string][])('formats %s sequences', (style, value, expected) => {
    expect(formatSequence(value, style, 3)).toBe(expected)
  })

  it('applies padding only to Arabic numbers', () => {
    expect(formatSequence(1, 'arabic', 4)).toBe('0001')
    expect(formatSequence(1, 'alpha-lower', 4)).toBe('a')
  })
})

describe('applyNumberRule', () => {
  it('combines prefix, sequence, suffix, and original extension', () => {
    const rule: NumberRule = { prefix: '测试', start: 1, style: 'arabic', digits: 3, suffix: '成片' }
    expect(applyNumberRule(file('.mp4'), 0, rule)).toBe('测试001成片.mp4')
    expect(applyNumberRule(file('.mp4'), 1, rule)).toBe('测试002成片.mp4')
  })
})
