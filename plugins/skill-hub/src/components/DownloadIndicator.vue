<script setup lang="ts">
import { computed } from 'vue'
import { useDownloadQueue } from '../composables/useDownloadQueue'

const { queue, isExpanded, activeCount, hasItems, clearCompleted } = useDownloadQueue()

function formatTime(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
}

function getStatusIcon(status: string) {
  if (status === 'running') return 'M21 12a9 9 0 1 1-6.219-8.56'
  if (status === 'success') return 'M20 6 9 17 4 12'
  if (status === 'error') return 'M12 9v4m0 4h.01'
  return 'M12 8v4l3 3'
}

function getStatusColor(status: string) {
  if (status === 'running') return 'var(--primary)'
  if (status === 'success') return 'hsl(142 50% 45%)'
  if (status === 'error') return 'var(--destructive)'
  return 'var(--muted-foreground)'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="hasItems" class="download-indicator" :class="{ expanded: isExpanded }">
      <button class="di-toggle" @click="isExpanded = !isExpanded" :title="isExpanded ? '收起' : '展开'">
        <div class="di-toggle-content">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ spinning: activeCount > 0 }">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span v-if="activeCount > 0" class="di-count">{{ activeCount }}</span>
          <span class="di-label">{{ activeCount > 0 ? '安装中' : '已完成' }}</span>
        </div>
        <svg class="di-chevron" :class="{ rotated: isExpanded }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>

      <div v-if="isExpanded" class="di-list">
        <div v-for="item in queue" :key="item.id" class="di-item" :class="item.status">
          <div class="di-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" :stroke="getStatusColor(item.status)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ spinning: item.status === 'running' }">
              <path :d="getStatusIcon(item.status)" />
            </svg>
          </div>
          <div class="di-item-info">
            <span class="di-item-name">{{ item.skillName }}</span>
            <span class="di-item-meta">
              {{ item.type === 'download' ? '下载' : `分发到 ${item.platformNames?.join(', ') || ''}` }}
              · {{ formatTime(item.startedAt) }}
            </span>
          </div>
          <span v-if="item.error" class="di-item-error" :title="item.error">!</span>
        </div>
        <button v-if="queue.some(i => i.status === 'success' || i.status === 'error')" class="di-clear" @click="clearCompleted">
          清除已完成
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.download-indicator {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  box-shadow: 0 8px 32px hsl(0 0% 0% / 0.12);
  min-width: 200px;
  max-width: 320px;
  overflow: hidden;
  transition: all var(--duration-base) var(--ease-standard);
}

.di-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: hsl(var(--foreground));
  transition: background var(--duration-base) var(--ease-standard);
}

.di-toggle:hover {
  background: hsl(var(--accent));
}

.di-toggle-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.di-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 6px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.di-label {
  font-size: 13px;
  font-weight: 500;
}

.di-chevron {
  color: hsl(var(--muted-foreground));
  transition: transform var(--duration-base) var(--ease-standard);
}

.di-chevron.rotated {
  transform: rotate(180deg);
}

.di-list {
  border-top: 1px solid hsl(var(--border));
  max-height: 240px;
  overflow-y: auto;
}

.di-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  transition: background var(--duration-base) var(--ease-standard);
}

.di-item:not(:last-child) {
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.di-item-icon {
  flex-shrink: 0;
}

.di-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.di-item-name {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.di-item-meta {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.di-item.success .di-item-name {
  color: hsl(142 50% 40%);
}

.di-item.error .di-item-name {
  color: hsl(var(--destructive));
}

.di-item-error {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 50%;
  background: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
  flex-shrink: 0;
}

.di-clear {
  display: block;
  width: 100%;
  padding: 8px;
  border: none;
  border-top: 1px solid hsl(var(--border));
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.di-clear:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}
</style>
