<template>
  <div class="history-panel">
    <div class="history-panel__header">
      <UiButton variant="ghost" size="xs" :disabled="historyStore.state.items.length === 0" @click="requestClearHistory">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
        {{ t('sidebar.clearHistory') }}
      </UiButton>
    </div>
    <div class="history-list">
      <div
        v-for="item in historyStore.state.items"
        :key="item.id"
        class="history-item"
        @click="loadHistory(item)"
      >
        <div class="history-item__main">
          <div class="history-item__top">
            <span class="method-badge" :class="item.method.toLowerCase()">{{ item.method }}</span>
            <span class="history-url">{{ item.url }}</span>
          </div>
          <div class="history-item__meta">
            <span class="history-item__time">{{ formatTime(item.timestamp) }}</span>
            <UiBadge v-if="item.status" :variant="getStatusVariant(item.status)" size="sm">
              {{ item.status }}
            </UiBadge>
            <span v-if="item.responseTime" class="history-item__time">{{ item.responseTime }}ms</span>
          </div>
        </div>
        <div class="history-item__actions">
          <UiTooltip :content="t('sidebar.deleteHistoryItem')" placement="left">
            <UiButton variant="danger" size="xs" icon-only @click.stop="deleteHistoryItem(item.id)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </UiButton>
          </UiTooltip>
        </div>
      </div>
      <UiEmpty v-if="historyStore.state.items.length === 0" :text="t('sidebar.noHistory')" />
    </div>

    <UiConfirm
      v-if="pendingClearHistory"
      :title="t('confirm.clearHistory')"
      :message="t('confirm.clearHistoryMsg')"
      :confirm-text="t('common.delete')"
      confirm-variant="danger"
      @confirm="confirmClearHistory"
      @cancel="pendingClearHistory = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHistoryStore, type HistoryItem } from '../../store/history'
import UiButton from '../ui/UiButton.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiConfirm from '../ui/UiConfirm.vue'
import UiTooltip from '../ui/UiTooltip.vue'

const { t } = useI18n()

const emit = defineEmits<{
  'load-history': [item: HistoryItem]
}>()

const historyStore = useHistoryStore()

const pendingClearHistory = ref(false)

function deleteHistoryItem(id: string) {
  historyStore.deleteItem(id)
}

function requestClearHistory() {
  if (historyStore.state.items.length === 0) {
    return
  }
  pendingClearHistory.value = true
}

function confirmClearHistory() {
  historyStore.clearHistory()
  pendingClearHistory.value = false
}

function formatTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return t('history.justNow')
  if (minutes < 60) return t('history.minutesAgo', { count: minutes })
  if (hours < 24) return t('history.hoursAgo', { count: hours })
  if (days < 7) return t('history.daysAgo', { count: days })

  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function loadHistory(item: HistoryItem) {
  emit('load-history', item)
}

function getStatusVariant(status: number): 'success' | 'warning' | 'error' | 'info' {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'warning'
  return 'error'
}
</script>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.history-panel__header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-xs) 0;
}

.history-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  transition: all var(--transition-base);
  position: relative;
}

.history-item:hover {
  background: var(--bg-elevated);
}

.history-item:hover .history-item__actions {
  opacity: 1;
}

.history-item__main {
  flex: 1;
  min-width: 0;
}

.history-item__top {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: 3px;
}

.history-item__meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding-left: 2px;
}

.history-item__time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.history-item__actions {
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity var(--transition-fast);
  flex-shrink: 0;
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-secondary);
}

.method-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  text-transform: uppercase;
}

.method-badge.get { color: var(--success-color); }
.method-badge.post { color: var(--warning-color); }
.method-badge.put { color: var(--info-color); }
.method-badge.delete { color: var(--error-color); }
.method-badge.patch { color: #a78bfa; }
.method-badge.head { color: #2dd4bf; }
.method-badge.options { color: #a8a29e; }
</style>
