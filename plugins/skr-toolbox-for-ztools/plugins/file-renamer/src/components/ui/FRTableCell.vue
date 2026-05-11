<script setup lang="ts">
/**
 * 表格单元格组件。
 * @description 表格的td元素，用于数据单元格
 * @see FRTable 表格容器组件
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <td :class="cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', props.class)">
    <slot />
  </td>
</template>
