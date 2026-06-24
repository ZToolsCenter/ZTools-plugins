<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

export interface QuickSwitcherItem {
  id: string
  label: string
  subtitle?: string
  count?: number
}

const props = withDefaults(defineProps<{
  items: QuickSwitcherItem[]
  selectedId: string | null
  placeholder?: string
  addLabel?: string
  showAdd?: boolean
}>(), {
  placeholder: '搜索...',
  addLabel: '添加',
  showAdd: false,
})

const emit = defineEmits<{
  select: [id: string]
  add: []
}>()

const isOpen = ref(false)
const search = ref('')
const highlightIndex = ref(0)
const triggerRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)

const panelStyle = ref({
  top: '0px',
  left: '0px',
  minWidth: '320px',
})

const filteredItems = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return props.items
  return props.items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      (item.subtitle || '').toLowerCase().includes(q),
  )
})

watch(isOpen, (v) => {
  if (v) {
    highlightIndex.value = 0
    search.value = ''
    nextTick(() => {
      const trigger = triggerRef.value
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        panelStyle.value = {
          top: `${rect.bottom + 4}px`,
          left: `${rect.left}px`,
          minWidth: `${Math.max(rect.width, 320)}px`,
        }
      }
      inputRef.value?.focus()
    })
  }
})

watch(filteredItems, () => {
  highlightIndex.value = 0
})

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown)
})

function handleClickOutside(e: MouseEvent) {
  if (!isOpen.value) return
  if (!(e.target as HTMLElement).closest('.quick-switcher')) {
    isOpen.value = false
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    if (props.items.length > 0) {
      e.preventDefault()
      isOpen.value = !isOpen.value
    }
    return
  }
  if (!isOpen.value) return
  switch (e.key) {
    case 'Escape':
      isOpen.value = false
      break
    case 'ArrowDown':
      e.preventDefault()
      if (filteredItems.value.length > 0) {
        highlightIndex.value = Math.min(highlightIndex.value + 1, filteredItems.value.length - 1)
        scrollToHighlight()
      }
      break
    case 'ArrowUp':
      e.preventDefault()
      if (filteredItems.value.length > 0) {
        highlightIndex.value = Math.max(highlightIndex.value - 1, 0)
        scrollToHighlight()
      }
      break
    case 'Enter':
      e.preventDefault()
      const item = filteredItems.value[highlightIndex.value]
      if (item) {
        emit('select', item.id)
        isOpen.value = false
      }
      break
  }
}

function scrollToHighlight() {
  nextTick(() => {
    if (!listRef.value) return
    const items = listRef.value.querySelectorAll('.qs-item')
    const target = items[highlightIndex.value] as HTMLElement | undefined
    target?.scrollIntoView({ block: 'nearest' })
  })
}

const selectedItem = computed(() => props.items.find((i) => i.id === props.selectedId))

function toggle() {
  if (props.items.length > 0) {
    isOpen.value = !isOpen.value
  }
}

function select(id: string) {
  isOpen.value = false
  emit('select', id)
}
</script>

