<script setup lang="ts">
import { Check, CircleAlert, CircleX, LoaderCircle, Minus } from 'lucide-vue-next'
import { computed } from 'vue'
import type { DiagnosticStatus } from '../types/report'

const props = withDefaults(
  defineProps<{
    status: DiagnosticStatus
    compact?: boolean
  }>(),
  { compact: false },
)

const config = computed(() => {
  switch (props.status) {
    case 'healthy':
      return { label: '正常', icon: Check }
    case 'warning':
      return { label: '需关注', icon: CircleAlert }
    case 'error':
      return { label: '失败', icon: CircleX }
    case 'unavailable':
      return { label: '不适用', icon: Minus }
    case 'checking':
      return { label: '检查中', icon: LoaderCircle }
    default:
      return { label: '已记录', icon: Check }
  }
})
</script>

<template>
  <span class="status-mark" :class="[`is-${status}`, { 'is-compact': compact }]">
    <component :is="config.icon" :size="compact ? 12 : 14" aria-hidden="true" />
    <span>{{ config.label }}</span>
  </span>
</template>
