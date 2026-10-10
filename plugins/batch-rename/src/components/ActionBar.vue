<script setup lang="ts">
import type { SortMode } from '../core/session'

defineProps<{
  count: number
  ready: number
  error: number
  unchanged: number
  sortMode: SortMode
  canUndo: boolean
  canExecute: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  selectFiles: []
  selectFolder: []
  clear: []
  sort: [mode: SortMode]
  execute: []
  undo: []
}>()

const sortOptions: { value: SortMode; label: string }[] = [
  { value: 'name-asc', label: '按名称升序' },
  { value: 'name-desc', label: '按名称降序' },
  { value: 'size-asc', label: '按大小升序' },
  { value: 'size-desc', label: '按大小降序' },
  { value: 'modified-asc', label: '按修改时间升序' },
  { value: 'modified-desc', label: '按修改时间降序' },
  { value: 'created-asc', label: '按创建时间升序' },
  { value: 'created-desc', label: '按创建时间降序' }
]
</script>

<template>
  <footer class="action-bar" aria-label="文件操作">
    <div class="action-left">
      <button class="icon-button" type="button" title="读取文件夹下所有文件" aria-label="读取文件夹" :disabled="busy" @click="emit('selectFolder')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" /><path d="M12 11v6M9 14l3-3 3 3" /></svg></button>
      <span class="divider" aria-hidden="true"></span>
      <button class="icon-button" type="button" title="选择文件" aria-label="添加文件" :disabled="busy" @click="emit('selectFiles')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M12 12v6M9 15h6" /></svg></button>
      <span class="divider" aria-hidden="true"></span>
      <button class="icon-button" type="button" title="清空列表" aria-label="清空列表" :disabled="busy || !count" @click="emit('clear')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 10h13M10 14h10M13 18h7" /></svg></button>
      <span class="divider" aria-hidden="true"></span>
      <label class="sort-control">
        <span class="sr-only">文件排序方式</span>
        <select :value="sortMode" :disabled="busy" aria-label="文件排序方式" @change="emit('sort', ($event.target as HTMLSelectElement).value as SortMode)">
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">排序 - {{ option.label }}</option>
        </select>
      </label>
      <span class="file-count">已选 {{ count }} 个文件</span>
      <span v-if="ready || error" class="preview-count">待改名 {{ ready }} · 无变化 {{ unchanged }} · 错误 {{ error }}</span>
    </div>
    <div class="action-right">
      <button class="undo-button" type="button" :disabled="busy || !canUndo" @click="emit('undo')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg> 撤销重命名</button>
      <button class="execute-button" type="button" :disabled="busy || !canExecute"
        :title="!canExecute ? '当前没有可执行的改名，或该功能暂未开放' : '执行重命名'" @click="emit('execute')">
        <span class="play-icon" aria-hidden="true">▶</span>{{ busy ? '处理中…' : '执行重命名' }}
      </button>
    </div>
  </footer>
</template>

<style scoped>
.action-bar { min-height: 56px; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--border); background: var(--dock-bg); }
.action-left, .action-right { display: flex; align-items: center; gap: 10px; min-width: 0; }
.icon-button { width: 34px; height: 34px; flex: none; display: grid; place-items: center; color: var(--muted); background: transparent; }
.icon-button svg { width: 18px; height: 18px; }
.icon-button:hover:not(:disabled) { color: var(--text); background: var(--surface-hover); }
.divider { width: 1px; height: 18px; flex: none; background: var(--border); }
.sort-control select { width: 176px; height: 34px; padding: 0 9px; border: 1px solid var(--border-input); border-radius: 8px; color: var(--text); background: var(--surface-card); font: inherit; font-size: 12px; }
.file-count, .preview-count { color: var(--muted); font-size: 12px; white-space: nowrap; }
.undo-button, .execute-button { height: 36px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap; font: 500 13px inherit; }
.undo-button { border: 1px solid var(--border-input); color: var(--text); background: var(--surface-card); }
.undo-button svg { width: 14px; height: 14px; }
.undo-button:not(:disabled) { color: var(--primary); }
.execute-button { color: white; background: var(--primary); box-shadow: var(--shadow-button); font-weight: 600; }
.execute-button:hover:not(:disabled) { background: var(--primary-hover); }
.play-icon { width: 17px; height: 17px; display: grid; place-items: center; border-radius: 50%; color: var(--primary); background: white; font-size: 10px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
@media (max-width: 920px) { .action-bar { flex-wrap: wrap; } .action-right { margin-left: auto; } .preview-count { display: none; } }
@media (max-width: 610px) { .action-left { flex-wrap: wrap; } .file-count { display: none; } }
</style>