<template>
  <div class="quick-switcher" :class="{ open: isOpen }">
    <button
      ref="triggerRef"
      class="qs-trigger"
      :class="{ disabled: !items.length }"
      @click="toggle"
    >
      <slot name="trigger-prefix" :item="selectedItem">
        <span class="qs-trigger-avatar">{{ selectedItem ? selectedItem.label.charAt(0).toUpperCase() : '?' }}</span>
      </slot>
      <span class="qs-trigger-label">{{ selectedItem ? selectedItem.label : (items.length ? '选择...' : '无项目') }}</span>
      <span class="qs-trigger-subtitle" v-if="selectedItem?.subtitle">{{ selectedItem.subtitle }}</span>
      <svg
        class="qs-chevron"
        :class="{ open: isOpen }"
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div v-show="isOpen" class="qs-panel" :style="panelStyle">
      <div class="qs-search-wrap">
        <svg class="qs-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref="inputRef"
          v-model="search"
          type="text"
          class="qs-search"
          :placeholder="placeholder"
        />
        <kbd class="qs-kbd">⌘K</kbd>
      </div>

      <div ref="listRef" class="qs-list">
        <div v-if="!filteredItems.length && !showAdd" class="qs-empty">
          {{ search ? '未找到匹配项' : (items.length ? '' : '暂无项目') }}
        </div>
        <button
          v-for="(item, i) in filteredItems"
          :key="item.id"
          class="qs-item"
          :class="{ highlighted: highlightIndex === i, selected: item.id === selectedId }"
          @click="select(item.id)"
          @mouseenter="highlightIndex = i"
        >
          <slot name="item-prefix" :item="item">
            <span class="qs-item-avatar">{{ item.label.charAt(0).toUpperCase() }}</span>
          </slot>
          <div class="qs-item-body">
            <div class="qs-item-label">{{ item.label }}</div>
            <div v-if="item.subtitle" class="qs-item-subtitle">{{ item.subtitle }}</div>
          </div>
            <div class="qs-item-right">
              <span v-if="item.count != null" class="qs-item-count">{{ item.count }}</span>
              <svg v-if="item.id === selectedId" class="qs-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </button>
        <button v-if="showAdd" class="qs-item qs-add-item" @click="emit('add'); isOpen = false">
          <span class="qs-item-avatar qs-add-avatar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div class="qs-item-body">
            <div class="qs-item-label">{{ addLabel }}</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-switcher {
  position: relative;
}

.qs-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 10px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  width: 100%;
}

.qs-trigger:hover {
  border-color: hsl(var(--primary) / 0.4);
  background: hsl(var(--accent));
}

.qs-trigger.disabled {
  opacity: 0.5;
  cursor: default;
}

.qs-trigger-avatar {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
  flex-shrink: 0;
}

.qs-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qs-trigger-subtitle {
  font-size: 11px;
  font-weight: 400;
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
  margin-left: 2px;
}

.qs-chevron {
  margin-left: auto;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
  transition: transform var(--duration-base) var(--ease-standard);
}

.qs-chevron.open {
  transform: rotate(180deg);
}

/* Panel */
.qs-panel {
  position: fixed;
  z-index: 1001;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  box-shadow: 0 12px 48px hsl(0 0% 0% / 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 360px;
}

/* Search */
.qs-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid hsl(var(--border));
  flex-shrink: 0;
}

.qs-search-icon {
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}

.qs-search {
  flex: 1;
  border: none;
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 14px;
  outline: none;
  font-family: inherit;
}

.qs-search::placeholder {
  color: hsl(var(--muted-foreground));
}

.qs-kbd {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-family: inherit;
  flex-shrink: 0;
}

/* List */
.qs-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px;
}

.qs-empty {
  padding: 20px 14px;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

.qs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-quick) var(--ease-standard);
  font-family: inherit;
}

.qs-item.highlighted {
  background: hsl(var(--accent));
}

.qs-item.selected {
  background: hsl(var(--primary) / 0.06);
}

.qs-item-avatar {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
  flex-shrink: 0;
}

.qs-item-body {
  flex: 1;
  min-width: 0;
}

.qs-item-label {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qs-item-subtitle {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.qs-item-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.qs-item-count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: 6px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.qs-item-check {
  color: hsl(var(--primary));
}

.qs-add-item {
  margin-top: 2px;
  border: 1px dashed hsl(var(--border));
  color: hsl(var(--muted-foreground));
}

.qs-add-item:hover {
  border-color: hsl(var(--primary) / 0.4);
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.04);
}

.qs-add-avatar {
  border: 1px dashed hsl(var(--border));
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qs-add-item:hover .qs-add-avatar {
  border-color: hsl(var(--primary) / 0.4);
}
</style>
