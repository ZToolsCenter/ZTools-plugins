<template>
  <div class="collection-manager">
    <div class="collection-manager__header">
      <span>{{ t('collection.title') }}</span>
      <UiButton variant="ghost" size="xs" @click="createNewCollection">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {{ t('collection.new') }}
      </UiButton>
    </div>
    <div class="collection-manager__list">
      <div v-for="collection in collectionsStore.state.collections" :key="collection.id" class="collection-card">
        <div class="collection-card__info">
          <UiInput
            v-if="editingId === collection.id"
            v-model="editingName"
            class="collection-card__input"
            @blur="saveName(collection.id)"
            @keydown.enter="saveName(collection.id)"
            @keydown.escape="cancelEdit"
          />
          <span v-else class="collection-card__name" @dblclick="startEdit(collection)">{{ collection.name }}</span>
          <UiBadge variant="info" size="sm">{{ collection.requests.length }} {{ t('collection.requests') }}</UiBadge>
        </div>
        <div class="collection-card__actions">
          <UiTooltip :content="t('common.delete')" placement="bottom">
            <UiButton variant="danger" size="xs" icon-only @click="deleteCollection(collection.id)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </UiButton>
          </UiTooltip>
        </div>
      </div>
      <UiEmpty v-if="collectionsStore.state.collections.length === 0" :text="t('collection.noCollections')" />
    </div>

    <UiConfirm
      v-if="pendingDeleteId"
      :title="t('confirm.deleteCollection')"
      :message="t('confirm.deleteCollectionMsg')"
      :confirm-text="t('common.delete')"
      confirm-variant="danger"
      @confirm="confirmDelete"
      @cancel="pendingDeleteId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCollectionsStore, type Collection } from '../store/collections'
import UiButton from './ui/UiButton.vue'
import UiInput from './ui/UiInput.vue'
import UiBadge from './ui/UiBadge.vue'
import UiEmpty from './ui/UiEmpty.vue'
import UiConfirm from './ui/UiConfirm.vue'
import UiTooltip from './ui/UiTooltip.vue'

const { t } = useI18n()

const collectionsStore = useCollectionsStore()
const editingId = ref<string | null>(null)
const editingName = ref('')
const pendingDeleteId = ref<string | null>(null)

function createNewCollection() {
  const name = `${t('collection.defaultName')} ${collectionsStore.state.collections.length + 1}`
  collectionsStore.createCollection(name)
}

function startEdit(collection: Collection) {
  editingId.value = collection.id
  editingName.value = collection.name
}

function saveName(id: string) {
  if (editingName.value.trim()) {
    collectionsStore.updateCollection(id, { name: editingName.value.trim() })
  }
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
}

function deleteCollection(id: string) {
  pendingDeleteId.value = id
}

function confirmDelete() {
  if (pendingDeleteId.value) {
    collectionsStore.deleteCollection(pendingDeleteId.value)
    pendingDeleteId.value = null
  }
}

</script>

<style scoped>
.collection-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.collection-manager__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 var(--space-md);
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: var(--space-md);
  letter-spacing: 0.02em;
  color: var(--text-primary);
}

.collection-manager__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.collection-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-base);
  border-left: 2px solid transparent;
  margin: 2px 4px;
}

.collection-card:hover {
  background: var(--bg-elevated);
  border-left-color: var(--accent-primary);
}

.collection-card__info {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  min-width: 0;
}

.collection-card__name {
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-primary);
}

.collection-card__input {
  flex: 1;
}

.collection-card__actions {
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.collection-card:hover .collection-card__actions {
  opacity: 1;
}
</style>
