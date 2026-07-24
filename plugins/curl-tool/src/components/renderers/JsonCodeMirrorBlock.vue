<script setup lang="ts">
import { computed } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { foldedRanges, unfoldEffect } from '@codemirror/language'
import { basicSetup } from 'codemirror'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  lineNumbers
} from '@codemirror/view'

const props = defineProps<{
  content: string
  editable?: boolean
  language?: 'json' | 'xml'
  query?: string
  activeIndex?: number
}>()

const emit = defineEmits<{
  'update:content': [value: string]
}>()

const extensions = computed(() => [
  basicSetup,
  lineNumbers(),
  props.language === 'xml' ? xml() : json(),
  EditorView.lineWrapping,
  EditorView.editable.of(props.editable !== false),
  queryHighlight(props.query || '', props.activeIndex || 0),
  EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: '#fff',
      color: '#0f172a',
      fontSize: '12px'
    },
    '.cm-scroller': {
      fontFamily: 'Consolas, SFMono-Regular, monospace',
      lineHeight: '1.6',
      overflow: 'auto'
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: '#0f172a'
    },
    '.cm-line': {
      padding: '0 12px 0 6px'
    },
    '.cm-gutters': {
      backgroundColor: '#fff',
      color: '#94a3b8',
      borderRight: '1px solid #eef2f7'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: '#dbeafe'
    },
    '.cm-search-hit': {
      backgroundColor: '#fde68a',
      borderRadius: '3px'
    },
    '.cm-search-hit-active': {
      backgroundColor: '#f59e0b',
      color: '#111827'
    }
  })
])

function queryHighlight(query: string, activeIndex: number) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private revealTimer = 0

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, query, activeIndex)
        this.scheduleReveal(view)
      }

      update(update: any) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, query, activeIndex)
          this.scheduleReveal(update.view)
        }
      }

      destroy() {
        window.clearTimeout(this.revealTimer)
      }

      private scheduleReveal(view: EditorView) {
        window.clearTimeout(this.revealTimer)
        this.revealTimer = window.setTimeout(() => revealActiveMatch(view, query, activeIndex), 0)
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  )
}

function revealActiveMatch(view: EditorView, query: string, activeIndex: number) {
  const match = findMatch(view.state.doc.toString(), query, activeIndex)
  if (!match) return

  const effects: any[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    if (match.from >= from && match.from <= to) {
      effects.push(unfoldEffect.of({ from, to }))
    }
  })

  view.dispatch({
    effects,
    selection: { anchor: match.from, head: match.to },
    scrollIntoView: true
  })
}

function findMatch(text: string, query: string, activeIndex: number) {
  if (!query) return undefined
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let from = lowerText.indexOf(lowerQuery)
  let index = 0
  while (from !== -1) {
    const to = from + query.length
    if (index === activeIndex) return { from, to }
    index += 1
    from = lowerText.indexOf(lowerQuery, to)
  }
  return undefined
}

function buildDecorations(view: EditorView, query: string, activeIndex: number) {
  if (!query) return Decoration.none
  const ranges = []
  const text = view.state.doc.toString()
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let from = lowerText.indexOf(lowerQuery)
  let index = 0
  while (from !== -1) {
    const to = from + query.length
    ranges.push(
      Decoration.mark({
        class: index === activeIndex ? 'cm-search-hit cm-search-hit-active' : 'cm-search-hit'
      }).range(from, to)
    )
    index += 1
    from = lowerText.indexOf(lowerQuery, to)
  }
  return Decoration.set(ranges)
}
</script>

<template>
  <div class="json-codemirror">
    <Codemirror
      :model-value="content"
      :extensions="extensions"
      :indent-with-tab="true"
      :tab-size="2"
      @update:model-value="emit('update:content', $event)"
    />
  </div>
</template>

<style scoped>
.json-codemirror {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.json-codemirror :deep(.cm-editor) {
  height: 100%;
}
</style>
