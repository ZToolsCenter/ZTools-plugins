<script setup lang="ts">
defineProps<{ isDragOver: boolean }>()
const emit = defineEmits<{
  (e: 'select-folder'): void
  (e: 'dragover', ev: DragEvent): void
  (e: 'dragleave'): void
  (e: 'drop', ev: DragEvent): void
}>()
</script>

<template>
  <div
    class="drop-zone" :class="{ 'drop-zone--active': isDragOver }"
    @dragover.prevent="emit('dragover', $event)"
    @dragleave="emit('dragleave')"
    @drop.prevent="emit('drop', $event)"
  >
    <div class="drop-zone-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    </div>
    <div class="drop-zone-text">拖拽文件夹到此处</div>
    <div class="drop-zone-hint">或点击下方按钮选择</div>
    <button class="btn btn-primary" @click="emit('select-folder')">选择文件夹</button>
  </div>
</template>

<style scoped>
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 20px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  transition: border-color 0.2s, background 0.2s;
  cursor: default;
}
.drop-zone:hover {
  border-color: var(--primary);
  background: var(--primary-light);
}
.drop-zone--active {
  border-color: var(--primary);
  background: var(--primary-light);
}
.drop-zone-icon {
  color: var(--text-muted);
  margin-bottom: 12px;
}
.drop-zone--active .drop-zone-icon {
  color: var(--primary);
}
.drop-zone-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.drop-zone-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 16px;
}
</style>
