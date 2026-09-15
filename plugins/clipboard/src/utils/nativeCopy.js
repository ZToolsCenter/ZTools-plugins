const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
])

export const hasNativeTextSelection = () => {
  const selection = globalThis.getSelection?.()
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed)
}

export const isTextEditingTarget = (target) => {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true

  const tagName = target.tagName?.toLowerCase()
  if (tagName === 'textarea' || tagName === 'select') return true
  if (tagName !== 'input') return false

  return !NON_TEXT_INPUT_TYPES.has(String(target.type || 'text').toLowerCase())
}

export const shouldUseNativeCopy = (event) =>
  isTextEditingTarget(event?.target) || hasNativeTextSelection()

export const clearNativeTextSelection = () => {
  const selection = globalThis.getSelection?.()
  if (selection && !selection.isCollapsed && typeof selection.removeAllRanges === 'function') {
    selection.removeAllRanges()
  }
}
