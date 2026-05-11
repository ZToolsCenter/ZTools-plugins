<template>
  <div class="sidebar" :class="{ collapsed }" data-tour-id="sidebar-root">
    <div class="sidebar-header">
      <span v-show="!collapsed" class="sidebar-header__title">{{ activeTab === 'collections' ? t('sidebar.collections') : t('sidebar.history') }}</span>
      <div class="sidebar-header__actions">
        <UiTooltip v-if="activeTab === 'collections'" :content="t('sidebar.newCollection')" placement="bottom">
          <UiButton v-show="!collapsed" variant="ghost" size="sm" icon-only @click="$emit('new-collection')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </UiButton>
        </UiTooltip>
        <UiTooltip v-if="activeTab === 'collections'" :content="t('sidebar.manageCollections')" placement="bottom">
          <UiButton v-show="!collapsed" variant="ghost" size="sm" icon-only @click="$emit('manage-collections')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </UiButton>
        </UiTooltip>
        <UiTooltip :content="collapsed ? t('sidebar.expand') : t('sidebar.collapse')" placement="bottom">
          <UiButton variant="ghost" size="sm" icon-only @click="$emit('toggle')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </UiButton>
        </UiTooltip>
      </div>
    </div>
    <div v-show="!collapsed" class="sidebar-tabs">
      <div
        class="sidebar-tab"
        :class="{ active: activeTab === 'collections' }"
        @click="activeTab = 'collections'"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>
        {{ t('sidebar.tabCollections') }}
      </div>
      <div
        class="sidebar-tab"
        :class="{ active: activeTab === 'history' }"
        @click="activeTab = 'history'"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        {{ t('sidebar.tabHistory') }}
      </div>
    </div>
    <div v-show="!collapsed && activeTab === 'collections'" class="sidebar-content">
      <div v-for="collection in collectionsStore.state.collections" :key="collection.id" class="collection-group">
        <div class="collection-header" @click="toggleCollection(collection.id)">
          <svg class="chevron" :class="{ expanded: expandedCollections.has(collection.id) }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <template v-if="editingCollectionId === collection.id">
            <UiInput
              v-model="editingCollectionName"
              class="collection-name-input"
              @blur="saveCollectionName(collection.id)"
              @keydown.enter="saveCollectionName(collection.id)"
              @keydown.escape="cancelEditCollection"
              @click.stop
            />
          </template>
            <template v-else>
              <span class="collection-name">{{ collection.name }}</span>
            </template>
          <div class="collection-header__actions">
            <UiTooltip :content="t('common.edit')" placement="bottom">
              <UiButton variant="ghost" size="xs" icon-only @click.stop="startEditCollection(collection)">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </UiButton>
            </UiTooltip>
            <UiTooltip :content="t('common.delete')" placement="bottom">
              <UiButton variant="danger" size="xs" icon-only @click.stop="deleteCollection(collection.id)">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </UiButton>
            </UiTooltip>
          </div>
        </div>
        <div v-show="expandedCollections.has(collection.id)" class="collection-requests">
          <div
            v-for="req in collection.requests"
            :key="req.id"
            class="request-item"
            :class="{ active: activeRequest === req.id }"
            @click="onRequestClick(collection.id, req.id)"
            @dblclick.stop="onRequestDoubleClick(collection.id, req.id)"
          >
            <span class="method-badge" :class="req.method.toLowerCase()">{{ req.method }}</span>
            <template v-if="editingRequestId === req.id">
              <UiInput
                v-model="editingRequestName"
                class="request-name-input"
                @blur="saveRequestName(collection.id, req.id)"
                @keydown.enter="saveRequestName(collection.id, req.id)"
                @keydown.escape="cancelEditRequest"
                @click.stop
              />
            </template>
            <template v-else>
              <span class="request-name">{{ req.name }}</span>
            </template>
            <div class="request-item__actions">
              <UiTooltip :content="t('common.edit')" placement="bottom">
                <UiButton variant="ghost" size="xs" icon-only @click.stop="startEditRequest(collection.id, req)">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </UiButton>
              </UiTooltip>
              <UiTooltip :content="t('common.delete')" placement="bottom">
                <UiButton variant="danger" size="xs" icon-only @click.stop="deleteRequest(collection.id, req.id)">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </UiButton>
              </UiTooltip>
            </div>
          </div>
          <UiButton variant="ghost" size="xs" class="add-request-btn" @click="$emit('new-request', collection.id)">
            {{ t('sidebar.addRequest') }}
          </UiButton>
        </div>
      </div>
      <UiEmpty v-if="collectionsStore.state.collections.length === 0" :text="t('sidebar.noCollections')">
        <template #action>
          <UiButton variant="primary" size="sm" @click="$emit('new-collection')">{{ t('sidebar.createCollection') }}</UiButton>
        </template>
      </UiEmpty>
    </div>
    <div v-show="!collapsed && activeTab === 'history'" class="sidebar-content history-panel">
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
    </div>

    <UiConfirm
      v-if="pendingDeleteCollection"
      :title="t('confirm.deleteCollection')"
      :message="t('confirm.deleteCollectionMsg')"
      :confirm-text="t('common.delete')"
      confirm-variant="danger"
      @confirm="confirmDeleteCollection"
      @cancel="pendingDeleteCollection = null"
    />
    <UiConfirm
      v-if="pendingDeleteRequest"
      :title="t('confirm.deleteRequest')"
      :message="t('confirm.deleteRequestMsg')"
      :confirm-text="t('common.delete')"
      confirm-variant="danger"
      @confirm="confirmDeleteRequest"
      @cancel="pendingDeleteRequest = null"
    />
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
import { useCollectionsStore } from '../store/collections'
import { useHistoryStore, type HistoryItem } from '../store/history'
import UiButton from './ui/UiButton.vue'
import UiBadge from './ui/UiBadge.vue'
import UiEmpty from './ui/UiEmpty.vue'
import UiInput from './ui/UiInput.vue'
import UiConfirm from './ui/UiConfirm.vue'
import UiTooltip from './ui/UiTooltip.vue'

