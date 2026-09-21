<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppDoc, CategoryDoc } from '../types'

export type AppSourceFilter = 'all' | 'system' | 'command'

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

const sourceFilter = ref<AppSourceFilter>('all')

function isCommandApp(app: AppDoc): boolean {
  return app.source === 'ztools' || app.source === 'plugin'
}

const filteredApps = computed(() => {
  const q = props.searchQuery.trim().toLowerCase()
  return props.apps.filter((app) => {
    const inCategory = app.categoryId === props.selectedCategoryId
    if (!inCategory) return false

    if (sourceFilter.value === 'system' && isCommandApp(app)) return false
    if (sourceFilter.value === 'command' && !isCommandApp(app)) return false

    if (!q) return true
    const haystack = [app.name, app.path, app.pluginTitle, app.pluginName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

const selectedSet = computed(() => new Set(props.selectedAppIds))

function onAssign(appId: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('assignCategory', appId, value === '' ? null : value)
}

function onSourceFilterChange(event: Event) {
  sourceFilter.value = (event.target as HTMLSelectElement).value as AppSourceFilter
}
</script>

<template>
  <section class="panel app-list">
    <div class="panel-header">
      <span>应用</span>
      <div class="toolbar-row">
        <select
          class="source-filter"
          :value="sourceFilter"
          aria-label="按来源筛选"
          @change="onSourceFilterChange"
        >
          <option value="all">全部</option>
          <option value="system">系统应用</option>
          <option value="command">指令</option>
        </select>
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
        <div>当前筛选条件下没有应用</div>
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
          <div class="app-name">
            {{ app.name }}
            <span v-if="isCommandApp(app)" class="source-badge">指令</span>
          </div>
          <div class="app-path muted">
            {{
              isCommandApp(app)
                ? app.pluginTitle || app.pluginName || app.path
                : app.path
            }}
          </div>
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

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.source-filter,
.search-input,
.cat-select {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
}

.source-filter {
  padding: 4px 8px;
  max-width: 110px;
}

.search-input {
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
  display: flex;
  align-items: center;
  gap: 6px;
}

.source-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  color: #1d4ed8;
  background: #dbeafe;
}

.app-path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-select {
  max-width: 120px;
  padding: 3px 6px;
}
</style>
