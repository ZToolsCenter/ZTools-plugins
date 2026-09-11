<script setup lang="ts">
import { Star } from 'lucide-vue-next'
import type { PromptType, Project } from '../types'

defineProps<{
  editType: PromptType
  editProjectId: string
  editTags: string[]
  tagInput: string
  projects: Project[]
  isFavorite: boolean
}>()

const emit = defineEmits<{
  (e: 'update:editType', v: PromptType): void
  (e: 'update:editProjectId', v: string): void
  (e: 'update:editTags', v: string[]): void
  (e: 'update:tagInput', v: string): void
  (e: 'addTag'): void
  (e: 'removeTag', tag: string): void
  (e: 'toggleFavorite'): void
}>()
</script>

<template>
  <div class="field">
    <label>类型</label>
    <div class="type-grid">
      <button v-for="t in [{v:'prompt' as PromptType,l:'提示词'},{v:'snippet' as PromptType,l:'片段'},{v:'template' as PromptType,l:'模板'},{v:'constraint' as PromptType,l:'约束'}]"
        :key="t.v" :class="['type-btn', { active: editType === t.v }]" @click="emit('update:editType', t.v)">{{ t.l }}</button>
    </div>
  </div>
  <div class="field">
    <label>归属项目</label>
    <select :value="editProjectId" @change="emit('update:editProjectId', ($event.target as HTMLSelectElement).value)" class="prop-select">
      <option value="">无项目（资产）</option>
      <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.group }} / {{ p.name }}</option>
    </select>
  </div>
  <div class="field">
    <label>标签</label>
    <div v-if="editTags.length" class="tag-list">
      <span v-for="t in editTags" :key="t" class="tag-item">{{ t }} <button class="tag-rm" @click="emit('removeTag', t)">×</button></span>
    </div>
    <div class="tag-input-row">
      <input :value="tagInput" class="tag-input" placeholder="输入标签，回车添加" @keydown.enter.prevent="emit('addTag')" @input="emit('update:tagInput', ($event.target as HTMLInputElement).value)" />
      <button class="btn btn-xs" @click="emit('addTag')">添加</button>
    </div>
  </div>
  <div class="field">
    <label>收藏</label>
    <button class="btn" @click="emit('toggleFavorite')"><Star :size="14" :fill="isFavorite ? 'currentColor' : 'none'" />{{ isFavorite ? '已收藏' : '加入收藏' }}</button>
  </div>
</template>

<style scoped>
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }
.type-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.type-btn { padding: 6px 14px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 12px; cursor: pointer; transition: all 0.12s; }
.type-btn:hover { border-color: var(--pf-accent); }
.type-btn.active { background: var(--pf-accent); color: #fff; border-color: var(--pf-accent); }
.prop-select { height: 38px; padding: 0 10px; width: 100%; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); font-size: 13.5px; }
.prop-select:focus { border-color: var(--pf-accent); outline: none; }
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.tag-item { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: var(--pf-accent-soft); color: var(--pf-accent); border-radius: var(--pf-radius-xs); font-size: 12px; font-weight: 500; }
.tag-rm { background: none; border: none; color: var(--pf-accent); cursor: pointer; font-size: 14px; padding: 0; line-height: 1; }
.tag-input-row { display: flex; gap: 6px; }
.tag-input { flex: 1; height: 30px; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); padding: 0 10px; font-size: 13px; }
.tag-input:focus { border-color: var(--pf-accent); outline: none; }
.btn-xs { height: 24px; padding: 0 8px; font-size: 11px; }
</style>
