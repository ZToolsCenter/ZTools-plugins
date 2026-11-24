import { editor } from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/editor/edcore.main.js'
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js'

// Inline workers can start from the packaged file:// page.
window.MonacoEnvironment = {
  async getWorker(_moduleId, label) {
    const { default: WorkerConstructor } = label === 'json'
      ? await import('monaco-editor/esm/vs/language/json/json.worker.js?worker&inline')
      : await import('monaco-editor/esm/vs/editor/editor.worker.js?worker&inline')
    return new WorkerConstructor()
  },
}

const options: editor.IStandaloneEditorConstructionOptions = {
  language: 'json',
  automaticLayout: true,
  minimap: { enabled: false },
  contextmenu: false,
  scrollBeyondLastLine: false,
  links: false,
}

export function setEditorTheme(dark: boolean) {
  editor.setTheme(dark ? 'vs-dark' : 'vs')
}

export function createInputEditor(element: HTMLElement) {
  return editor.create(element, {
    ...options,
    formatOnPaste: true,
    formatOnType: true,
    showFoldingControls: 'always',
  })
}

export function createOutputEditor(element: HTMLElement) {
  return editor.create(element, {
    ...options,
    hover: { enabled: false },
    readOnly: true,
    lineNumbers: 'off',
    wordWrap: 'on',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    occurrencesHighlight: false,
    renderLineHighlight: 'none',
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  })
}
