<template>
  <div class="history-panel">
    <div class="section-title">历史记录</div>
    <div v-if="!historyList.length" class="empty-state">暂无历史记录</div>
    <div v-else class="history-list">
      <div
        v-for="item in historyList"
        :key="item.timestamp"
        class="history-item"
        :class="{ active: item.originalIndex === currentIndex }"
        @click="$emit('jump-to', item.originalIndex)"
      >
        <div class="history-info">
          <span class="history-description">{{ item.description }}</span>
          <span class="history-time">{{ formatTime(item.timestamp) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface HistorySnapshot {
  json: string
  description: string
  timestamp: number
}

const props = defineProps<{
  undoStack: HistorySnapshot[]
  currentIndex: number
}>()

defineEmits<{
  'jump-to': [index: number]
}>()

const historyList = computed(() => {
  return props.undoStack.slice().reverse().map((item, i) => ({
    ...item,
    originalIndex: props.undoStack.length - 1 - i
  }))
})

function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - timestamp

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`

  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<style lang="scss" scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.section-title {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 13px;
  color: #333;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: #999;
  font-size: 13px;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.history-item {
  padding: 10px 16px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.2s;

  &:hover {
    background: #f5f5f5;
  }

  &.active {
    background: #e6f7ff;
    border-left-color: #1890ff;

    .history-description {
      color: #1890ff;
      font-weight: 500;
    }
  }
}

.history-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.history-description {
  flex: 1;
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  font-size: 11px;
  color: #999;
  flex-shrink: 0;
}
</style>
