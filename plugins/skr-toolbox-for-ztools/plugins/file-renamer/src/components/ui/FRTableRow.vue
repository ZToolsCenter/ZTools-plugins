<script setup lang="ts">
/**
 * 表格行组件。
 * @description 表格的tr元素，支持hover和选中状态
 * @see FRTable 表格容器组件
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <tr :class="cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', props.class)">
    <slot />
  </tr>
</template>
