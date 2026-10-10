import { describe, expect, it } from 'vitest'
import { applyReplaceRules } from './replace'
import type { FileItem, ReplaceRule } from './session'

const file = (currentName: string): FileItem => ({
  id: currentName,
  sourcePath: currentName,
  directory: '',
  currentName,
  baseName: currentName,
  extension: ''
})

const rule = (partial: Partial<ReplaceRule> & Pick<ReplaceRule, 'mode'>): ReplaceRule => ({
  id: 'rule', find: '', replacement: '', start: 1, count: 1, includeExtension: false, ...partial
})

describe('applyReplaceRules', () => {
  it('replaces every match and allows empty replacement to delete text (TC-01, TC-02)', () => {
    expect(applyReplaceRules(file('abc_test.mp4'), [rule({ mode: 'text', find: 'abc', replacement: 'new' })])).toBe('new_test.mp4')
    expect(applyReplaceRules(file('abc_test.mp4'), [rule({ mode: 'text', find: 'abc_', replacement: '' })])).toBe('test.mp4')
  })

  it('applies rules in order (TC-03)', () => {
    expect(applyReplaceRules(file('AAA.txt'), [
      rule({ mode: 'text', find: 'A', replacement: 'B' }),
      rule({ mode: 'text', find: 'B', replacement: 'C' })
    ])).toBe('CCC.txt')
  })

  it('protects the extension by default and includes it when enabled (TC-04, TC-05)', () => {
    expect(applyReplaceRules(file('clip.mp4'), [rule({ mode: 'text', find: '4', replacement: '5' })])).toBe('clip.mp4')
    expect(applyReplaceRules(file('clip.mp4'), [rule({ mode: 'text', find: '4', replacement: '5', includeExtension: true })])).toBe('clip.mp5')
  })

  it('supports first, last, range and before/after delimiter ranges with one-based positions', () => {
    const apply = (mode: ReplaceRule['mode'], overrides: Partial<ReplaceRule> = {}) =>
      applyReplaceRules(file('abcdef.txt'), [rule({ mode, replacement: 'X', ...overrides })])
    expect(apply('first', { count: 2 })).toBe('Xcdef.txt')
    expect(apply('last', { count: 2 })).toBe('abcdX.txt')
    expect(apply('range', { start: 2, count: 3 })).toBe('aXef.txt')
    expect(apply('after', { find: 'c' })).toBe('abcX.txt')
    expect(apply('before', { find: 'c' })).toBe('Xcdef.txt')
    expect(apply('after-n', { find: 'c', count: 2 })).toBe('abcXf.txt')
    expect(apply('before-n', { find: 'd', count: 2 })).toBe('aXdef.txt')
  })

  it('leaves the name unchanged for empty or invalid rules', () => {
    expect(applyReplaceRules(file('name.txt'), [rule({ mode: 'text' })])).toBe('name.txt')
    expect(applyReplaceRules(file('name.txt'), [rule({ mode: 'range', start: 0, count: 2, replacement: 'X' })])).toBe('name.txt')
    expect(applyReplaceRules(file('name.txt'), [rule({ mode: 'after-n', find: 'n', count: 50, replacement: 'X' })])).toBe('name.txt')
    expect(applyReplaceRules(file('name.txt'), [rule({ mode: 'after', find: 'missing', replacement: 'X' })])).toBe('name.txt')
  })
})
