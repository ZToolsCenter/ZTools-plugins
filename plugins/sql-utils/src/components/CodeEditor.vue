<template>
  <div
    class="code-editor-box"
    :class="{ 'is-copied': isCopied }"
    :style="editorStyle"
    :data-theme="store.codeEditorThemeMode"
  >
    <div class="editor-header">
      <span class="editor-lang-badge">{{ langLabel }}</span>
      <div class="editor-actions" aria-label="编辑器操作">
        <button
          class="editor-action editor-action--ghost"
          type="button"
          title="清空内容"
          aria-label="清空内容"
          @click="clear"
        >
          <n-icon size="14"><Icon icon="icon-park-outline:delete" /></n-icon>
        </button>

        <button
          class="editor-action editor-action--primary"
          type="button"
          :title="isCopied ? '已复制' : '复制内容'"
          :aria-label="isCopied ? '已复制' : '复制内容'"
          @click="copyToClipboard"
        >
          <n-icon size="14">
            <Icon :icon="isCopied ? 'icon-park-outline:check-one' : 'icon-park-outline:copy'" />
          </n-icon>
        </button>
      </div>
    </div>

    <div class="editor-body">
      <codemirror
        ref="cmRef"
        class="code-editor"
        v-model="localValue"
        :style="{ height: '100%' }"
        :autofocus="autofocus"
        :indent-with-tab="true"
        :tab-size="2"
        :extensions="extensions"
        @change="handleInput"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import { java } from '@codemirror/lang-java'
import { vue as vueLang } from '@codemirror/lang-vue'
import { oneDark } from '@codemirror/theme-one-dark'
import { placeholder as editorPlaceholder } from '@codemirror/view'
import { Icon } from '@iconify/vue'
import { NIcon, useThemeVars } from 'naive-ui'
import { useAppStore } from '@/store'

const props = defineProps({
  modelValue: { type: String, default: '' },
  mode: { type: String, default: 'text' },
  autofocus: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'change'])

const store = useAppStore()
const themeVars = useThemeVars()

const localValue = ref(props.modelValue || '')
const cmRef = ref(null)
const isCopied = ref(false)
const copyTimeout = ref(null)

const editorStyle = computed(() => ({
  '--editor-primary': themeVars.value.primaryColor,
  '--editor-primary-hover': themeVars.value.primaryColorHover,
  '--editor-primary-pressed': themeVars.value.primaryColorPressed,
  '--editor-idle-border': store.isDarkTheme ? '#303946' : themeVars.value.borderColor,
  '--editor-focus-border': store.isDarkTheme ? '#70c0e8' : '#2080f0',
  '--editor-focus-shadow': store.isDarkTheme ? 'rgba(112, 192, 232, 0.18)' : 'rgba(32, 128, 240, 0.16)',
  '--editor-success': themeVars.value.successColor,
  '--editor-error': themeVars.value.errorColor,
  '--editor-border': themeVars.value.borderColor,
  '--editor-divider': themeVars.value.dividerColor,
  '--editor-card': themeVars.value.cardColor,
  '--editor-popover': themeVars.value.popoverColor,
  '--editor-body': themeVars.value.bodyColor,
  '--editor-text': themeVars.value.textColor2,
  '--editor-muted': themeVars.value.textColor3,
  '--editor-placeholder': themeVars.value.placeholderColor
}))

const langLabel = computed(() => {
  const map = {
    sql: 'SQL',
    javascript: 'JavaScript',
    'text/x-java': 'Java',
    java: 'Java',
    vue: 'Vue',
    handlebars: 'Handlebars',
    text: 'Plain Text'
  }
  return map[props.mode] || props.mode || 'Plain Text'
})

const langExtensions = computed(() => {
  switch (props.mode) {
    case 'sql': return [sql()]
    case 'javascript': return [javascript()]
    case 'text/x-java':
    case 'java': return [java()]
    case 'vue': return [vueLang()]
    case 'handlebars': return [javascript()]
    default: return []
  }
})

const extensions = computed(() => {
  const exts = [...langExtensions.value]
  if (props.placeholder) {
    exts.push(editorPlaceholder(props.placeholder))
  }
  if (store.codeEditorThemeMode === 'dracula' || store.isDarkTheme) {
    exts.push(oneDark)
  }
  return exts
})

watch(() => props.modelValue, (newVal) => {
  localValue.value = newVal || ''
})

function handleInput(value) {
  localValue.value = value
  emit('update:modelValue', value)
  emit('change', value)
}

function copyToClipboard() {
  if (!localValue.value) return
  navigator.clipboard.writeText(localValue.value).then(() => {
    isCopied.value = true
    focus()
    if (copyTimeout.value) clearTimeout(copyTimeout.value)
    copyTimeout.value = setTimeout(() => resetCopyState(), 1500)
  }).catch(err => {
    console.error('复制失败:', err)
  })
}

function resetCopyState() {
  if (copyTimeout.value) {
    clearTimeout(copyTimeout.value)
    copyTimeout.value = null
  }
  isCopied.value = false
}

