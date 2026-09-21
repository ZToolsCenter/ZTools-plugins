import type * as Monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import {
  formatRestScript,
  parseRestScript,
  type RestScriptMarker,
} from './restScript'
import { validateRestScriptWithSchema } from './restScriptSchema'
import {
  inferJsonKeyContext,
  isSearchPath,
  schemaPropertyHints,
} from './searchSchemaValidate'
import { shouldSuggestMappingFields } from './restFieldHints'

export const ES_REST_LANG = 'es-rest'

let languageRegistered = false
let completionRegistered = false
let formatProviderRegistered = false

/** Mapping fields for the indices referenced in the current script. */
let mappingFields: { path: string; type: string }[] = []
/** Cluster index names for path completion. */
let indexNames: string[] = []

export function setRestMappingFields(fields: { path: string; type: string }[]): void {
  mappingFields = fields
}

export function setRestIndexNames(names: string[]): void {
  indexNames = names.filter(Boolean).sort()
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'] as const
const COMMON_PATHS = [
  '/_cluster/health',
  '/_cat/indices?format=json',
  '/_cat/nodes?format=json',
  '/_nodes',
  '/_search',
  '/_mapping',
  '/my-index/_search',
  '/my-index/_doc',
  '/my-index/_mapping',
]

export function setupMonacoEnvironment(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (g.MonacoEnvironment) return

  g.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') return new JsonWorker()
      return new EditorWorker()
    },
  }
}

export function registerEsRestLanguage(monaco: typeof Monaco): void {
  if (languageRegistered) return
  languageRegistered = true

  monaco.languages.register({ id: ES_REST_LANG })
  monaco.languages.setMonarchTokensProvider(ES_REST_LANG, {
    defaultToken: '',
    tokenizer: {
      root: [
        [/^\s*(GET|POST|PUT|DELETE|HEAD)\b/i, 'keyword'],
        [/^\s*(GET|POST|PUT|DELETE|HEAD)\s+(\S+)/i, ['keyword', 'string']],
        { include: 'json' },
      ],
      json: [
        [/".*?"/, 'string'],
        [/[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/, 'number'],
        [/\b(true|false|null)\b/, 'keyword'],
        [/[{}\[\],:]/, 'delimiter'],
        [/\/\/.*$/, 'comment'],
      ],
    },
  })

  monaco.languages.setLanguageConfiguration(ES_REST_LANG, {
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /[{[]\s*$/,
      decreaseIndentPattern: /^\s*[}\]]/,
    },
  })
}

