<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ZSelect } from 'ztools-ui'
import type { SelectModelValue, SelectOption } from 'ztools-ui'

defineProps<{ modelValue: SelectModelValue; options: SelectOption[] }>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: SelectModelValue): void
}>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
let frame = 0

function resizeMenu() {
  const element = root.value
  if (!element) return
  const select = element.querySelector<HTMLElement>('.z-select')
  if (!select) return
  const available = window.innerHeight - select.getBoundingClientRect().bottom - 16
  element.style.setProperty('--down-select-height', `${Math.max(0, Math.min(300, available))}px`)
}

function scheduleResize() {
  if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0
      resizeMenu()
    })
  }
}

function removeListeners() {
  window.removeEventListener('resize', scheduleResize)
  window.removeEventListener('scroll', scheduleResize, true)
  cancelAnimationFrame(frame)
  frame = 0
}

watch(
  open,
  (visible) => {
    removeListeners()
    if (visible) {
      resizeMenu()
      window.addEventListener('resize', scheduleResize)
      window.addEventListener('scroll', scheduleResize, true)
    }
  },
  { flush: 'sync' }
)
onBeforeUnmount(removeListeners)
</script>

<template>
  <div ref="root" class="down-select">
    <ZSelect
      :model-value="modelValue"
      :options="options"
      placement="bottom-start"
      :auto-adjust-placement="false"
      :to="false"
      @update:model-value="emit('update:modelValue', $event)"
      @update:show="open = $event"
    />
  </div>
</template>

<style scoped>
.down-select {
  min-width: 0;
  width: 100%;
}

.down-select :deep(.select-menu) {
  max-height: var(--down-select-height, 300px);
  overflow-y: auto;
}
</style>
