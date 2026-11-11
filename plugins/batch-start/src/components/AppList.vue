<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppDoc, CategoryDoc, GroupDoc } from '../types'

export type AppSourceFilter = 'all' | 'system' | 'command'
/** all = 不限分类；none = 未分类；其余为 categoryId */
export type CategoryFilter = 'all' | 'none' | string

const props = defineProps<{
  apps: AppDoc[]
  categories: CategoryDoc[]
  groups: GroupDoc[]
  categoryFilter: CategoryFilter
  selectedAppIds: string[]
  searchQuery: string
  canAddToCategory?: boolean
  targetCategoryName?: string
  canAddToGroup?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  'update:categoryFilter': [value: CategoryFilter]
  toggleSelect: [appId: string]
  addToCategory: [appId: string]
  addToGroup: [appId: string]
  addSelectedToGroup: []
  removeFromCategory: [appId: string, categoryId: string]
  removeFromGroup: [appId: string, groupId: string]
  launch: [appId: string]
}>()

const sourceFilter = ref<AppSourceFilter>('all')
const catOpen = ref(false)
const catMenuPos = ref({ top: 0, left: 0, width: 160 })
const catTriggerEl = ref<HTMLButtonElement | null>(null)

const categoryOptions = computed(() => {
  const opts: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: '全部分类' },
    { value: 'none', label: '未分类' },
    ...props.categories.map((c) => ({ value: c._id, label: c.name })),
  ]
  return opts
})

const categoryFilterLabel = computed(
  () =>
    categoryOptions.value.find((o) => o.value === props.categoryFilter)?.label ?? '全部分类',
)

function isCommandApp(app: AppDoc): boolean {
  return app.source === 'ztools' || app.source === 'plugin'
}

