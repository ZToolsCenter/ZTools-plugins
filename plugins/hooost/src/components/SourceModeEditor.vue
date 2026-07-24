<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type aceBuilds from 'ace-builds'

const modelValue = defineModel<string>({ required: true })

const props = withDefaults(
  defineProps<{
    readonly?: boolean
  }>(),
  {
    readonly: false,
  }
)

const editorRef = ref<HTMLDivElement | null>(null)
const isDark = computed(() => document.documentElement.classList.contains('dark'))

let editor: aceBuilds.Ace.Editor | null = null
let isInternalChange = false

async function createEditor(): Promise<void> {
  if (!editorRef.value) return

  const { default: ace } = await import('ace-builds/src-noconflict/ace')
  await import('ace-builds/src-noconflict/mode-sh')
  await import('ace-builds/src-noconflict/theme-github')
  await import('ace-builds/src-noconflict/theme-one_dark')
  await import('ace-builds/src-noconflict/ext-language_tools')

  if (!editorRef.value || editor) return

  editor = ace.edit(editorRef.value, {
    mode: 'ace/mode/sh',
    theme: isDark.value ? 'ace/theme/one_dark' : 'ace/theme/github',
    value: modelValue.value,
    readOnly: props.readonly,
    fontSize: 12,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    showPrintMargin: false,
    wrap: true,
    tabSize: 2,
    useSoftTabs: true,
    highlightActiveLine: true,
    showGutter: true,
    enableBasicAutocompletion: true,
  })

  editor.on('change', () => {
    if (!editor || isInternalChange) return

    isInternalChange = true
    modelValue.value = editor.getValue()
    isInternalChange = false
  })
}

onMounted(() => {
  void createEditor()
})

watch(modelValue, (value) => {
  if (!editor || isInternalChange) return

  isInternalChange = true
  const cursor = editor.getCursorPosition()
  editor.setValue(value ?? '', -1)
  editor.moveCursorToPosition(cursor)
  isInternalChange = false
})

watch(isDark, (dark) => {
  editor?.setTheme(dark ? 'ace/theme/one_dark' : 'ace/theme/github')
})

watch(
  () => props.readonly,
  (readonly) => {
    editor?.setReadOnly(readonly)
  }
)

onBeforeUnmount(() => {
  editor?.destroy()
  editor = null
})
</script>

<template>
  <div ref="editorRef" class="source-editor"></div>
</template>

<style scoped>
.source-editor {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  overflow: hidden;
}
</style>
