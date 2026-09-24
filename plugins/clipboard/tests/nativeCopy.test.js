import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearNativeTextSelection,
  hasNativeTextSelection,
  isTextEditingTarget,
  shouldUseNativeCopy
} from '../src/utils/nativeCopy.js'

const withSelection = (selection, callback) => {
  const previousGetSelection = globalThis.getSelection
  globalThis.getSelection = () => selection
  try {
    callback()
  } finally {
    if (previousGetSelection) {
      globalThis.getSelection = previousGetSelection
    } else {
      delete globalThis.getSelection
    }
  }
}

test('detects a non-collapsed browser selection', () => {
  withSelection({ rangeCount: 1, isCollapsed: false }, () => {
    assert.equal(hasNativeTextSelection(), true)
    assert.equal(shouldUseNativeCopy({ target: null }), true)
  })
})

test('ignores missing and collapsed browser selections', () => {
  withSelection({ rangeCount: 1, isCollapsed: true }, () => {
    assert.equal(hasNativeTextSelection(), false)
  })
  withSelection(null, () => {
    assert.equal(hasNativeTextSelection(), false)
  })
})

test('recognizes text-editable controls without treating checkboxes as text editors', () => {
  assert.equal(isTextEditingTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTextEditingTarget({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(isTextEditingTarget({ tagName: 'INPUT', type: 'checkbox' }), false)
  assert.equal(isTextEditingTarget({ tagName: 'DIV', isContentEditable: true }), true)
})

test('clears a browser text selection for an explicit record action', () => {
  let cleared = false
  withSelection({
    rangeCount: 1,
    isCollapsed: false,
    removeAllRanges: () => { cleared = true }
  }, () => {
    clearNativeTextSelection()
  })

  assert.equal(cleared, true)
})
