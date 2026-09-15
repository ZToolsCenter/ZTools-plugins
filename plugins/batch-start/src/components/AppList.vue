<script setup lang="ts">
import { computed } from 'vue'
import type { AppDoc, CategoryDoc } from '../types'

const props = defineProps<{
  apps: AppDoc[]
  categories: CategoryDoc[]
  selectedCategoryId: string | null
  selectedAppIds: string[]
  searchQuery: string
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  toggleSelect: [appId: string]
  assignCategory: [appId: string, categoryId: string | null]
  addSelectedToGroup: []
}>()

const filteredApps = computed(() => {
  const q = props.searchQuery.trim().toLowerCase()
  return props.apps.filter((app) => {
    const inCategory = app.categoryId === props.selectedCategoryId
    if (!inCategory) return false
    if (!q) return true
    return (
      app.name.toLowerCase().includes(q) || app.path.toLowerCase().includes(q)
    )
  })
})

const selectedSet = computed(() => new Set(props.selectedAppIds))

function onAssign(appId: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('assignCategory', appId, value === '' ? null : value)
}
</script>

<template>
  <section class="panel app-list">
    <div class="panel-header">
      <span>应用</span>
      <div class="toolbar-row">
        <input
          class="search-input"
          type="search"
          placeholder="搜索名称或路径"
          :value="searchQuery"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        />
        <button
          class="btn btn-sm btn-primary"
          type="button"
          :disabled="selectedAppIds.length === 0"
          @click="emit('addSelectedToGroup')"
        >
          加入当前组
        </button>
      </div>
    </div>
    <div class="panel-body">
      <div v-if="filteredApps.length === 0" class="empty-state">
        <div>当前分类下没有应用</div>
      </div>
      <div
        v-for="app in filteredApps"
        :key="app._id"
        class="list-item app-row"
        :class="{ active: selectedSet.has(app._id) }"
      >
        <input
          type="checkbox"
          :checked="selectedSet.has(app._id)"
          @change="emit('toggleSelect', app._id)"
        />
        <img v-if="app.icon" class="app-icon" :src="app.icon" alt="" />
        <div class="app-meta">
          <div class="app-name">{{ app.name }}</div>
          <div class="app-path muted">{{ app.path }}</div>
        </div>
        <select
          class="cat-select"
          :value="app.categoryId ?? ''"
          @change="onAssign(app._id, $event)"
          @click.stop
        >
          <option value="">未分类</option>
          <option v-for="cat in categories" :key="cat._id" :value="cat._id">
            {{ cat.name }}
          </option>
        </select>
      </div>
    </div>
  </section>
</template>

<style scoped>
.app-list {
  flex: 1;
  min-width: 0;
}

.search-input {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px 8px;
  min-width: 160px;
}

.app-row {
  cursor: default;
}

.app-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
}

.app-meta {
  flex: 1;
  min-width: 0;
}

.app-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-select {
  max-width: 120px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 3px 6px;
  background: #fff;
}
</style>
