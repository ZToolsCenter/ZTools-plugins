<script setup lang="ts">
import { computed } from 'vue'
import type { Environment } from '@/types/hosts'
import { renderLinesToSource } from '../lib/hosts'
import SourceModeEditor from './SourceModeEditor.vue'

const props = defineProps<{
  environment: Environment
  isActive: boolean
  hasPendingChanges: boolean
  publicReadonlyContent?: string
}>()

const emit = defineEmits<{
  sourceChange: [envId: string, content: string]
  updateName: [envId: string, name: string]
  saveDraft: [envId: string]
  cancelDraft: [envId: string]
}>()

const editorContent = computed(() =>
  props.environment.type === 'public'
    ? (props.publicReadonlyContent ?? '')
    : renderLinesToSource(props.environment.lines)
)

function onSourceChange(content: string) {
  emit('sourceChange', props.environment.id, content)
}
</script>

<template>
  <div class="env-editor">
    <div class="editor-header">
      <input
        v-if="environment.type === 'custom'"
        class="editor-name"
        :value="environment.name"
        placeholder="配置名称"
        @change="(e) => emit('updateName', environment.id, (e.target as HTMLInputElement).value)"
      />
      <span v-else class="editor-name editor-name--readonly">{{ environment.name }}</span>
      <span v-if="isActive" class="active-tag">已启用</span>
      <span v-if="hasPendingChanges" class="draft-tag">未保存</span>
    </div>

    <SourceModeEditor
      :model-value="editorContent"
      :readonly="environment.type === 'public'"
      @update:model-value="onSourceChange"
    />

    <div v-if="environment.type !== 'public'" class="editor-footer">
      <button
        class="btn"
        type="button"
        :disabled="!hasPendingChanges"
        @click="emit('cancelDraft', environment.id)"
      >
        取消
      </button>
      <button
        class="btn btn-solid"
        type="button"
        :disabled="!hasPendingChanges"
        @click="emit('saveDraft', environment.id)"
      >
        确认
      </button>
    </div>
  </div>
</template>

<style scoped>
.env-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.editor-name {
  font-size: 14px;
  font-weight: 600;
  border: none;
  background: transparent;
  padding: 2px 4px;
  outline: none;
  flex: 1;
  color: inherit;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.editor-name--readonly {
  border-bottom: none;
  cursor: default;
}
.active-tag,
.draft-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  color: #fff;
  white-space: nowrap;
}
.active-tag {
  background: var(--primary-color);
}
.draft-tag {
  background: #f59e0b;
}
.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
</style>
