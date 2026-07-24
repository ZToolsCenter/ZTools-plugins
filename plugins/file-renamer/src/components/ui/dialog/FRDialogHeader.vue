<script setup lang="ts">
/**
 * 对话框头部组件。
 * @description 对话框的头部区域，用于放置标题和描述
 */
import { type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    :class="
      cn('flex flex-col space-y-1.5 text-center sm:text-left', props.class)
    "
  >
    <slot />
  </div>
</template>
