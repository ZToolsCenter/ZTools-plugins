import { describe, expect, it } from 'vitest'
import { getSpaceShortcutAction } from './space-shortcuts'

describe('空间页快捷键', () => {
  it('搜索模式下按 E 编辑当前提示词，但在输入框中输入 E 不触发', () => {
    expect(getSpaceShortcutAction({ key: 'e', phase: 'search', targetTag: 'DIV' })).toBe('edit-active')
    expect(getSpaceShortcutAction({ key: 'e', phase: 'search', targetTag: 'INPUT' })).toBeNull()
  })

  it('填写多行变量时保留普通回车，使用 Ctrl+Enter 提交', () => {
    expect(getSpaceShortcutAction({ key: 'Enter', phase: 'fill', targetTag: 'TEXTAREA' })).toBeNull()
    expect(getSpaceShortcutAction({ key: 'Enter', phase: 'fill', targetTag: 'TEXTAREA', ctrlKey: true }))
      .toBe('submit-fill')
    expect(getSpaceShortcutAction({ key: 'Enter', phase: 'fill', targetTag: 'INPUT' })).toBe('submit-fill')
  })
})
