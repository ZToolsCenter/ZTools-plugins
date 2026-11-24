<script setup lang="ts">
import { ref } from 'vue'

const tools = [
  {
    id: 'format',
    label: '重新格式化「Alt + F」',
    icon: 'M4 7v2c0 .55-.45 1-1 1H2v4h1c.55 0 1 .45 1 1v2c0 1.65 1.35 3 3 3h3v-2H7c-.55 0-1-.45-1-1v-2c0-1.3-.84-2.42-2-2.83v-.34C5.16 11.42 6 10.3 6 9V7c0-.55.45-1 1-1h3V4H7C5.35 4 4 5.35 4 7zm17 3c-.55 0-1-.45-1-1V7c0-1.65-1.35-3-3-3h-3v2h3c.55 0 1 .45 1 1v2c0 1.3.84 2.42 2 2.83v.34c-1.16.41-2 1.52-2 2.83v2c0 .55-.45 1-1 1h-3v2h3c1.65 0 3-1.35 3-3v-2c0-.55.45-1 1-1h1v-4h-1z',
  },
  {
    id: 'fold',
    label: '折叠全部「Alt + >」',
    icon: 'M7.41 18.59 8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z',
  },
  {
    id: 'unfold',
    label: '展开全部「Alt + Shift + >」',
    icon: 'M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z',
  },
  {
    id: 'strip',
    label: '去除注释',
    icon: 'M16.83 14H18v-2h-3.17l-1-1H18V9h-6.17l-1-1H18V6H8.83l-4-4H20c1.1 0 2 .9 2 2v15.17L16.83 14zM2.1 2.1.69 3.51 2 4.83V16c0 1.1.9 2 2 2h11.17l5.31 5.31 1.41-1.41L2.1 2.1zM6 9h.17l2 2H6V9zm0 5v-2h3.17l2 2H6z',
  },
  {
    id: 'compact',
    label: '压缩 JSON 并复制「Alt + C」',
    icon: 'M8 19h3v3h2v-3h3l-4-4-4 4zm8-15h-3V1h-2v3H8l4 4 4-4zM4 9v2h16V9H4zm0 3h16v2H4z',
  },
  {
    id: 'escape',
    label: '压缩转义 JSON 并复制「Alt + \\」',
    icon: 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z',
  },
  {
    id: 'xml',
    label: 'JSON 转 XML 并复制',
    icon: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  },
  {
    id: 'typescript',
    label: 'JSON 转 TypeScript 并复制',
    icon: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  },
] as const

type Tool = (typeof tools)[number]
const emit = defineEmits<{ action: [id: Tool['id']] }>()
const tooltip = ref<{ label: string; x: number } | null>(null)

function showTooltip(event: PointerEvent, label: string) {
  if (event.pointerType === 'touch') return
  const { left, width } = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tooltip.value = { label, x: left + width / 2 }
}

function positionTooltip(element: unknown) {
  if (!(element instanceof HTMLElement) || !tooltip.value) return
  const halfWidth = element.offsetWidth / 2
  const x = Math.max(halfWidth + 5, Math.min(tooltip.value.x, window.innerWidth - halfWidth - 5))
  element.style.left = x + 'px'
}

function activate(event: MouseEvent, id: Tool['id']) {
  const button = event.currentTarget as HTMLButtonElement
  button.blur()
  emit('action', id)
}
</script>

<template>
  <div class="handle" @pointerleave="tooltip = null" @keydown.esc="tooltip = null">
    <template v-for="tool in tools" :key="tool.id">
      <hr v-if="tool.id === 'compact'" class="toolbar-divider" aria-orientation="vertical" />
      <button
        type="button"
        class="tool-button"
        :aria-label="tool.label"
        @pointerenter="showTooltip($event, tool.label)"
        @pointerleave="tooltip = null"
        @click="activate($event, tool.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tool.icon" /></svg>
      </button>
    </template>
    <div v-if="tooltip" :key="tooltip.label" :ref="positionTooltip" class="tool-tooltip" role="tooltip">
      {{ tooltip.label }}
    </div>
  </div>
</template>
