<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Environment } from '@/types/hosts'
import { VueDraggable } from 'vue-draggable-plus'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem } from './ContextMenu.vue'

const props = defineProps<{
  environments: Environment[]
  activeEnvironmentIds: string[]
  selectedEnvironmentId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  apply: [id: string]
  deactivate: [id: string]
  delete: [id: string]
  create: []
  reorder: [orderedIds: string[]]
}>()

const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuEnv = ref<Environment | null>(null)

const publicEnvironments = computed(() => props.environments.filter((env) => env.type === 'public'))
const managedEnvironments = computed(() =>
  props.environments.filter((env) => env.type === 'custom')
)

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const env = contextMenuEnv.value
  if (!env || env.type === 'public') return []
  const items: ContextMenuItem[] = []
  if (props.activeEnvironmentIds.includes(env.id)) {
    items.push({ label: '停用此配置', value: 'deactivate' })
  } else {
    items.push({ label: '启用此配置', value: 'apply' })
  }
  items.push({ label: '删除此配置', value: 'delete', danger: true })
  return items
})

function onItemDoubleClick(env: Environment) {
  if (env.type === 'public') return
  if (props.activeEnvironmentIds.includes(env.id)) {
    emit('deactivate', env.id)
    return
  }
  emit('apply', env.id)
}

function onContextMenu(event: MouseEvent, env: Environment) {
  if (env.type === 'public') return
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuEnv.value = env
  contextMenuVisible.value = true
}

function onContextMenuSelect(value: string) {
  contextMenuVisible.value = false
  const env = contextMenuEnv.value
  if (!env) return
  if (value === 'apply') emit('apply', env.id)
  else if (value === 'deactivate') emit('deactivate', env.id)
  else if (value === 'delete') emit('delete', env.id)
}

function onContextMenuClose() {
  contextMenuVisible.value = false
}

function onManagedOrderChange(value: Environment[]) {
  emit(
    'reorder',
    value.map((env) => env.id)
  )
}

function getItemClasses(env: Environment) {
  return [
    { 'env-item--selected': env.id === props.selectedEnvironmentId },
    { 'env-item--active': props.activeEnvironmentIds.includes(env.id) },
  ]
}
</script>

<template>
  <aside class="env-list">
    <div class="env-list-header">实际配置</div>
    <div
      v-for="env in publicEnvironments"
      :key="env.id"
      class="env-item"
      :class="getItemClasses(env)"
      @click="emit('select', env.id)"
      @dblclick="onItemDoubleClick(env)"
      @contextmenu.prevent="onContextMenu($event, env)"
    >
      <span class="env-item-leading">
        <span class="env-item-status"></span>
      </span>
      <span class="env-item-name">{{ env.name }}</span>
      <span v-if="env.editMode === 'source'" class="env-item-badge">源码</span>
      <span v-else class="env-item-count">{{
        env.lines.filter((l) => l.type === 'host' && l.enabled).length
      }}</span>
    </div>

    <div class="env-list-section-header env-list-header--section">
      <div class="env-list-header">配置列表</div>
      <button class="env-list-add" type="button" @click="emit('create')">新增</button>
    </div>

    <VueDraggable
      class="env-list-items env-list-draggable"
      tag="div"
      :model-value="managedEnvironments"
      :animation="150"
      chosen-class="env-item--dragging"
      ghost-class="env-item--ghost"
      @update:model-value="onManagedOrderChange"
    >
      <div
        v-for="env in managedEnvironments"
        :key="env.id"
        class="env-item env-item--sortable"
        :class="getItemClasses(env)"
        @click="emit('select', env.id)"
        @dblclick="onItemDoubleClick(env)"
        @contextmenu.prevent="onContextMenu($event, env)"
      >
        <span class="env-item-leading">
          <span class="env-item-handle i-z-order" title="拖拽排序"></span>
          <span class="env-item-status"></span>
        </span>
        <span class="env-item-name">{{ env.name }}</span>
        <span class="env-item-count">{{
          env.lines.filter((l) => l.type === 'host' && l.enabled).length
        }}</span>
      </div>
    </VueDraggable>

    <ContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :items="contextMenuItems"
      @close="onContextMenuClose"
      @select="onContextMenuSelect"
    />
  </aside>
</template>

<style scoped>
.env-list {
  width: 200px;
  border-right: 1px solid var(--divider-color);
  padding: 12px 8px;
  overflow-y: auto;
  height: 100%;
  flex-shrink: 0;
}

.env-list-header {
  padding: 0 12px 10px;
  font-weight: 600;
  font-size: 12px;
  color: var(--text-color-secondary, #888);
}

.env-list-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 10px;
}

.env-list-header--section {
  padding-top: 10px;
}

.env-list-section-header .env-list-header {
  padding: 0;
}

.env-list-add {
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.env-list-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.env-item {
  position: relative;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 10px;
  margin-bottom: 6px;
  cursor: default;
  transition: all 0.2s;
  color: var(--text-color);
  border-radius: 8px;
}

.env-item:last-child {
  margin-bottom: 0;
}

.env-item:hover {
  background: var(--hover-bg);
}

.env-item--selected {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.env-item--dragging {
  opacity: 0.55;
}

.env-item--ghost {
  opacity: 0.35;
}

.env-item-leading {
  position: relative;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.env-item-status {
  position: absolute;
  inset: 50% auto auto 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: transparent;
  box-shadow: none;
  transform: translate(-50%, -50%);
  transition: opacity 0.15s;
}

.env-item--active .env-item-status {
  background-color: var(--primary-color);
  box-shadow: 0 0 6px var(--primary-color);
}

.env-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-item-count,
.env-item-badge {
  font-size: 11px;
  font-weight: 500;
  color: inherit;
  flex-shrink: 0;
}

.env-item-badge {
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-color-secondary, #f0f0f0);
}

.env-item--selected .env-item-badge {
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.env-item-handle {
  position: absolute;
  inset: 0;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-color-secondary, #888);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s,
    color 0.15s;
}

.env-item--sortable:hover .env-item-handle,
.env-item--sortable.env-item--dragging .env-item-handle,
.env-item--sortable.env-item--ghost .env-item-handle {
  opacity: 1;
}

.env-item--sortable:hover .env-item-status,
.env-item--sortable.env-item--dragging .env-item-status,
.env-item--sortable.env-item--ghost .env-item-status {
  opacity: 0;
}

.env-item--sortable:hover .env-item-handle,
.env-item--sortable.env-item--dragging .env-item-handle {
  color: var(--primary-color);
}
</style>