function focus() {
  if (cmRef.value?.view) {
    cmRef.value.view.focus()
  }
}

function selectAll() {
  const view = cmRef.value?.view
  if (view) {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    view.focus()
  }
}

function clear() {
  localValue.value = ''
  emit('update:modelValue', '')
  emit('change', '')
  focus()
}

onBeforeUnmount(() => {
  if (copyTimeout.value) clearTimeout(copyTimeout.value)
})

defineExpose({ focus, selectAll, clear })
</script>

<style scoped>
.code-editor-box {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--editor-idle-border, var(--editor-border, rgba(31, 41, 55, 0.12)));
  border-radius: 8px;
  background: var(--editor-card, #fff);
  box-shadow: none;
  display: flex;
  flex-direction: column;
  transition: background 0.2s ease;
}

.editor-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 14px;
  height: 34px;
  border-bottom: 1px solid var(--editor-border, #d8dee8);
  background: var(--editor-body, #f5f5f5);
  border-radius: 7px 7px 0 0;
}

.editor-lang-badge {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--editor-muted, #64748b);
  user-select: none;
  line-height: 1;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.editor-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--editor-muted, #606266);
  background: transparent;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.editor-action:hover {
  transform: translateY(-1px);
}

.editor-action:focus-visible {
  outline: 2px solid var(--editor-primary, #18a058);
  outline-offset: 1px;
}

.editor-action--ghost:hover {
  color: var(--editor-error, #d03050);
  background: rgba(208, 48, 80, 0.1);
}

.editor-action--primary {
  color: var(--editor-muted, #606266);
  background: transparent;
}

.editor-action--primary:hover {
  color: var(--editor-primary, #2080f0);
  background: rgba(32, 128, 240, 0.08);
}

.is-copied .editor-action--primary {
  color: var(--editor-success, #18a058);
  background: rgba(24, 160, 88, 0.1);
}

.editor-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.code-editor {
  height: 100%;
}

:deep(.v-codemirror) {
  height: 100%;
}

:deep(.cm-editor) {
  height: 100%;
  font-size: 13px;
  background: transparent;
}

:deep(.cm-gutters) {
  border-right: 1px solid var(--editor-border, #d8dee8);
  background: var(--editor-body, #f5f5f5);
  color: var(--editor-placeholder, #999);
}

:deep(.cm-activeLine),
:deep(.cm-activeLineGutter) {
  background-color: rgba(0, 0, 0, 0.04);
}

:deep(.cm-editor.cm-focused),
:deep(.cm-focused) {
  outline: none !important;
}

:deep(.cm-scroller) {
  overflow: auto;
  font-family: "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  line-height: 1.52;
}

:deep(.cm-content) {
  padding: 10px 0 14px;
}

:deep(.cm-placeholder) {
  color: var(--editor-placeholder, #999);
  font-style: italic;
  opacity: 0.72;
}

:deep(.cm-line) {
  padding: 0 14px;
}

.code-editor-box[data-theme='dracula'],
body.dark .code-editor-box {
  border-color: var(--editor-idle-border, #303946);
  background: var(--editor-card, #18181c);
  box-shadow: none;
}

.code-editor-box[data-theme='dracula'] .editor-header,
body.dark .code-editor-box .editor-header {
  border-bottom-color: var(--editor-border, #303946);
  background: #13171d;
}

.code-editor-box[data-theme='dracula'] .editor-lang-badge,
body.dark .code-editor-box .editor-lang-badge {
  color: var(--editor-muted, #8b949e);
}

.code-editor-box[data-theme='dracula'] .editor-action,
body.dark .code-editor-box .editor-action {
  color: var(--editor-muted, #8b949e);
}

.code-editor-box[data-theme='dracula'] .editor-action--ghost:hover,
body.dark .code-editor-box .editor-action--ghost:hover {
  color: var(--editor-error, #e88080);
  background: rgba(232, 128, 128, 0.14);
}

.code-editor-box[data-theme='dracula'] .editor-action--primary:hover,
body.dark .code-editor-box .editor-action--primary:hover {
  color: var(--editor-primary, #70c0e8);
  background: rgba(112, 192, 232, 0.1);
}

.code-editor-box[data-theme='dracula'].is-copied .editor-action--primary,
body.dark .code-editor-box.is-copied .editor-action--primary {
  color: var(--editor-success, #63e2b7);
  background: rgba(99, 226, 183, 0.12);
}

.code-editor-box[data-theme='dracula'] :deep(.cm-gutters),
body.dark .code-editor-box :deep(.cm-gutters) {
  border-right-color: var(--editor-border, #303946);
  background: #111820;
  color: var(--editor-placeholder, #8d9095);
}

.code-editor-box[data-theme='dracula'] :deep(.cm-activeLine),
.code-editor-box[data-theme='dracula'] :deep(.cm-activeLineGutter),
body.dark .code-editor-box :deep(.cm-activeLine),
body.dark .code-editor-box :deep(.cm-activeLineGutter) {
  background-color: rgba(255, 255, 255, 0.05);
}
</style>
