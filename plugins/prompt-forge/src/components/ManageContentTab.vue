<script setup lang="ts">
import { ref, computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  editTitle: string
  editBody: string
}>()

const emit = defineEmits<{
  (e: 'update:editTitle', v: string): void
  (e: 'update:editBody', v: string): void
}>()

// 正文视图模式：edit 编辑 / preview 预览
const bodyMode = ref<'edit' | 'preview'>('edit')
const markdownHtml = computed(() => renderMarkdown(props.editBody))
</script>

<template>
  <div class="field"><label>标题</label><input :value="editTitle" @input="emit('update:editTitle', ($event.target as HTMLInputElement).value)" /></div>
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
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }
.field input, .field textarea { width: 100%; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); padding: 10px 14px; font-size: 13.5px; }
.field input:focus, .field textarea:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 3px var(--pf-accent-soft); }
.body-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.body-label-row label { margin-bottom: 0; }
.body-editor { min-height: 250px; max-height: 50vh; resize: vertical; font-family: var(--pf-font-mono); line-height: 1.6; }
.body-preview {
  min-height: 250px; max-height: 50vh; overflow-y: auto;
  border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm);
  background: var(--pf-surface); padding: 14px 16px;
  font-size: 13.5px;
}
</style>
