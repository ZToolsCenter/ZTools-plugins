<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { TagDropdownMenuEmits, TagDropdownMenuProps, TagDropdownMenuItem } from '@/components'

defineProps<TagDropdownMenuProps>()

const emit = defineEmits<TagDropdownMenuEmits>()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement>()
const menuStyle = ref<Record<string, string>>({})

// 全局自定义事件名，用于互斥关闭其他下拉菜单
const CLOSE_EVENT = 'tag-dropdown:close-all'

function updateMenuPosition(): void {
  const rect = dropdownRef.value?.getBoundingClientRect()
  if (!rect) return

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const menuWidth = 160 // 预估菜单宽度
  const menuHeight = 120 // 预估菜单高度
  const gap = 4

  // 水平位置：默认左对齐，右侧不够则右对齐
  let left: number
  if (rect.left + menuWidth > viewportWidth) {
    left = rect.right - menuWidth
  } else {
    left = rect.left
  }

  // 垂直位置：默认在下方，下方不够则在上方
  let top: number
  if (rect.bottom + gap + menuHeight > viewportHeight) {
    top = rect.top - gap - menuHeight
  } else {
    top = rect.bottom + gap
  }

  menuStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    zIndex: '10000',
  }
}

function toggleDropdown(event: MouseEvent): void {
  event.stopPropagation()

  if (isOpen.value) {
    isOpen.value = false
    return
  }

  // 先关闭其他所有下拉菜单
  document.dispatchEvent(new CustomEvent(CLOSE_EVENT))

  // 再打开当前菜单
  isOpen.value = true
  updateMenuPosition()
}

function handleItemClick(item: TagDropdownMenuItem): void {
  emit('select', item.key)
  isOpen.value = false
}

function handleClickOutside(event: MouseEvent): void {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

function handleCloseAll(): void {
  isOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener(CLOSE_EVENT, handleCloseAll)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener(CLOSE_EVENT, handleCloseAll)
})
</script>
<template>
  <div ref="dropdownRef" class="tag-dropdown" :class="{ open: isOpen }">
    <div class="tag-wrapper" @click="toggleDropdown">
      <slot></slot>
    </div>

    <Teleport to="body">
      <Transition name="dropdown-menu">
        <div v-if="isOpen" class="dropdown-menu" :style="menuStyle" @click.stop>
          <div
            v-for="item in menuItems"
            :key="item.key"
            class="dropdown-item"
            :class="{ danger: item.danger }"
            @click="handleItemClick(item)"
          >
            <div :class="item.icon" class="font-size-14px item-icon" />
            <span class="item-label">{{ item.label }}</span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.tag-dropdown {
  position: relative;
  display: inline-block;
}

.tag-wrapper {
  cursor: pointer;
}
</style>

<style>
/* Teleport 到 body 后不能用 scoped，使用全局样式 */
.dropdown-menu {
  min-width: 100px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  backdrop-filter: blur(100px) saturate(200%) brightness(110%);
  -webkit-backdrop-filter: blur(100px) saturate(200%) brightness(110%);
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* 暗色模式 */
@media (prefers-color-scheme: dark) {
  .dropdown-menu {
    background: rgba(48, 48, 48, 0.98);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.dropdown-item:hover {
  background: var(--hover-bg);
}

.dropdown-item.danger {
  color: var(--danger-color, #ef4444);
}

.dropdown-item.danger:hover {
  background: var(--danger-light-bg, rgba(239, 68, 68, 0.1));
}

.dropdown-item .item-icon {
  flex-shrink: 0;
  opacity: 0.8;
}

.dropdown-item .item-label {
  flex: 1;
  white-space: nowrap;
}

/* 下拉菜单动画 */
.dropdown-menu-enter-active {
  animation: dropdown-in 0.15s ease-out;
}

.dropdown-menu-leave-active {
  animation: dropdown-out 0.1s ease-in;
}

@keyframes dropdown-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes dropdown-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
