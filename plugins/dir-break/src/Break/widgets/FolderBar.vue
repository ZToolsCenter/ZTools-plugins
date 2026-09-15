<script setup lang="ts">
defineProps<{ path: string }>()
const emit = defineEmits<{
  (e: 'open-explorer'): void
  (e: 'change'): void
}>()
</script>

<template>
  <div class="folder-bar">
    <div class="folder-bar-path" :title="path">{{ path }}</div>
    <button class="btn btn-ghost btn-icon" title="在资源管理器中打开" @click="emit('open-explorer')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    </button>
    <button class="btn btn-ghost" @click="emit('change')">更换</button>
  </div>
</template>

<style scoped>
.folder-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  margin-bottom: 12px;
}
.folder-bar-path {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
</style>
