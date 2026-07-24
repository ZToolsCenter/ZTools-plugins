<script setup lang="ts">
import type { ConflictStrategy } from '../../types'

defineProps<{
  recursive: boolean
  conflictStrategy: ConflictStrategy
}>()
const emit = defineEmits<{
  (e: 'update:recursive', val: boolean): void
  (e: 'update:conflictStrategy', val: ConflictStrategy): void
}>()
</script>

<template>
  <div class="config-bar">
    <div class="option-group">
      <span class="option-label">模式</span>
      <div class="toggle-group">
        <button class="toggle-btn" :class="{ 'toggle-btn--active': !recursive }"
          @click="emit('update:recursive', false)">单层</button>
        <button class="toggle-btn" :class="{ 'toggle-btn--active': recursive }"
          @click="emit('update:recursive', true)">递归</button>
      </div>
    </div>
    <div class="option-group">
      <span class="option-label">冲突</span>
      <select :value="conflictStrategy" @change="emit('update:conflictStrategy', ($event.target as HTMLSelectElement).value as ConflictStrategy)" class="select">
        <option value="rename">自动重命名</option>
        <option value="overwrite">覆盖</option>
        <option value="skip">跳过</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.config-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  margin-bottom: 12px;
}
.option-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.option-label {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.toggle-group {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.toggle-btn {
  padding: 4px 12px;
  font-size: 13px;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 0;
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
  border: none;
  outline: none;
}
.toggle-btn:not(:last-child) {
  border-right: 1px solid var(--border);
}
.toggle-btn.toggle-btn--active {
  background: var(--primary);
  color: var(--primary-text);
}
.select {
  padding: 4px 8px;
  font-size: 13px;
  border-radius: var(--radius-sm);
  min-width: 100px;
}
</style>
