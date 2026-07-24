<template>
  <div class="collections-panel">
    <div class="collections-panel__content">
      <div v-for="collection in collectionsStore.state.collections" :key="collection.id" class="collection-group">
        <div
          class="collection-header"
          @click="toggleCollection(collection.id)"
          @contextmenu.prevent="onCollectionContextMenu($event, collection)"
        >
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
            <UiTooltip :content="t('sidebar.addRequest')" placement="bottom">
              <UiButton variant="ghost" size="xs" icon-only @click.stop="$emit('new-request', collection.id)">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </UiButton>
            </UiTooltip>
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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCollectionsStore } from '../../store/collections'
import UiButton from '../ui/UiButton.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiInput from '../ui/UiInput.vue'
import UiConfirm from '../ui/UiConfirm.vue'
import UiTooltip from '../ui/UiTooltip.vue'

const { t } = useI18n()

const props = defineProps<{
  activeCollection: string | null
  activeRequest: string | null
}>()

const emit = defineEmits<{
  'select-request': [collectionId: string, requestId: string]
  'open-request-in-new-tab': [collectionId: string, requestId: string]
  'new-request': [collectionId: string]
  'new-collection': []
}>()

const collectionsStore = useCollectionsStore()

const expandedCollections = ref<Set<string>>(new Set())

const editingCollectionId = ref<string | null>(null)
const editingCollectionName = ref('')
const editingRequestId = ref<string | null>(null)
const editingRequestName = ref('')

const pendingDeleteCollection = ref<string | null>(null)
const pendingDeleteRequest = ref<{ collectionId: string; requestId: string } | null>(null)
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

function onCollectionContextMenu(_event: MouseEvent, _collection: { id: string; name: string }) {
  // Right-click context menu — handled by existing inline actions
}
</script>

<style scoped>
.collections-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.collections-panel__content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
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
