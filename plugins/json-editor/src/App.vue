<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { editor, IDisposable } from 'monaco-editor'
import stripJsonComments from 'strip-json-comments'
import EditorToolbar from './components/EditorToolbar.vue'
import { createInputEditor, createOutputEditor, setEditorTheme } from './monaco.ts'
import { formatInput } from './json/format.ts'
import { compactJson, escapeCompactJson, parseJson } from './json/parse.ts'
import { useJsonFilter } from './json/useJsonFilter.ts'
import { jsonToXml } from './json/xml.ts'

type Message = { id: number; text: string; kind: 'info' | 'error' }
type PluginAction = { code: string; type: string; payload: unknown }

const inputElement = ref<HTMLElement>()
const outputElement = ref<HTMLElement>()
const inputText = ref('')
const filter = ref('')
const active = ref(true)
const entered = ref(false)
const message = ref<Message>()
const filterResult = useJsonFilter(inputText, filter, active)

let inputEditor: editor.IStandaloneCodeEditor | undefined
let outputEditor: editor.IStandaloneCodeEditor | undefined
let inputSubscription: IDisposable | undefined
let theme: MediaQueryList | undefined
let messageTimeout: number | undefined
let messageId = 0
let copyId = 0

function hideMessage() {
  window.clearTimeout(messageTimeout)
  message.value = undefined
}

function showMessage(text: string, kind: Message['kind'] = 'info') {
  hideMessage()
  message.value = { id: ++messageId, text, kind }
  messageTimeout = window.setTimeout(hideMessage, 3000)
}

function replaceAndFormat(text: string) {
  if (!inputEditor) return
  inputEditor.setValue(formatInput(text))
  void inputEditor.getAction('editor.action.formatDocument')?.run()
}

function handlePaste(event: ClipboardEvent) {
  if (!inputEditor) return
  const text = event.clipboardData?.getData('text')
  if (!text) return

  const range = inputEditor.getModel()?.getFullModelRange()
  if (inputEditor.getValue() && (!range || !inputEditor.getSelection()?.equalsRange(range))) return

  event.stopPropagation()
  event.preventDefault()
  replaceAndFormat(text)
}

function handlePluginEnter({ code, type, payload }: PluginAction) {
  if (!inputEditor || code !== 'clean-cache') return
  active.value = true
  entered.value = true

  if (type === 'regex' && typeof payload === 'string') {
    filter.value = ''
    replaceAndFormat(payload)
  } else if (type === 'files' && Array.isArray(payload)) {
    const path: unknown = payload[0]?.path
    if (typeof path === 'string') {
      filter.value = ''
      replaceAndFormat(window.services?.readFileContent(path) ?? '')
    }
  }
  inputEditor.focus()
}

function handlePluginOut() {
  active.value = false
  copyId += 1
  hideMessage()
}

const copyActions = {
  compact: { render: compactJson, message: '已复制压缩 JSON' },
  escape: { render: escapeCompactJson, message: '已复制压缩转义 JSON' },
  xml: { render: (_: string, value: unknown) => jsonToXml(value), message: '已复制转换 XML' },
  typescript: {
    async render(_: string, value: unknown) {
      const { default: jsonToTs } = await import('json-to-ts')
      return jsonToTs(value).join('\n\n')
    },
    message: '已复制转换 TypeScript',
  },
}

type CopyAction = keyof typeof copyActions
type Action = CopyAction | 'format' | 'fold' | 'unfold' | 'strip'

async function copy(action: CopyAction, text: string) {
  const id = ++copyId
  if (!text.trim()) {
    showMessage('JSON 文本为空', 'error')
    return
  }
  let value: unknown
  try {
    value = parseJson(text)
  } catch {
    showMessage('错误的 JSON 格式', 'error')
    return
  }

  const operation = copyActions[action]
  let result: string
  try {
    const rendered = operation.render(text, value)
    result = typeof rendered === 'string' ? rendered : await rendered
  } catch (error) {
    if (id !== copyId) return
    showMessage(error instanceof Error ? error.message : '转换失败', 'error')
    return
  }

  if (id !== copyId) return
  try {
    if (window.ztools) {
      if (window.ztools.copyText(result) === false) throw new Error('Clipboard rejected the copy')
    } else {
      await navigator.clipboard.writeText(result)
    }
    if (id === copyId && active.value) showMessage(operation.message)
  } catch {
    if (id === copyId && active.value) showMessage('复制失败', 'error')
  }
}

