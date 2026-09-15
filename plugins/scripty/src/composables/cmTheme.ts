import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Editor chrome theme. Every color is bound to a host CSS variable so the
 * editor follows the application's light/dark scheme without a hardcoded palette.
 * `dark: false` because Scripty's default UI is light; the CSS variables carry
 * the real scheme and will switch automatically if theming is added later.
 */
const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text-color)',
    backgroundColor: 'var(--input-bg)',
    height: '100%',
    fontSize: '13px'
  },
  '.cm-scroller': {
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: '1.6'
  },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--text-color)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-color)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--primary-color) 22%, transparent)'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--text-secondary)',
    border: 'none',
    borderRight: '1px solid var(--divider-color)'
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--hover-bg) 60%, transparent)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--hover-bg) 60%, transparent)',
    color: 'var(--text-color)'
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--primary-color) 30%, transparent)',
    outline: 'none'
  },
  '.cm-tooltip, .cm-tooltipAutocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--dialog-bg, var(--input-bg))',
    border: '1px solid var(--border-color)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'color-mix(in srgb, var(--primary-color) 18%, transparent)',
    color: 'var(--text-color)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--primary-color) 30%, transparent)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--primary-color) 55%, transparent)'
  }
}, { dark: false })

/**
 * Syntax highlight colors. Uses semantic secondaries derived via color-mix so the
 * palette stays readable on both light and dark backgrounds without hardcoding.
 */
const highlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.meta], color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'color-mix(in srgb, var(--primary-color) 75%, var(--text-color))', fontWeight: '600' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'color-mix(in srgb, var(--primary-color) 60%, var(--text-color))' },
  { tag: t.number, color: 'color-mix(in srgb, #098658 70%, var(--text-color))' },
  { tag: t.string, color: 'color-mix(in srgb, #4271a8 80%, var(--text-color))' },
  { tag: [t.regexp, t.escape], color: 'color-mix(in srgb, #8a6a3f 80%, var(--text-color))' },
  { tag: [t.variableName, t.local(t.variableName)], color: 'var(--text-color)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'color-mix(in srgb, var(--primary-color) 85%, var(--text-color))' },
  { tag: [t.typeName, t.className, t.definition(t.typeName)], color: 'color-mix(in srgb, #8a5a2f 80%, var(--text-color))' },
  { tag: [t.propertyName, t.operator, t.punctuation, t.separator], color: 'var(--text-secondary)' },
  { tag: t.definition(t.propertyName), color: 'var(--text-color)' },
  { tag: [t.tagName, t.attributeName], color: 'color-mix(in srgb, #8a5a2f 80%, var(--text-color))' }
])

/** Bundled editor theme + syntax highlight extension. */
export const cmTheme = () => [editorTheme, syntaxHighlighting(highlightStyle)]
