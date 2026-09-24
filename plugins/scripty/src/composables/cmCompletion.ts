import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { collectCompletions, type CompletionItem } from './scriptCompletions'
import type { ScriptLanguage } from '../types/domain'

/**
 * Maps the project's CompletionItem.detail category to a CodeMirror completion
 * `type` so the autocomplete dropdown can render a matching icon next to each
 * entry (keyword/function/variable/class/...).
 */
function cmType(detail: string | undefined): string {
  switch (detail) {
    case 'keyword':
    case 'literal':
      return 'keyword'
    case 'builtin':
    case 'module':
      return 'namespace'
    case 'cmdlet':
    case 'command':
    case 'method':
      return 'function'
    case 'global':
    case 'variable':
    case 'local':
    case 'property':
      return 'variable'
    default:
      return 'text'
  }
}

/**
 * Builds a CodeMirror CompletionSource that reuses the project's curated
 * completion tables. The token boundary matches the original textarea editor's
 * `getCompletionContext` regex (word chars, $, - and .) so dotted/PowerShell
 * tokens still complete as one unit.
 *
 * `collectCompletions` narrows the initial candidate pool by prefix. CodeMirror's
 * filtering stays enabled so `validFor` can synchronously rescore and reorder
 * that full pool against every additional character the user types.
 */
function buildCompletionSource(getLanguage: () => ScriptLanguage | null) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$.-]+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const language = getLanguage()
    // Read-only formats (json, yaml, ...) have no completion tables.
    if (!language) return null
    const items = collectCompletions(ctx.state.doc.toString(), language, word.text)
    if (items.length === 0) return null
    const options = items.map((item: CompletionItem) => ({
      label: item.label,
      detail: item.detail,
      type: cmType(item.detail)
    }))
    return { from: word.from, to: word.to, options, validFor: /^[\w$.-]*$/ }
  }
}

/** Autocomplete extension wired to the project's language-aware completion tables. */
export const cmAutocomplete = (getLanguage: () => ScriptLanguage | null) =>
  autocompletion({
    override: [buildCompletionSource(getLanguage)],
    activateOnTyping: true,
    closeOnBlur: true,
    filterStrict: true,
    maxRenderedOptions: 24
  })