const { t } = useI18n()

const props = defineProps<{
  activeCollection: string | null
  activeRequest: string | null
  collapsed: boolean
}>()

const emit = defineEmits<{
  'select-request': [collectionId: string, requestId: string]
  'open-request-in-new-tab': [collectionId: string, requestId: string]
  'new-request': [collectionId: string]
  'new-collection': []
  'manage-collections': []
  'toggle': []
  'load-history': [item: HistoryItem]
}>()

const collectionsStore = useCollectionsStore()
const historyStore = useHistoryStore()

const expandedCollections = ref<Set<string>>(new Set())
const activeTab = ref<'collections' | 'history'>('collections')

const editingCollectionId = ref<string | null>(null)
const editingCollectionName = ref('')
const editingRequestId = ref<string | null>(null)
const editingRequestName = ref('')

const pendingDeleteCollection = ref<string | null>(null)
const pendingDeleteRequest = ref<{ collectionId: string; requestId: string } | null>(null)
const pendingClearHistory = ref(false)
let requestClickTimer: number | null = null

function toggleCollection(id: string) {
  if (editingCollectionId.value) return
  if (expandedCollections.value.has(id)) {
    expandedCollections.value.delete(id)
  } else {
    expandedCollections.value.add(id)
  }
}

function startEditCollection(collection: { id: string; name: string }) {
  editingCollectionId.value = collection.id
  editingCollectionName.value = collection.name
}

function saveCollectionName(id: string) {
  const name = editingCollectionName.value.trim()
  if (name) {
    collectionsStore.updateCollection(id, { name })
  }
  editingCollectionId.value = null
}

function cancelEditCollection() {
  editingCollectionId.value = null
}

function deleteCollection(id: string) {
  pendingDeleteCollection.value = id
}

