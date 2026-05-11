<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

/**
 * 提示框组件属性
 */
const props = defineProps<{
  /** 提示框显示的文本内容 */
  content?: string
  /** 提示框相对于触发元素的位置 */
  position?: 'top' | 'bottom' | 'left' | 'right'
}>()

/** 提示框显示状态 */
const show = ref(false)
/** 提示框元素引用 */
const tooltipRef = ref<HTMLElement | null>(null)
/** 触发元素引用 */
const triggerRef = ref<HTMLElement | null>(null)
/** 提示框位置坐标 */
const pos = ref({ top: 0, left: 0 })

/**
 * 更新提示框位置
 * 根据触发元素的位置和指定的position属性计算提示框的显示位置
 */
const updatePos = () => {
  if (!triggerRef.value || !tooltipRef.value) return

  const rect = triggerRef.value.getBoundingClientRect()
  const tipRect = tooltipRef.value.getBoundingClientRect()

  let top = 0
  let left = 0
  const gap = 8

  switch (props.position || 'top') {
    case 'top':
      top = rect.top - tipRect.height - gap
      left = rect.left + (rect.width - tipRect.width) / 2
      break
    case 'bottom':
      top = rect.bottom + gap
      left = rect.left + (rect.width - tipRect.width) / 2
      break
    case 'left':
      top = rect.top + (rect.height - tipRect.height) / 2
      left = rect.left - tipRect.width - gap
      break
    case 'right':
      top = rect.top + (rect.height - tipRect.height) / 2
      left = rect.right + gap
      break
  }

  pos.value = { top, left }
}

/**
 * 鼠标进入触发区域时显示提示框
 */
const onMouseEnter = () => {
  show.value = true
  setTimeout(updatePos, 0)
}

/**
 * 鼠标离开触发区域时隐藏提示框
 */
const onMouseLeave = () => {
  show.value = false
}

onUnmounted(() => {
  show.value = false
})
</script>

<template>
    <div class="tooltip-trigger" ref="triggerRef" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
        <slot />

        <Teleport to="body">
            <Transition name="tooltip">
                <div v-if="show" class="tooltip-content" ref="tooltipRef"
                    :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
                    {{ content }}
                    <slot name="content" />
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<style scoped lang="scss">
.tooltip-trigger {
    display: inline-block;
}

.tooltip-content {
    position: fixed;
    z-index: 9999;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(8px);
    color: #fff;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    pointer-events: none;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1);
    white-space: nowrap;
    border: 1px solid rgba(255, 255, 255, 0.08);

    :global(.dark) & {
        background: rgba(24, 24, 27, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.05);
    }
}

.tooltip-enter-active,
.tooltip-leave-active {
    transition: opacity 150ms ease, transform 150ms ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
    opacity: 0;
    transform: scale(0.95);
}
</style>
