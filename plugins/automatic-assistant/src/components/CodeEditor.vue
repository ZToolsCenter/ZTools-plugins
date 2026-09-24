<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps<{ modelValue: string; readonly?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const host = ref<HTMLElement>()
const tip = ref({ show: false, top: 0, left: 0 })
let view: EditorView | undefined
let tipTimer: number | undefined

// 只读状态下尝试输入，提示不可编辑（与原版 Monaco 行为一致）
function showReadonlyTip(event: KeyboardEvent) {
  // 忽略纯导航/修饰键
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape']
  if (nav.includes(event.key)) return
  const cursor = view?.dom.querySelector('.cm-cursor') as HTMLElement | null
  const hostRect = host.value!.getBoundingClientRect()
  if (cursor) {
    const r = cursor.getBoundingClientRect()
    tip.value = { show: true, top: r.bottom - hostRect.top + 6, left: Math.max(4, r.left - hostRect.left) }
  } else {
    tip.value = { show: true, top: 30, left: 20 }
  }
  if (tipTimer) window.clearTimeout(tipTimer)
  tipTimer = window.setTimeout(() => (tip.value.show = false), 2000)
}

onMounted(() => {
  const dark = document.documentElement.classList.contains('dark')
  view = new EditorView({
    doc: props.modelValue,
    parent: host.value!,
    extensions: [
      basicSetup,
      javascript(),
      ...(dark ? [oneDark] : []),
      ...(props.readonly ? [EditorState.readOnly.of(true)] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
      })
    ]
  })
  if (props.readonly) view.dom.addEventListener('keydown', showReadonlyTip)
})

watch(
  () => props.modelValue,
  (value) => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }
)

onBeforeUnmount(() => {
  if (tipTimer) window.clearTimeout(tipTimer)
  view?.destroy()
})
</script>

<template>
  <div ref="host" class="code-editor-host">
    <div v-if="tip.show" class="readonly-tip" :style="{ top: tip.top + 'px', left: tip.left + 'px' }">
      Cannot edit in read-only editor
    </div>
  </div>
</template>

<style scoped>
.code-editor-host {
  position: relative;
}

.readonly-tip {
  position: absolute;
  z-index: 20;
  background: #1e6fd9;
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 8px;
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.readonly-tip::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 10px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 5px solid #1e6fd9;
}
</style>