function runAction(action: Action) {
  if (!inputEditor) return
  const text = inputEditor.getValue()
  switch (action) {
    case 'format':
      replaceAndFormat(text)
      return
    case 'strip':
      replaceAndFormat(stripJsonComments(text))
      return
    case 'fold':
      inputEditor.trigger('fold', 'editor.foldAll', null)
      return
    case 'unfold':
      inputEditor.trigger('unfold', 'editor.unfoldAll', null)
      return
    default:
      void copy(action, text)
  }
}

const altActions: Partial<Record<string, Action>> = {
  KeyF: 'format',
  KeyC: 'compact',
  Backslash: 'escape',
  Period: 'fold',
}

function handleShortcut(event: KeyboardEvent) {
  if (event.key === 'Escape' && message.value) hideMessage()
  if (event.code !== 'F1' && !event.altKey) return
  event.stopPropagation()
  event.preventDefault()
  if (event.code === 'F1') return

  const action = event.shiftKey && event.code === 'Period' ? 'unfold' : altActions[event.code]
  if (action) runAction(action)
}

function handleEditorEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.repeat) return
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const target = event.target
  if (!(target instanceof Node) ||
      (!inputElement.value?.contains(target) && !outputElement.value?.contains(target))) return

  const ztools = window.ztools
  if (ztools?.getWindowType() !== 'main') return
  event.preventDefault()
  ztools.outPlugin(false)
}

function syncTheme() {
  setEditorTheme(theme?.matches ?? false)
}

watch(filter, async (value) => {
  if (!value || !outputElement.value) return
  outputEditor ??= createOutputEditor(outputElement.value)
  outputEditor.setValue(filterResult.value)
  await nextTick()
  outputEditor?.layout()
}, { flush: 'post' })

watch(filterResult, (value) => outputEditor?.setValue(value))

onMounted(() => {
  if (!inputElement.value) return
  theme = window.matchMedia('(prefers-color-scheme: dark)')
  syncTheme()
  theme.addEventListener('change', syncTheme)
  inputEditor = createInputEditor(inputElement.value)
  inputSubscription = inputEditor.onDidChangeModelContent(() => {
    inputText.value = inputEditor?.getValue() ?? ''
    entered.value = true
  })
  inputElement.value.addEventListener('paste', handlePaste, true)
  window.addEventListener('keydown', handleShortcut, true)
  // Let Monaco handle Escape in its widgets before returning to the host search.
  window.addEventListener('keydown', handleEditorEscape)

  if (window.ztools) {
    window.ztools.onPluginEnter(handlePluginEnter)
    window.ztools.onPluginOut?.(handlePluginOut)
  } else {
    entered.value = true
    inputEditor.focus()
  }
})

onBeforeUnmount(() => {
  copyId += 1
  hideMessage()
  theme?.removeEventListener('change', syncTheme)
  window.removeEventListener('keydown', handleShortcut, true)
  window.removeEventListener('keydown', handleEditorEscape)
  inputElement.value?.removeEventListener('paste', handlePaste, true)
  inputSubscription?.dispose()
  inputEditor?.getModel()?.dispose()
  outputEditor?.getModel()?.dispose()
  inputEditor?.dispose()
  outputEditor?.dispose()
  inputEditor = undefined
  outputEditor = undefined
})
</script>

<template>
  <main class="editor-shell">
    <div class="content">
      <div id="inputEditor" ref="inputElement" :style="{ width: filter ? '50%' : '100%' }" />
      <div v-show="filter" id="outputEditor" ref="outputElement" />
    </div>
    <div v-if="entered && !inputText" class="placeholder">URL Params、XML、YAML 粘贴自动转为 JSON</div>
    <div class="footer">
      <div class="left">this</div>
      <div class="right">
        <input
          v-model="filter"
          type="text"
          aria-label="JS 过滤"
          placeholder=' JS 过滤; 示例 ".key.subkey"、"[0][1]"、".map(x=>x.val)"'
        />
      </div>
      <EditorToolbar @action="runAction" />
    </div>

    <Transition name="message">
      <div v-if="message" :key="message.id" class="notification" :class="message.kind" role="alert">
        <svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="message.kind === 'error'" d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
          <path v-else d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
        </svg>
        <span>{{ message.text }}</span>
        <button type="button" class="notification-close" aria-label="Close" title="Close" @click="hideMessage">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
    </Transition>
  </main>
</template>
