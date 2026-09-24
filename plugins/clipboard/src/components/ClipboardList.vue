<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import TextItem from './items/TextItem.vue'
import ImageItem from './items/ImageItem.vue'
import FileItem from './items/FileItem.vue'

const props = defineProps({
  items: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  loadingMore: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: true },
  activeIndex: { type: Number, default: -1 },
  selectedItems: { type: Set, default: () => new Set() },
  activeTab: { type: String, required: true },
  expandedItems: { type: Set, default: () => new Set() },
  needsExpand: { type: Object, default: () => ({}) },
  isTextMasked: { type: Boolean, default: false }
})

const emit = defineEmits([
  'select',
  'dblclick',
  'contextmenu',
  'scroll',
  'toggle-expand',
  'delete-favorite',
  'toggle-selection',
  'reorder-favorite'
])

const listRef = ref(null)
const draggedIndex = ref(null)
const dropTargetIndex = ref(null)
const dropPosition = ref(null)
const canReorder = computed(() => props.activeTab === 'favorite' && props.items.length > 1)

let autoScrollFrame = null
let autoScrollDirection = 0
let favoriteKeySeed = 0
const favoriteKeys = new WeakMap()

const getItemKey = (item, index) => {
  if (props.activeTab === 'favorite') {
    if (!favoriteKeys.has(item)) {
      favoriteKeys.set(item, `favorite-${favoriteKeySeed++}`)
    }
    return favoriteKeys.get(item)
  }
  return item.id ?? index
}

const stopAutoScroll = () => {
  autoScrollDirection = 0
  if (autoScrollFrame !== null) {
    cancelAnimationFrame(autoScrollFrame)
    autoScrollFrame = null
  }
}

const runAutoScroll = () => {
  if (!autoScrollDirection || !listRef.value) {
    autoScrollFrame = null
    return
  }

  listRef.value.scrollTop += autoScrollDirection * 10
  autoScrollFrame = requestAnimationFrame(runAutoScroll)
}

const updateAutoScroll = (clientY) => {
  if (!listRef.value) return

  const rect = listRef.value.getBoundingClientRect()
  const threshold = Math.min(48, rect.height / 4)
  let nextDirection = 0

  if (clientY < rect.top + threshold) {
    nextDirection = -1
  } else if (clientY > rect.bottom - threshold) {
    nextDirection = 1
  }

  if (nextDirection === autoScrollDirection) return
  stopAutoScroll()
  autoScrollDirection = nextDirection

  if (autoScrollDirection) {
    autoScrollFrame = requestAnimationFrame(runAutoScroll)
  }
}

const resetDragState = () => {
  draggedIndex.value = null
  dropTargetIndex.value = null
  dropPosition.value = null
  stopAutoScroll()
}

const handleDragStart = (event, index) => {
  if (!canReorder.value) {
    event.preventDefault()
    return
  }

  draggedIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))

  const itemElement = event.currentTarget.closest('.clipboard-item')
  if (itemElement) {
    event.dataTransfer.setDragImage(itemElement, 20, 20)
  }
}

const handleDragOver = (event, index) => {
  if (draggedIndex.value === null) return

  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'

  const rect = event.currentTarget.getBoundingClientRect()
  dropTargetIndex.value = index
  dropPosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

const handleListDragOver = (event) => {
  if (draggedIndex.value === null) return
  event.preventDefault()
  updateAutoScroll(event.clientY)
}

const handleListDragLeave = (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    stopAutoScroll()
  }
}

const moveWithKeyboard = (index, offset) => {
  const toIndex = index + offset
  if (!canReorder.value || toIndex < 0 || toIndex >= props.items.length) return
  emit('reorder-favorite', { fromIndex: index, toIndex })
}

const handleDrop = (event) => {
  event.preventDefault()
  event.stopPropagation()

  const fromIndex = draggedIndex.value
  if (fromIndex === null || dropTargetIndex.value === null) {
    resetDragState()
    return
  }

  let toIndex = dropTargetIndex.value + (dropPosition.value === 'after' ? 1 : 0)
  if (fromIndex < toIndex) {
    toIndex--
  }
  toIndex = Math.max(0, Math.min(props.items.length - 1, toIndex))

  if (fromIndex !== toIndex) {
    emit('reorder-favorite', { fromIndex, toIndex })
  }

  resetDragState()
}

watch(() => props.activeTab, resetDragState)
onBeforeUnmount(resetDragState)
</script>

