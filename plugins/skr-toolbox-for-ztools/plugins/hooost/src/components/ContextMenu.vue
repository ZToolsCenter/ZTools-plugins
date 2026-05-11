<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

export interface ContextMenuItem {
  label: string
  value: string
  icon?: string
  danger?: boolean
  disabled?: boolean
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  close: []
  select: [value: string]
}>()

const menuRef = ref<HTMLElement | null>(null)
const adjustedX = ref(0)
const adjustedY = ref(0)

function adjustPosition() {
  if (!props.visible || !menuRef.value) return
  const menu = menuRef.value
  const rect = menu.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  adjustedX.value = props.x + 2
  adjustedY.value = props.y + 2

  if (adjustedX.value + rect.width > vw) {
    adjustedX.value = vw - rect.width - 4
  }
  if (adjustedY.value + rect.height > vh) {
    adjustedY.value = vh - rect.height - 4
  }
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      adjustedX.value = props.x + 2
      adjustedY.value = props.y + 2
      nextTick(adjustPosition)
    }
  }
)

function onClickOutside(e: MouseEvent) {
  if (!props.visible) return
  if (menuRef.value && menuRef.value.contains(e.target as Node)) return
  emit('close')
}

function onContextMenuOutside(e: MouseEvent) {
  if (!props.visible) return
  e.preventDefault()
  emit('close')
}

function onItemSelect(item: ContextMenuItem) {
  if (item.disabled) return
  emit('select', item.value)
}

onMounted(() => {
  document.addEventListener('click', onClickOutside, true)
  document.addEventListener('contextmenu', onContextMenuOutside, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside, true)
  document.removeEventListener('contextmenu', onContextMenuOutside, true)
})
</script>

<template>
  <Transition name="ctx-menu">
    <div
      v-if="visible"
      ref="menuRef"
      class="ctx-menu"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
      @contextmenu.prevent
    >
      <ul class="ctx-menu-list">
        <li
          v-for="item in items"
          :key="item.value"
          :class="[
            'ctx-menu-item',
            { 'ctx-menu-item--danger': item.danger },
            { 'ctx-menu-item--disabled': item.disabled },
          ]"
          @click="onItemSelect(item)"
        >
          <span v-if="item.icon" class="ctx-menu-item-icon">{{ item.icon }}</span>
          <span class="ctx-menu-item-label">{{ item.label }}</span>
        </li>
      </ul>
    </div>
  </Transition>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  border-radius: 6px;
  background: var(--bg-color, #f4f4f4);
  border: 1px solid var(--border-color, #e5e7eb);
  box-shadow: 0 4px 12px var(--shadow-color, rgba(0, 0, 0, 0.1));
  padding: 4px 0;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.ctx-menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-color, #333);
  transition: background 0.15s;
}

.ctx-menu-item:hover:not(.ctx-menu-item--disabled) {
  background: var(--hover-bg, #f9fafb);
}

.ctx-menu-item--danger {
  color: var(--danger-color, #ef4444);
}

.ctx-menu-item--danger:hover:not(.ctx-menu-item--disabled) {
  background: var(--danger-light-bg, #fee2e2);
}

.ctx-menu-item--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ctx-menu-item-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.ctx-menu-item-label {
  white-space: nowrap;
}

/* Transition */
.ctx-menu-enter-active,
.ctx-menu-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.ctx-menu-enter-from,
.ctx-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
