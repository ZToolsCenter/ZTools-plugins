import { describe, expect, it } from 'vitest'
import { applyManualPaste, getManualTargetName } from './manual'
import type { FileItem } from './session'

const file = (id: string, currentName = `${id}.txt`): FileItem => ({
  id, sourcePath: currentName, directory: '', currentName, baseName: currentName, extension: ''
})

describe('manual naming', () => {
  it('reads edits by stable file ID and falls back to the current name (TC-17)', () => {
    const first = file('first')
    expect(getManualTargetName(first, { first: 'renamed.txt' })).toBe('renamed.txt')
    expect(getManualTargetName(first, {})).toBe('first.txt')
    expect(getManualTargetName(first, { first: '' })).toBe('')
  })

  it('pastes clipboard rows by current sorted order and normalizes Windows newlines (TC-18)', () => {
    const files = [file('b'), file('a')]
    expect(applyManualPaste(files, {}, '乙\r\n甲')).toEqual({
      names: { b: '乙', a: '甲' }, ignoredCount: 0
    })
    expect(applyManualPaste([file('a'), file('b'), file('c')], {}, '甲\r\n乙\r\n')).toEqual({
      names: { a: '甲', b: '乙' }, ignoredCount: 0
    })
  })

  it('keeps existing values after the pasted rows and preserves blank row positions (TC-19, TC-21)', () => {
    const files = [file('a'), file('b'), file('c')]
    expect(applyManualPaste(files, { a: 'old-a', b: 'old-b', c: 'old-c' }, '新甲\n\n新丙')).toEqual({
      names: { a: '新甲', b: '', c: '新丙' }, ignoredCount: 0
    })
    expect(applyManualPaste(files, { a: 'old-a', b: 'old-b', c: 'old-c' }, '新甲')).toEqual({
      names: { a: '新甲', b: 'old-b', c: 'old-c' }, ignoredCount: 0
    })
  })

  it('ignores rows beyond the file count and reports how many were ignored (TC-20)', () => {
    const files = [file('a'), file('b')]
    expect(applyManualPaste(files, {}, '甲\n乙\n丙\n丁')).toEqual({
      names: { a: '甲', b: '乙' }, ignoredCount: 2
    })
  })
})
