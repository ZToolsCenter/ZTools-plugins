<script setup lang="ts">
import { ref, computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  editTitle: string
  editBody: string
  editDescription: string
}>()

const emit = defineEmits<{
  (e: 'update:editTitle', v: string): void
  (e: 'update:editBody', v: string): void
  (e: 'update:editDescription', v: string): void
}>()

// 正文视图模式：edit 编辑 / preview 预览
const bodyMode = ref<'edit' | 'preview'>('edit')
const markdownHtml = computed(() => renderMarkdown(props.editBody))
</script>

<template>
  <div class="field"><label>标题</label><input :value="editTitle" @input="emit('update:editTitle', ($event.target as HTMLInputElement).value)" /></div>
  <div class="field">
    <div class="body-label-row">
      <label>描述</label>
      <span class="field-hint">仅自己可见 · 记录用途或使用场景</span>
    </div>
    <textarea
      :value="editDescription"
      class="desc-editor"
      placeholder="例如：给后端做接口评审时用，重点让 AI 关注错误码与幂等"
      @input="emit('update:editDescription', ($event.target as HTMLTextAreaElement).value)"
    />
  </div>
  <div class="field">
    <div class="body-label-row">
      <label>正文</label>
      <div class="mode-toggle">
        <button :class="['mode-btn', { active: bodyMode === 'edit' }]" @click="bodyMode = 'edit'">编辑</button>
        <button :class="['mode-btn', { active: bodyMode === 'preview' }]" @click="bodyMode = 'preview'">预览</button>
      </div>
    </div>
    <textarea
      v-if="bodyMode === 'edit'"
      :value="editBody"
      class="body-editor"
      @input="emit('update:editBody', ($event.target as HTMLTextAreaElement).value)"
    />
    <div v-else class="body-preview markdown-body" v-html="markdownHtml"></div>
  </div>
</template>

<style scoped>
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); margin-bottom: 5px; }
.field input, .field textarea { width: 100%; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); padding: 9px 12px; font-size: 13.5px; }
.field input:focus, .field textarea:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 3px var(--pf-accent-soft); }
.body-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.body-label-row label { margin-bottom: 0; }
.field-hint { font-size: 11px; font-weight: 400; color: var(--pf-text-faint); }
.desc-editor { min-height: 52px; max-height: 120px; resize: vertical; line-height: 1.5; }
.body-editor { min-height: 240px; max-height: 55vh; resize: vertical; font-family: var(--pf-font); line-height: 1.65; }
.body-preview {
  min-height: 250px; max-height: 50vh; overflow-y: auto;
  border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm);
  background: var(--pf-surface); padding: 14px 16px;
  font-size: 13.5px;
}
</style>