function confirmDeleteCollection() {
  if (pendingDeleteCollection.value) {
    collectionsStore.deleteCollection(pendingDeleteCollection.value)
    if (props.activeCollection === pendingDeleteCollection.value) {
      emit('select-request', '', '')
    }
    pendingDeleteCollection.value = null
  }
}

function startEditRequest(collectionId: string, req: { id: string; name: string }) {
  editingRequestId.value = req.id
  editingRequestName.value = req.name
}

function saveRequestName(collectionId: string, requestId: string) {
  const name = editingRequestName.value.trim()
  if (name) {
    collectionsStore.updateRequest(collectionId, requestId, { name })
  }
  editingRequestId.value = null
}

function cancelEditRequest() {
  editingRequestId.value = null
}

function deleteRequest(collectionId: string, requestId: string) {
  pendingDeleteRequest.value = { collectionId, requestId }
}

function confirmDeleteRequest() {
  if (pendingDeleteRequest.value) {
    const { collectionId, requestId } = pendingDeleteRequest.value
    collectionsStore.deleteRequest(collectionId, requestId)
    if (props.activeRequest === requestId) {
      emit('select-request', collectionId, '')
    }
    pendingDeleteRequest.value = null
  }
}

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

function onRequestClick(collectionId: string, requestId: string) {
  if (requestClickTimer !== null) {
    window.clearTimeout(requestClickTimer)
  }

  requestClickTimer = window.setTimeout(() => {
    emit('select-request', collectionId, requestId)
    requestClickTimer = null
  }, 180)
}

function onRequestDoubleClick(collectionId: string, requestId: string) {
  if (requestClickTimer !== null) {
    window.clearTimeout(requestClickTimer)
    requestClickTimer = null
  }
  emit('open-request-in-new-tab', collectionId, requestId)
}

function getStatusVariant(status: number): 'success' | 'warning' | 'error' | 'info' {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'warning'
  return 'error'
}
</script>

<style scoped>
.sidebar {
  width: 250px;
  min-width: 250px;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  transition: width var(--transition-base), min-width var(--transition-base);
}

.sidebar.collapsed {
  width: 48px;
  min-width: 48px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  white-space: nowrap;
  flex-shrink: 0;
}

.sidebar.collapsed .sidebar-header {
  padding: 12px 8px;
  justify-content: center;
}

.sidebar-header__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-header__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
}

.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.sidebar-tab {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex: 1;
  justify-content: center;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition-fast);
  border-bottom: 2px solid transparent;
  user-select: none;
}

.sidebar-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-elevated);
}

.sidebar-tab.active {
  color: var(--accent-primary);
  border-bottom-color: var(--accent-primary);
}

.collection-group {
  margin-bottom: 2px;
}

.collection-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 6px var(--space-lg);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-base);
  border-left: 2px solid transparent;
  white-space: nowrap;
  position: relative;
}

.collection-header:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--text-muted);
}

.collection-header:hover .collection-header__actions {
  opacity: 1;
}

.collection-header__actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--transition-fast);
  margin-left: auto;
  flex-shrink: 0;
}

.chevron {
  transition: transform var(--transition-base);
  flex-shrink: 0;
}

.chevron.expanded {
  transform: rotate(90deg);
}

.collection-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.collection-name-input {
  flex: 1;
  min-width: 0;
}

.collection-requests {
  padding-left: var(--space-lg);
}

.request-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 5px var(--space-lg);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all var(--transition-base);
  border-left: 2px solid transparent;
  white-space: nowrap;
  position: relative;
}

.request-item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--accent-primary);
}

.request-item:hover .request-item__actions {
  opacity: 1;
}

.request-item.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--accent-primary);
}

.request-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.request-name-input {
  flex: 1;
  min-width: 0;
}

.request-item__actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--transition-fast);
  margin-left: auto;
  flex-shrink: 0;
}

.add-request-btn {
  width: calc(100% - 24px);
  margin: 4px 12px;
  justify-content: center;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
}

.history-panel {
  display: flex;
  flex-direction: column;
  padding: 0;
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
