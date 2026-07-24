import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput, StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { json } from '@codemirror/legacy-modes/mode/javascript'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { xml, html } from '@codemirror/legacy-modes/mode/xml'
import { cmTheme } from './cmTheme'
import { cmAutocomplete } from './cmCompletion'
import type { ScriptLanguage } from '../types/domain'

/**
 * Syntax highlighting is driven purely by the file extension, independent of a
 * script's execution language. Each entry builds a fresh CodeMirror language
 * extension. JavaScript and Python ship first-class Lezer grammars; the rest reuse
 * CodeMirror 5 stream parsers via StreamLanguage. Extensions absent from this table
 * render as plain text — no highlighting, and the user is never asked to pick one.
 */
const HIGHLIGHT_BY_EXTENSION: Record<string, () => Extension> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  py: () => python(),
  ps1: () => StreamLanguage.define(powerShell),
  sh: () => StreamLanguage.define(shell),
  json: () => StreamLanguage.define(json),
  json5: () => StreamLanguage.define(json),
  yaml: () => StreamLanguage.define(yaml),
  yml: () => StreamLanguage.define(yaml),
  xml: () => StreamLanguage.define(xml),
  html: () => StreamLanguage.define(html),
  htm: () => StreamLanguage.define(html)
}

/**
 * File extensions with curated completion tables. Only Scripty's executable
 * languages ship completions; read-only formats (json, yaml, xml, ...) get none.
 */
const COMPLETION_BY_EXTENSION: Record<string, ScriptLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  ps1: 'powershell',
  sh: 'shell'
}

/** Lowercased extension without the leading dot, or '' when the filename has none. */
function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLocaleLowerCase() : ''
}

/** Resolves the highlighting extension for a filename, or null when unrecognized. */
function highlightExtensionForFile(fileName: string): Extension | null {
  const build = HIGHLIGHT_BY_EXTENSION[fileExtension(fileName)]
  return build ? build() : null
}

/** Resolves the completion language for a filename, or null when none applies. */
function completionLanguageForFile(fileName: string): ScriptLanguage | null {
  return COMPLETION_BY_EXTENSION[fileExtension(fileName)] ?? null
}

export interface CreateEditorOptions {
  /** Initial document text. */
  doc: string
  /** Filename whose extension drives syntax highlighting + completion. */
  fileName: string
  /** Called with the latest document whenever the user edits it. */
  onChange: (doc: string) => void
  /** Called when the user presses the platform save shortcut (Ctrl/Cmd+S). */
  onSave: () => void
}

export interface CodeMirrorHandle {
  /** The underlying EditorView; null after destroy. */
  view: EditorView
  /** Reconfigures highlighting + completion from a new filename's extension. */
  setFileName: (fileName: string) => void
  /** Replaces the whole document. Does not move the scroll position. */
  setDoc: (doc: string) => void
  /** Tears down the editor and releases DOM listeners. */
  destroy: () => void
}

/**
 * Creates a CodeMirror 6 editor mounted into `parent`. The editor is fully owned
 * by the caller: it must call `destroy()` (typically in `onBeforeUnmount`).
 *
 * Document sync is one-way (CM -> caller via onChange); the caller mirrors it
 * back into its own ref so save/autosave logic is unaffected. `setDoc` is used
 * to push external content (e.g. loading an existing script) without producing
 * a feedback loop.
 */
export function createEditor(parent: HTMLElement, options: CreateEditorOptions): CodeMirrorHandle {
  const languageCompartment = new Compartment()
  const themeCompartment = new Compartment()

  const { doc, fileName, onChange, onSave } = options

  const saveKeymap = keymap.of([
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        onSave()
        return true
      }
    }
  ])

  const syncListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state.doc.toString())
  })

  // Highlighting is optional (unrecognized extension -> plain text); completion
  // is limited to the executable languages, so its source reads a nullable ref.
  let currentCompletionLanguage = completionLanguageForFile(fileName)
  const languageExts = (name: string): Extension[] => {
    const highlight = highlightExtensionForFile(name)
    return [
      ...(highlight ? [highlight] : []),
      cmAutocomplete(() => currentCompletionLanguage)
    ]
  }

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        saveKeymap,
        languageCompartment.of(languageExts(fileName)),
        themeCompartment.of(cmTheme()),
        syncListener,
        EditorView.lineWrapping
      ]
    }),
    parent
  })

  return {
    view,
    setFileName(next: string) {
      currentCompletionLanguage = completionLanguageForFile(next)
      view.dispatch({
        effects: languageCompartment.reconfigure(languageExts(next))
      })
    },
    setDoc(nextDoc: string) {
      if (nextDoc === view.state.doc.toString()) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextDoc }
      })
    },
    destroy() {
      view.destroy()
    }
  }
}
