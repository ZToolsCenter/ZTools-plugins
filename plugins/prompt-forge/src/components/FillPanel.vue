<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PromptItem } from '../types'
import { renderVariables } from '../utils/index'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  unit: PromptItem | null
  values: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'update:values', values: Record<string, string>): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const variables = computed(() => props.unit?.variables || [])
const missingCount = computed(() =>
  variables.value.filter(v => v.required && !props.values[v.name]?.trim()).length
)
const preview = computed(() => {
  if (!props.unit?.content) return ''
  return renderVariables(props.unit.content, props.values)
})

// 预览视图模式：text 纯文本 / markdown 渲染
const previewMode = ref<'text' | 'markdown'>('text')
const markdownHtml = computed(() => renderMarkdown(preview.value))

function updateValue(name: string, value: string) {
  emit('update:values', { ...props.values, [name]: value })
}
</script>

<template>
  <div class="fill-wrap">
    <div class="fill-body" :class="{ 'single': variables.length === 0 }">
      <!-- 左：变量表单（无变量时隐藏，将全部空间用于展示内容） -->
      <div v-if="variables.length > 0" class="fill-form">
        <div class="form-header">
          <span class="form-title">填写变量</span>
          <span class="form-count">
            {{ variables.length - missingCount }}/{{ variables.length }}
          </span>
        </div>
        <div class="form-scroll">
          <div class="var-form">
            <div v-for="v in variables" :key="v.name" class="field">
              <label>
                {{ v.name }}
                <span v-if="v.required" class="req">*</span>
                <span class="hint">{{ v.required ? '必填' : '可选' }}</span>
              </label>
              <input
                :value="values[v.name]"
                type="text"
                :placeholder="v.defaultValue ? `默认: ${v.defaultValue}` : '请输入…'"
                @input="updateValue(v.name, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 右：正文预览 -->
      <div class="fill-preview">
        <div class="preview-header">
          <span class="preview-title">{{ unit?.title || '提示词预览' }}</span>
          <span class="preview-meta">
            <span v-if="unit?.tags?.length" class="tag" v-for="t in (unit?.tags || []).slice(0,3)" :key="t">#{{ t }}</span>
          </span>
          <div class="mode-toggle">
            <button :class="['mode-btn', { active: previewMode === 'text' }]" @click="previewMode = 'text'">文本</button>
            <button :class="['mode-btn', { active: previewMode === 'markdown' }]" @click="previewMode = 'markdown'">Markdown</button>
          </div>
        </div>
        <div v-if="previewMode === 'text'" class="preview-body">{{ preview }}</div>
        <div v-else class="preview-body markdown-body" v-html="markdownHtml"></div>
      </div>
    </div>
    <!-- 底栏：固定在底部 -->
    <div class="form-actions">
      <button class="btn" @click="emit('cancel')"><kbd>Esc</kbd> 返回</button>
      <span class="spacer"></span>
      <button class="btn primary" @click="emit('submit')">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
        复制
      </button>
    </div>
  </div>
</template>

<style scoped>
.fill-wrap {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.fill-body {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 2fr;
  overflow: hidden;
}
/* 无变量：隐藏表单，预览单列占满全部空间 */
.fill-body.single {
  grid-template-columns: 1fr;
}

/* 左侧表单 */
.fill-form {
  display: flex; flex-direction: column;
  min-height: 0; overflow: hidden;
  border-right: 1px solid var(--pf-border);
  background: var(--pf-bg);
}
.form-header {
  padding: 14px 20px 10px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--pf-border);
}
.form-title {
  font-size: 14px; font-weight: 600; color: var(--pf-text);
}
.form-count {
  font-size: 12px; font-weight: 600;
  color: var(--pf-accent);
  font-family: var(--pf-font-mono);
  background: var(--pf-accent-soft);
  padding: 2px 8px; border-radius: var(--pf-radius-xs);
}
.form-scroll {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px 20px;
}
.var-form {
  display: flex; flex-direction: column; gap: 14px;
}
.field { display: flex; flex-direction: column; gap: 6px; }
.field label {
  font-size: 12px; font-weight: 600;
  color: var(--pf-text-secondary);
  display: flex; align-items: center; gap: 6px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.req { color: var(--pf-danger); }
.hint {
  margin-left: auto;
  font-size: 10px; font-weight: 500;
  color: var(--pf-text-faint);
  text-transform: none; letter-spacing: 0;
  padding: 1px 6px;
  background: var(--pf-surface-raised);
  border-radius: var(--pf-radius-xs);
}
.field input {
  height: 42px; padding: 0 14px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-sm);
  font-size: 14px; color: var(--pf-text);
  transition: all 0.15s ease;
}
.field input:focus {
  border-color: var(--pf-accent);
  box-shadow: 0 0 0 3px var(--pf-accent-soft);
}
.field input::placeholder { color: var(--pf-text-faint); }
.form-actions {
  height: 52px; min-height: 52px;
  padding: 12px 20px;
  display: flex; align-items: center; gap: 10px;
  border-top: 1px solid var(--pf-border);
  background: var(--pf-bg-elevated);
  flex-shrink: 0;
}
.spacer { flex: 1; }

/* 右侧预览 */
.fill-preview {
  display: flex; flex-direction: column;
  min-height: 0; overflow: hidden;
  background: var(--pf-bg-elevated);
}
.preview-header {
  flex-shrink: 0;
  padding: 14px 20px 10px;
  display: flex; align-items: center; gap: 12px;
  border-bottom: 1px solid var(--pf-border);
}
.preview-title {
  font-size: 14px; font-weight: 600; color: var(--pf-text);
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.preview-meta { display: flex; gap: 4px; flex-shrink: 0; }
.tag {
  font-size: 10px; font-weight: 500;
  padding: 2px 7px; border-radius: var(--pf-radius-pill);
  background: var(--pf-surface-raised);
  color: var(--pf-text-muted);
}
.preview-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px 20px;
  font-size: 13.5px; line-height: 1.7;
  color: var(--pf-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--pf-font-mono);
}

/* Markdown 模式下覆盖 .preview-body 的等宽字体与 pre-wrap（全局 .markdown-body 样式见 main.css） */
.preview-body.markdown-body {
  font-family: inherit;
  white-space: normal;
  line-height: 1.7;
}
</style>