export function registerEsRestCompletion(monaco: typeof Monaco): void {
  if (completionRegistered) return
  completionRegistered = true

  monaco.languages.registerCompletionItemProvider(ES_REST_LANG, {
    triggerCharacters: ['"', '/', ' ', '{', ','],
    provideCompletionItems(model, position) {
      const text = model.getValue()
      const offset = model.getOffsetAt(position)
      const line = model.getLineContent(position.lineNumber)
      const lineUntil = line.slice(0, position.column - 1)
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const suggestions: Monaco.languages.CompletionItem[] = []

      // Method at line start
      if (/^\s*[A-Za-z]*$/.test(lineUntil)) {
        for (const m of METHODS) {
          suggestions.push({
            label: m,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: m + ' ',
            range,
            detail: 'HTTP method',
          })
        }
      }

      // Path after METHOD
      const methodPath = lineUntil.match(/^\s*(GET|POST|PUT|DELETE|HEAD)\s+(\S*)$/i)
      if (methodPath) {
        const prefix = methodPath[2]
        const pathRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - prefix.length,
          endColumn: position.column,
        }
        const pushPath = (p: string, detail: string) => {
          if (prefix && !p.startsWith(prefix) && !p.includes(prefix.replace(/^\//, ''))) return
          suggestions.push({
            label: p,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: p,
            range: pathRange,
            detail,
          })
        }
        for (const p of COMMON_PATHS) pushPath(p, 'ES path')
        // Live index names from cluster
        const suffixes = ['_search', '_mapping', '_settings', '_doc', '_count']
        for (const name of indexNames) {
          pushPath(`/${name}`, 'index')
          for (const suf of suffixes) {
            pushPath(`/${name}/${suf}`, `index · ${suf}`)
          }
        }
      }

      // JSON property hints inside request body (especially _search)
      const reqs = parseRestScript(text)
      const req = reqs.find((r) => offset >= r.startOffset && offset <= r.endOffset)
      if (req && req.bodyText.trim()) {
        const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const bodyAbsStart = normalized.indexOf(req.bodyText, req.startOffset)
        const offInBody =
          bodyAbsStart >= 0 ? offset - bodyAbsStart : Math.max(0, offset - req.startOffset)

        if (offInBody >= 0 && offInBody <= req.bodyText.length) {
          let ctx = inferJsonKeyContext(req.bodyText, offInBody)
          // Also offer properties right after { or , before typing quote
          const before = req.bodyText.slice(0, offInBody)
          const bareKeyPos = /([{,]\s*)$/.test(before)
          if (!ctx.typingKey && bareKeyPos) {
            ctx = { ...ctx, typingKey: true, prefix: '' }
          }

          if (ctx.typingKey) {
            const hints = schemaPropertyHints(ctx.path)
            const uniq = [...new Set(hints)]
            for (const key of uniq) {
              if (ctx.prefix && !key.startsWith(ctx.prefix)) continue
              const needsQuotes = bareKeyPos && !ctx.prefix
              suggestions.push({
                label: key,
                kind: monaco.languages.CompletionItemKind.Property,
                insertText: needsQuotes ? `"${key}": ` : key,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: position.column - ctx.prefix.length,
                  endColumn: position.column,
                },
                detail: isSearchPath(req.path) ? '_search property' : 'JSON property',
                documentation: `Schema: ${[...ctx.path, key].join('.') || key}`,
              })
            }

            // Mapping field names (match/term/range/... object keys)
            if (shouldSuggestMappingFields(ctx.path) && mappingFields.length) {
              for (const f of mappingFields) {
                if (ctx.prefix && !f.path.startsWith(ctx.prefix) && !f.path.includes(ctx.prefix)) {
                  continue
                }
                const needsQuotes = bareKeyPos && !ctx.prefix
                suggestions.push({
                  label: f.path,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: needsQuotes ? `"${f.path}": ` : f.path,
                  range: {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: position.column - ctx.prefix.length,
                    endColumn: position.column,
                  },
                  detail: `field · ${f.type}`,
                  documentation: `Mapping field (${f.type})`,
                })
              }
            }
          }

          // Suggest fields when typing the value of "field": "
          const beforeVal = req.bodyText.slice(0, offInBody)
          const fieldValue = beforeVal.match(/"field"\s*:\s*"([^"]*)$/)
          if (fieldValue && mappingFields.length) {
            const pref = fieldValue[1]
            for (const f of mappingFields) {
              if (pref && !f.path.startsWith(pref)) continue
              suggestions.push({
                label: f.path,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: f.path,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: position.column - pref.length,
                  endColumn: position.column,
                },
                detail: `field · ${f.type}`,
              })
            }
          }
        }
      }

      // Also suggest mapping fields when typing string value inside fields arrays: "fields": ["
      const lineFieldArr = lineUntil.match(/"fields"\s*:\s*\[\s*(?:"[^"]*"\s*,\s*)*"([^"]*)$/)
      if (lineFieldArr && mappingFields.length) {
        const pref = lineFieldArr[1]
        for (const f of mappingFields) {
          if (pref && !f.path.startsWith(pref)) continue
          suggestions.push({
            label: f.path,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: f.path,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column - pref.length,
              endColumn: position.column,
            },
            detail: `field · ${f.type}`,
          })
        }
      }

      return { suggestions }
    },
  })
}

export function markersToMonaco(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  markers: RestScriptMarker[],
): Monaco.editor.IMarkerData[] {
  return markers
    .filter((m) => m.end > m.start)
    .map((m) => {
      const start = model.getPositionAt(Math.max(0, m.start))
      const end = model.getPositionAt(Math.min(model.getValueLength(), m.end))
      return {
        severity:
          m.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: m.message,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      }
    })
}

export function applyFormatDocument(
  editor: Monaco.editor.IStandaloneCodeEditor,
): { skipped: number } {
  const model = editor.getModel()
  if (!model) return { skipped: 0 }
  const { text, skipped } = formatRestScript(model.getValue())
  const full = model.getFullModelRange()
  editor.executeEdits('format-rest', [{ range: full, text }])
  return { skipped }
}

export function themeFromDom(): 'vs-dark' | 'vs' {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'light' ? 'vs' : 'vs-dark'
}

export type RestEditorHandle = {
  editor: Monaco.editor.IStandaloneCodeEditor
  dispose: () => void
  setValue: (v: string) => void
  getValue: () => string
  layout: () => void
  refreshMarkers: () => void
  format: () => { skipped: number }
  onScroll: (cb: () => void) => Monaco.IDisposable
  getTopForLine: (line0: number) => number
  getScrollTop: () => number
}

export async function createRestEditor(
  container: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
): Promise<RestEditorHandle> {
  setupMonacoEnvironment()
  const monaco = await import('monaco-editor')
  registerEsRestLanguage(monaco)
  registerEsRestCompletion(monaco)

  const editor = monaco.editor.create(container, {
    value: initialValue,
    language: ES_REST_LANG,
    theme: themeFromDom(),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineHeight: 18,
    tabSize: 2,
    insertSpaces: true,
    autoIndent: 'full',
    wordWrap: 'off',
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    folding: true,
    find: {
      seedSearchStringFromSelection: 'selection' as const,
      autoFindInSelection: 'never' as const,
    },
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: true },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    padding: { top: 4 },
  })

  const model = editor.getModel()!

  const refreshMarkers = () => {
    const { markers } = validateRestScriptWithSchema(model.getValue())
    monaco.editor.setModelMarkers(model, 'es-rest', markersToMonaco(monaco, model, markers))
  }

  let changeTimer: ReturnType<typeof setTimeout> | null = null
  const sub = editor.onDidChangeModelContent(() => {
    onChange(model.getValue())
    if (changeTimer) clearTimeout(changeTimer)
    changeTimer = setTimeout(refreshMarkers, 200)
  })

  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
    applyFormatDocument(editor)
    refreshMarkers()
  })

  // Format Document action
  if (!formatProviderRegistered) {
    formatProviderRegistered = true
    monaco.languages.registerDocumentFormattingEditProvider(ES_REST_LANG, {
      provideDocumentFormattingEdits(m) {
        const { text } = formatRestScript(m.getValue())
        return [
          {
            range: m.getFullModelRange(),
            text,
          },
        ]
      },
    })
  }
  refreshMarkers()

  // Observe theme attribute
  const mo = new MutationObserver(() => {
    monaco.editor.setTheme(themeFromDom())
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  return {
    editor,
    dispose: () => {
      if (changeTimer) clearTimeout(changeTimer)
      sub.dispose()
      mo.disconnect()
      editor.dispose()
    },
    setValue: (v) => {
      if (model.getValue() !== v) model.setValue(v)
    },
    getValue: () => model.getValue(),
    layout: () => editor.layout(),
    refreshMarkers,
    format: () => {
      const r = applyFormatDocument(editor)
      refreshMarkers()
      return r
    },
    onScroll: (cb) => editor.onDidScrollChange(() => cb()),
    getTopForLine: (line0) => editor.getTopForLineNumber(line0 + 1),
    getScrollTop: () => editor.getScrollTop(),
  }
}