<template>
  <div
    ref="listRef"
    class="clipboard-list"
    role="listbox"
    aria-multiselectable="true"
    @scroll="emit('scroll', $event)"
    @dragover="handleListDragOver"
    @dragleave="handleListDragLeave"
    @drop="handleDrop"
  >
    <!-- 空状态 -->
    <div v-if="!loading && items.length === 0" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="9" y1="12" x2="15" y2="12"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="9" y1="16" x2="13" y2="16"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="empty-text">暂无剪贴板记录</div>
    </div>

    <!-- 列表项 -->
    <div
      v-for="(item, index) in items"
      :key="getItemKey(item, index)"
      class="clipboard-item"
      :class="{
        selected: selectedItems.has(item),
        active: activeIndex === index,
        'is-sortable': canReorder,
        'is-dragging': draggedIndex === index,
        'drop-before': dropTargetIndex === index && dropPosition === 'before',
        'drop-after': dropTargetIndex === index && dropPosition === 'after'
      }"
      role="option"
      :aria-selected="selectedItems.has(item)"
      @click="emit('select', $event, index)"
      @dblclick="emit('dblclick', index)"
      @contextmenu="emit('contextmenu', $event, item, index)"
      @dragover="handleDragOver($event, index)"
      @drop="handleDrop"
    >
      <input
        class="selection-checkbox"
        type="checkbox"
        :checked="selectedItems.has(item)"
        :aria-label="`选择第 ${index + 1} 条记录`"
        @click.stop="emit('toggle-selection', $event, index)"
        @dblclick.stop
        @keydown.space.stop
      />
      <button
        v-if="canReorder"
        class="drag-handle"
        draggable="true"
        type="button"
        title="拖动排序"
        aria-label="拖动排序"
        @click.stop
        @dblclick.stop
        @dragstart.stop="handleDragStart($event, index)"
        @dragend.stop="resetDragState"
        @keydown.up.prevent.stop="moveWithKeyboard(index, -1)"
        @keydown.down.prevent.stop="moveWithKeyboard(index, 1)"
      >
        <svg viewBox="0 0 16 20" aria-hidden="true">
          <circle cx="5" cy="4" r="1.2" fill="currentColor" />
          <circle cx="11" cy="4" r="1.2" fill="currentColor" />
          <circle cx="5" cy="10" r="1.2" fill="currentColor" />
          <circle cx="11" cy="10" r="1.2" fill="currentColor" />
          <circle cx="5" cy="16" r="1.2" fill="currentColor" />
          <circle cx="11" cy="16" r="1.2" fill="currentColor" />
        </svg>
      </button>
      <TextItem
        v-if="item.type === 'text'"
        :item="item"
        :is-expanded="expandedItems.has(item.id)"
        :needs-expand="!!needsExpand[item.id]"
        :is-favorite-tab="activeTab === 'favorite'"
        :is-text-masked="isTextMasked"
        @toggle-expand="emit('toggle-expand', item.id)"
        @delete-favorite="emit('delete-favorite', index)"
      />
      <ImageItem
        v-else-if="item.type === 'image'"
        :item="item"
        :is-favorite-tab="activeTab === 'favorite'"
        @delete-favorite="emit('delete-favorite', index)"
      />
      <FileItem
        v-else-if="item.type === 'file'"
        :item="item"
        :is-expanded="expandedItems.has(item.id)"
        :is-favorite-tab="activeTab === 'favorite'"
        @toggle-expand="emit('toggle-expand', item.id)"
        @delete-favorite="emit('delete-favorite', index)"
      />
    </div>

    <!-- 加载更多状态 -->
    <div v-if="loadingMore" class="loading-more">
      <div class="loading-more-spinner"></div>
      <span class="loading-more-text">加载更多...</span>
    </div>
  </div>
</template>

<style scoped>
.clipboard-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  background: var(--bg-surface);
}

.empty-icon {
  width: 48px;
  height: 48px;
  color: var(--text-tertiary);
  opacity: 0.3;
  margin-bottom: 16px;
}

.empty-icon svg {
  width: 100%;
  height: 100%;
}

.empty-text {
  color: var(--text-tertiary);
  font-size: 14px;
}

.clipboard-item {
  position: relative;
  padding-left: 30px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.clipboard-item.is-sortable {
  padding-left: 56px;
}

.clipboard-item.is-dragging {
  opacity: 0.4;
}

.clipboard-item.drop-before::before,
.clipboard-item.drop-after::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  height: 2px;
  background: var(--primary-color);
  z-index: 2;
  pointer-events: none;
}

.clipboard-item.drop-before::before {
  top: -1px;
}

.clipboard-item.drop-after::after {
  bottom: -1px;
}

.drag-handle {
  position: absolute;
  top: 50%;
  left: 30px;
  width: 24px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: grab;
  z-index: 1;
}

.drag-handle:hover {
  color: var(--primary-color);
  background: var(--bg-accent-light);
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}

.drag-handle svg {
  width: 16px;
  height: 20px;
}

.selection-checkbox {
  position: absolute;
  top: 50%;
  left: 7px;
  width: 16px;
  height: 16px;
  margin: 0;
  transform: translateY(-50%);
  accent-color: var(--primary-color);
  cursor: pointer;
  z-index: 2;
}

.clipboard-item:hover {
  background: var(--bg-hover);
}

@media (prefers-color-scheme: dark) {
  .clipboard-item:hover {
    background: rgba(72, 72, 72, 0.72);
  }
}

.clipboard-item.selected {
  background: var(--bg-accent-light);
}

.clipboard-item.selected:hover {
  background: var(--bg-accent-light);
}

.clipboard-item.active {
  box-shadow: inset 0 0 0 2px var(--primary-color);
  border-radius: 5px;
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.loading-more-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--spinner-bg);
  border-top: 2px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-more-text {
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
