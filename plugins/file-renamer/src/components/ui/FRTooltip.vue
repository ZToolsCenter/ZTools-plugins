<script setup lang="ts">
/**
 * 工具提示组件。
 * @description 鼠标悬停显示的提示信息，使用Radix Vue的Tooltip原语实现
 * @param content - 提示内容
 * @param disabled - 是否禁用
 * @param side - 弹出位置（top, right, bottom, left）
 * @param align - 对齐方式（start, center, end）
 * @param sideOffset - 偏移量
 * @param delayDuration - 延迟显示时间（毫秒）
 * @see https://www.radix-vue.com/components/tooltip 官方文档
 */
import { computed, type HTMLAttributes } from 'vue'
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  type TooltipContentProps,
} from 'radix-vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  content?: string
  disabled?: boolean
  triggerClass?: HTMLAttributes['class']
  contentClass?: HTMLAttributes['class']
  side?: TooltipContentProps['side']
  align?: TooltipContentProps['align']
  sideOffset?: number
  delayDuration?: number
}>(), {
  side: 'top',
  align: 'center',
  sideOffset: 8,
  delayDuration: 260,
})

const normalizedContent = computed(() => (props.content || '').trim())
const isDisabled = computed(() => props.disabled || !normalizedContent.value)
</script>

<template>
  <span v-if="isDisabled" :class="cn('inline-flex max-w-full', props.triggerClass)">
    <slot />
  </span>

  <TooltipProvider v-else :delay-duration="props.delayDuration">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <span :class="cn('inline-flex max-w-full', props.triggerClass)">
          <slot />
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="props.side"
          :align="props.align"
          :side-offset="props.sideOffset"
          :class="cn(
            'z-50 max-w-90 wrap-break-word rounded-lg border border-border/80 bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-lg shadow-primary/10 ring-1 ring-border/60 data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
            props.contentClass,
          )"
        >
          {{ normalizedContent }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
