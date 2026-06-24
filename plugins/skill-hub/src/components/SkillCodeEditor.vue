<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view'
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput, HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { autocompletion, closeBrackets, completionKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'

const props = defineProps<{
  modelValue: string
  language?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLDivElement>()
const view = shallowRef<EditorView>()
const editableCompartment = new Compartment()
const languageCompartment = new Compartment()
const parentSyncAnnotation = Annotation.define<boolean>()

const themeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--cm-keyword, #7c3aed)' },
  { tag: [tags.name, tags.variableName, tags.propertyName], color: 'var(--cm-variable, #1d4ed8)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--cm-function, #0f766e)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string, #15803d)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--cm-atom, #b45309)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--cm-comment, #64748b)', fontStyle: 'italic' },
  { tag: tags.heading, color: 'var(--cm-heading, #334155)', fontWeight: '700' },
  { tag: [tags.link, tags.url], color: 'var(--cm-link, #2563eb)', textDecoration: 'underline' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--cm-invalid, #dc2626)' },
  { tag: tags.inserted, color: 'var(--cm-inserted, #16a34a)' },
])

const cmTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
    fontSize: '13px',
    overflow: 'hidden',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    height: '100%',
    lineHeight: '1.625',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '12px 0',
  },
  '.cm-line': {
    padding: '0 20px',
  },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--muted) / 0.16)',
    color: 'hsl(var(--muted-foreground))',
    borderRight: '1px solid hsl(var(--border))',
  },
  '.cm-activeLine': {
    backgroundColor: 'hsl(var(--primary) / 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'hsl(var(--primary) / 0.08)',
    color: 'hsl(var(--foreground))',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'hsl(var(--primary) / 0.2) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'hsl(var(--foreground))',
  },
})

function getLanguageExtension(lang?: string): any {
  switch (lang) {
    case 'markdown':
      return import('@codemirror/lang-markdown').then(m => m.markdown())
    case 'javascript':
      return import('@codemirror/lang-javascript').then(m => m.javascript())
    case 'json':
      return import('@codemirror/lang-json').then(m => m.json())
    case 'yaml':
      return import('@codemirror/lang-yaml').then(m => m.yaml())
    case 'python':
      return import('@codemirror/lang-python').then(m => m.python())
    case 'html':
      return import('@codemirror/lang-html').then(m => m.html())
    case 'css':
      return import('@codemirror/lang-css').then(m => m.css())
    default:
      return Promise.resolve([])
  }
}

function buildExtensions(readonly: boolean) {
  return [
    lineNumbers(),
    foldGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    syntaxHighlighting(themeHighlightStyle),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    cmTheme,
    EditorView.lineWrapping,
    languageCompartment.of([]),
    editableCompartment.of([
      EditorView.editable.of(!readonly),
      EditorState.readOnly.of(readonly),
    ]),
    EditorView.contentAttributes.of({
      'aria-label': readonly ? 'Code viewer' : 'Code editor',
      role: 'textbox',
      spellcheck: 'false',
    }),
    EditorView.updateListener.of((update) => {
      const isParentSync = update.transactions.some(t => t.annotation(parentSyncAnnotation))
      if (update.docChanged && !isParentSync) {
        emit('update:modelValue', update.state.doc.toString())
      }
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ]
}

async function loadLanguage(lang?: string) {
  if (!view.value) return
  const ext = await getLanguageExtension(lang)
  view.value.dispatch({
    effects: languageCompartment.reconfigure(ext),
  })
}

onMounted(() => {
  if (!editorRef.value) return
  const v = new EditorView({
    parent: editorRef.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: buildExtensions(!!props.readonly),
    }),
  })
  view.value = v
  loadLanguage(props.language)
})

onUnmounted(() => {
  view.value?.destroy()
  view.value = undefined
})

watch(() => props.language, (lang) => {
  loadLanguage(lang)
})

watch(() => props.readonly, (ro) => {
  view.value?.dispatch({
    effects: editableCompartment.reconfigure([
      EditorView.editable.of(!ro),
      EditorState.readOnly.of(ro),
    ]),
  })
})

watch(() => props.modelValue, (val) => {
  const v = view.value
  if (!v) return
  const current = v.state.doc.toString()
  if (current === val) return
  v.dispatch({
    changes: { from: 0, to: current.length, insert: val },
    annotations: parentSyncAnnotation.of(true),
  })
})
</script>

<template>
  <div ref="editorRef" class="skill-code-editor" />
</template>

<style scoped>
.skill-code-editor {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
