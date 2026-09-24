import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** 内联重命名/新建：Enter 提交且阻止冒泡，避免全局「打开书签」误触 */
export function handleInlineRenameEnter(
  e: ReactKeyboardEvent,
  commit: () => void,
): void {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
  e.preventDefault()
  e.stopPropagation()
  commit()
}

/** blur 与 Enter 同帧时先让 keydown 完成，再提交（避免卸载 input 后 Enter 冒泡到 window） */
export function deferInlineRenameCommit(commit: () => void): void {
  queueMicrotask(commit)
}

/** 全局 keydown：是否应跳过「Enter 打开书签」等列表快捷键（顶栏搜索框除外） */
export function shouldDeferListEnterShortcut(
  e: KeyboardEvent,
  headerSearch?: HTMLInputElement | null,
): boolean {
  const t = e.target
  if (!(t instanceof HTMLElement)) return false
  if (headerSearch && t === headerSearch) return false
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return true
  return !!t.closest(
    '.nav-item-editing, .grp-label-editing, .group-tab-rename, .gm-item-editing, .cat-ms-chip-input',
  )
}