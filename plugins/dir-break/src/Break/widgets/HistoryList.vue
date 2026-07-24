<script setup lang="ts">
import type { BreakRecord } from '../../types'

defineProps<{ history: BreakRecord[] }>()
const emit = defineEmits<{
  (e: 'undo', record: BreakRecord): void
  (e: 'clear'): void
}>()

function formatRelativeTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return Math.floor(diff / 86400000) + '天前'
}
</script>

<template>
  <div class="history">
    <div class="history-header">
      <span class="history-title">历史记录</span>
      <button class="btn btn-ghost btn-small" @click="emit('clear')">清空</button>
    </div>
    <div class="history-list">
      <div v-for="record in history" :key="record.id" class="history-item">
        <div class="history-item-info">
          <div class="history-item-name">{{ record.targetName }}</div>
          <div class="history-item-meta">
            {{ record.summary.totalMoved }} 个文件
            <template v-if="record.summary.totalDirsMoved > 0"> · {{ record.summary.totalDirsMoved }} 个目录</template>
            <template v-if="record.summary.totalDeleted > 0"> · 删除 {{ record.summary.totalDeleted }} 个</template>
            · {{ formatRelativeTime(record.timestamp) }}
          </div>
        </div>
        <button class="btn btn-undo" @click="emit('undo', record)">撤回</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 4px;
}
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.history-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius);
  transition: background 0.15s;
}
.history-item:hover {
  background: var(--bg-secondary);
}
.history-item-info {
  flex: 1;
  min-width: 0;
}
.history-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-item-meta {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}
</style>