const filteredApps = computed(() => {
  const q = props.searchQuery.trim().toLowerCase()
  return props.apps.filter((app) => {
    const ids = app.categoryIds ?? []
    if (props.categoryFilter === 'none') {
      if (ids.length > 0) return false
    } else if (props.categoryFilter !== 'all') {
      if (!ids.includes(props.categoryFilter)) return false
    }

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

const categoryNameById = computed(() => {
  const map = new Map<string, string>()
  for (const c of props.categories) map.set(c._id, c.name)
  return map
})

type TagItem = { id: string; label: string }

const groupsByAppId = computed(() => {
  const map = new Map<string, TagItem[]>()
  for (const g of props.groups) {
    for (const appId of g.appIds) {
      const item = { id: g._id, label: g.name }
      const list = map.get(appId)
      if (list) list.push(item)
      else map.set(appId, [item])
    }
  }
  return map
})

function categoryTagsFor(app: AppDoc): TagItem[] {
  return (app.categoryIds ?? [])
    .map((id) => {
      const label = categoryNameById.value.get(id)
      return label ? { id, label } : null
    })
    .filter((t): t is TagItem => t != null)
}

function groupTagsFor(app: AppDoc): TagItem[] {
  return groupsByAppId.value.get(app._id) ?? []
}

function placeCatMenu() {
  const el = catTriggerEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  catMenuPos.value = {
    top: rect.bottom + 4,
    left: rect.left,
    width: Math.max(rect.width, 160),
  }
}

async function toggleCatMenu() {
  if (catOpen.value) {
    catOpen.value = false
    return
  }
  catOpen.value = true
  await nextTick()
  placeCatMenu()
}

function closeCatMenu() {
  catOpen.value = false
}

function pickCategory(value: CategoryFilter) {
  emit('update:categoryFilter', value)
  closeCatMenu()
}

function onDocClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.cat-select')) closeCatMenu()
}

function onDocKey(event: KeyboardEvent) {
  if (event.key === 'Escape') closeCatMenu()
}

function onWinScroll() {
  if (catOpen.value) placeCatMenu()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
  window.addEventListener('resize', onWinScroll)
  window.addEventListener('scroll', onWinScroll, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
  window.removeEventListener('resize', onWinScroll)
  window.removeEventListener('scroll', onWinScroll, true)
})

function onRowClick(appId: string) {
  emit('toggleSelect', appId)
}
</script>

<template>
  <section class="panel app-list">
    <div class="panel-header">
      <span>应用</span>
      <div class="toolbar-row">
        <div class="cat-select" @click.stop>
          <button
            ref="catTriggerEl"
            class="form-select cat-select__trigger"
            type="button"
            aria-label="按分类筛选"
            :aria-expanded="catOpen"
            @click="toggleCatMenu"
          >
            <span class="cat-select__label">{{ categoryFilterLabel }}</span>
          </button>
          <Teleport to="body">
            <div
              v-if="catOpen"
              class="cat-select__menu"
              role="listbox"
              :style="{
                top: `${catMenuPos.top}px`,
                left: `${catMenuPos.left}px`,
                minWidth: `${catMenuPos.width}px`,
              }"
              @click.stop
            >
              <button
                v-for="opt in categoryOptions"
                :key="String(opt.value)"
                class="cat-select__option"
                type="button"
                role="option"
                :aria-selected="categoryFilter === opt.value"
                :class="{ active: categoryFilter === opt.value }"
                @click="pickCategory(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </Teleport>
        </div>
        <div class="seg" role="group" aria-label="按来源筛选">
          <button
            class="seg__btn"
            type="button"
            :class="{ active: sourceFilter === 'all' }"
            @click="sourceFilter = 'all'"
          >
            全部
          </button>
          <button
            class="seg__btn"
            type="button"
            :class="{ active: sourceFilter === 'system' }"
            @click="sourceFilter = 'system'"
          >
            系统
          </button>
          <button
            class="seg__btn"
            type="button"
            :class="{ active: sourceFilter === 'command' }"
            @click="sourceFilter = 'command'"
          >
            指令
          </button>
        </div>
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
        @click="onRowClick(app._id)"
      >
        <button
          class="row-action"
          type="button"
          :disabled="!canAddToCategory"
          :title="
            canAddToCategory
              ? `加入分类「${targetCategoryName}」`
              : '请先在左侧选中一个分类'
          "
          @click.stop="emit('addToCategory', app._id)"
        >
          ←
        </button>
        <input
          class="row-check"
          type="checkbox"
          tabindex="-1"
          :checked="selectedSet.has(app._id)"
          @click.stop
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
          <div
            v-if="categoryTagsFor(app).length || groupTagsFor(app).length"
            class="app-tags"
          >
            <span
              v-for="tag in categoryTagsFor(app)"
              :key="`c-${app._id}-${tag.id}`"
              class="tag tag-cat"
              :title="`分类：${tag.label}`"
            >
              <span class="tag__text">{{ tag.label }}</span>
              <button
                class="tag__x"
                type="button"
                :title="`移出分类「${tag.label}」`"
                @click.stop="emit('removeFromCategory', app._id, tag.id)"
              >
                ×
              </button>
            </span>
            <span
              v-for="tag in groupTagsFor(app)"
              :key="`g-${app._id}-${tag.id}`"
              class="tag tag-group"
              :title="`启动组：${tag.label}`"
            >
              <span class="tag__text">{{ tag.label }}</span>
              <button
                class="tag__x"
                type="button"
                :title="`移出启动组「${tag.label}」`"
                @click.stop="emit('removeFromGroup', app._id, tag.id)"
              >
                ×
              </button>
            </span>
          </div>
        </div>
        <button
          class="btn btn-sm btn-primary row-launch"
          type="button"
          :disabled="busy"
          title="启动"
          @click.stop="emit('launch', app._id)"
        >
          启动
        </button>
        <button
          class="row-action"
          type="button"
          :disabled="!canAddToGroup"
          :title="canAddToGroup ? '加入当前启动组' : '请先在右侧选中一个启动组'"
          @click.stop="emit('addToGroup', app._id)"
        >
          →
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.app-list {
  flex: 1;
  min-width: 0;
  background: var(--surface);
}

.app-list :deep(.panel-header) {
  background: var(--surface);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.cat-select {
  position: relative;
  display: inline-flex;
}

.form-select,
.search-input {
  display: inline-flex;
  align-items: center;
  height: 32px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background-color: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  outline: none;
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.cat-select__trigger {
  appearance: none;
  -webkit-appearance: none;
  padding: 0 2.1rem 0 0.75rem;
  min-width: 132px;
  max-width: 180px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 0.7rem center;
  background-size: 12px 9px;
  text-align: left;
}

.cat-select__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-select__trigger:hover,
.search-input:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.cat-select__trigger:focus,
.cat-select__trigger[aria-expanded='true'],
.search-input:focus {
  border-color: color-mix(in srgb, var(--accent) 70%, #86b7fe);
  box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--accent) 22%, transparent);
}

.search-input {
  padding: 0 0.75rem;
  min-width: 150px;
  display: inline-block;
}

.app-row {
  cursor: pointer;
  user-select: none;
  gap: 6px;
}

.row-check {
  pointer-events: none;
  flex-shrink: 0;
}

.row-launch {
  flex-shrink: 0;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

.row-action {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  transition:
    background var(--ease),
    color var(--ease),
    border-color var(--ease);
}

.row-action:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--selected-border);
  background: var(--selected);
}

.row-action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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

.app-path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 140px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  padding: 2px 4px 2px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.tag__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag__x {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  opacity: 0.65;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.tag__x:hover {
  opacity: 1;
  background: color-mix(in srgb, currentColor 16%, transparent);
}

.tag-cat {
  color: var(--badge-fg);
  background: var(--badge-bg);
  border-color: var(--selected-border);
}

.tag-group {
  color: var(--tag-group-fg);
  background: var(--tag-group-bg);
  border-color: var(--tag-group-border);
}
</style>
