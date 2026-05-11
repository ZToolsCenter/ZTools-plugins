<script setup lang="ts">
/**
 * 表格主体组件。
 * @description 表格的tbody元素
 * @see FRTable 表格容器组件
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <tbody :class="cn('[&_tr:last-child]:border-0', props.class)">
    <slot />
  </tbody>
</template>
