<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { Icon } from '@iconify/vue'
import type { LayerContextMenuAction, LayerContextMenuItem, LayerContextMenuRowAction } from '../types'

type ActionItem = Extract<LayerContextMenuItem, { key: LayerContextMenuAction }>
type IconRowItem = Extract<LayerContextMenuItem, { type: 'icon-row' }>

const props = withDefaults(defineProps<{
  show: boolean
  x: number
  y: number
  menuItems: LayerContextMenuItem[]
  zIndex?: number
}>(), {
  zIndex: 10000
})

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'select', key: LayerContextMenuAction): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<CSSProperties>({})

/**
 * 排序类动作不关闭菜单，便于连续调整层级；其余动作选中后即关闭。
 */
const KEEP_OPEN_ACTIONS = new Set<LayerContextMenuAction>([
  'move-up',
  'move-top',
  'move-down',
  'move-bottom'
])

function close() {
  emit('update:show', false)
}

function isSeparator(item: LayerContextMenuItem): item is Extract<LayerContextMenuItem, { type: 'separator' }> {
  return item.type === 'separator'
}

function isIconRow(item: LayerContextMenuItem): item is IconRowItem {
  return item.type === 'icon-row'
}

/**
 * 将菜单面板定位到光标位置，并在超出视口时回拉，避免被裁切。
 */
function positionPanel() {
  const panel = panelRef.value
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const padding = 8
  let left = props.x
  let top = props.y
  if (left + rect.width + padding > window.innerWidth) {
    left = Math.max(padding, window.innerWidth - rect.width - padding)
  }
  if (top + rect.height + padding > window.innerHeight) {
    top = Math.max(padding, window.innerHeight - rect.height - padding)
  }
  panelStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    zIndex: props.zIndex
  }
}

watch(
  () => [props.show, props.x, props.y] as const,
  () => {
    if (!props.show) return
    nextTick(() => {
      positionPanel()
      panelRef.value?.focus({ preventScroll: true })
    })
  },
  { immediate: true }
)

function handleItemSelect(item: ActionItem) {
  if (item.disabled) return
  emit('select', item.key)
  if (!KEEP_OPEN_ACTIONS.has(item.key)) close()
}

function handleRowAction(action: LayerContextMenuRowAction) {
  if (action.disabled) return
  emit('select', action.key)
  if (!KEEP_OPEN_ACTIONS.has(action.key)) close()
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!props.show) return
  if (panelRef.value?.contains(event.target as Node)) return
  close()
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (!props.show) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

const hasAnyIcon = computed(() =>
  props.menuItems.some((item) => 'icon' in item && item.icon)
)

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('keydown', handleDocumentKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('keydown', handleDocumentKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="layer-context-menu">
      <div
        v-if="show"
        ref="panelRef"
        class="layer-context-menu"
        :style="panelStyle"
        role="menu"
        tabindex="-1"
      >
        <template v-for="(item, index) in menuItems" :key="index">
          <div v-if="isSeparator(item)" class="layer-context-menu__separator" role="separator"></div>
          <div v-else-if="isIconRow(item)" class="layer-context-menu__icon-row">
            <button
              v-for="action in item.actions"
              :key="action.key"
              type="button"
              class="layer-context-menu__icon-btn"
              :class="{ 'is-disabled': action.disabled }"
              :title="action.title"
              :disabled="action.disabled"
              @click="handleRowAction(action)"
            >
              <Icon :icon="action.icon" />
            </button>
          </div>
          <div
            v-else
            class="layer-context-menu__item"
            :class="{ 'is-disabled': item.disabled, 'is-danger': item.danger }"
            role="menuitem"
            :aria-disabled="item.disabled ? 'true' : undefined"
            @click="handleItemSelect(item)"
          >
            <span v-if="item.icon" class="layer-context-menu__item-icon"><Icon :icon="item.icon" /></span>
            <span v-else-if="hasAnyIcon" class="layer-context-menu__item-icon"></span>
            <span class="layer-context-menu__item-label">{{ item.label }}</span>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.layer-context-menu {
  min-width: 180px;
  max-width: min(280px, calc(100vw - 16px));
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  backdrop-filter: blur(100px) saturate(200%) brightness(110%);
  -webkit-backdrop-filter: blur(100px) saturate(200%) brightness(110%);
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 4px 0;
  outline: none;
}

:global(html.dark) .layer-context-menu {
  background: rgba(48, 48, 48, 0.98);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.layer-context-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
  line-height: 20px;
}

.layer-context-menu__item:hover {
  background: var(--hover-bg);
}

.layer-context-menu__item.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.layer-context-menu__item.is-disabled:hover {
  background: transparent;
}

.layer-context-menu__item.is-danger {
  color: var(--danger-color, #ef4444);
}

.layer-context-menu__item.is-danger:hover {
  background: var(--danger-light-bg, rgba(239, 68, 68, 0.1));
}

.layer-context-menu__item-icon {
  flex-shrink: 0;
  opacity: 0.8;
  font-size: 14px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.layer-context-menu__item-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.layer-context-menu__icon-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.layer-context-menu__icon-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color);
  font-size: 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.layer-context-menu__icon-btn:hover {
  background: var(--hover-bg);
}

.layer-context-menu__icon-btn.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.layer-context-menu__icon-btn.is-disabled:hover {
  background: transparent;
}

.layer-context-menu__separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--control-border);
}

.layer-context-menu-enter-active {
  animation: layer-context-menu-in 0.15s ease-out;
}

.layer-context-menu-leave-active {
  animation: layer-context-menu-out 0.1s ease-in;
}

@keyframes layer-context-menu-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes layer-context-menu-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}
</style>
