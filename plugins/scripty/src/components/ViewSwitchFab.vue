<script setup lang="ts">
import { h } from 'vue'

const props = defineProps<{
  modelValue: 'list' | 'tree'
}>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: 'list' | 'tree'): void
}>()

/** Inline SVGs copied from ztools-ui/assets/icons so they theme via currentColor with no new dependency. */
const ListIcon = () =>
  h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, [
    h('path', { d: 'M8 6H21', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M8 12H21', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M8 18H21', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M3 6H3.01', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M3 12H3.01', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M3 18H3.01', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  ])

const FolderIcon = () =>
  h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, [
    h('path', {
      d: 'M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z',
      stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    })
  ])
</script>

<template>
  <div class="view-switch-fab" role="group" aria-label="脚本视图切换">
    <button
      type="button"
      class="view-switch-fab__btn"
      :class="{ 'view-switch-fab__btn--active': props.modelValue === 'list' }"
      :aria-pressed="props.modelValue === 'list'"
      aria-label="列表视图"
      title="列表视图"
      @click="emit('update:modelValue', 'list')"
    >
      <ListIcon />
    </button>
    <button
      type="button"
      class="view-switch-fab__btn"
      :class="{ 'view-switch-fab__btn--active': props.modelValue === 'tree' }"
      :aria-pressed="props.modelValue === 'tree'"
      aria-label="文件树视图"
      title="文件树视图"
      @click="emit('update:modelValue', 'tree')"
    >
      <FolderIcon />
    </button>
  </div>
</template>

<style scoped lang="scss">
.view-switch-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 50;
  display: inline-flex;
  /* padding clears the focus ring on inner buttons so the ring clears the
     container border instead of sitting on it. */
  padding: 8px;
  gap: 2px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: 0 8px 24px var(--shadow-color);
}

.view-switch-fab__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.view-switch-fab__btn svg {
  width: 18px;
  height: 18px;
}

.view-switch-fab__btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.view-switch-fab__btn--active {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.view-switch-fab__btn--active:hover {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}
</style>
