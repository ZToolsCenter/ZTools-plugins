<script setup lang="ts">
/**
 * 溢出跑马灯文本组件。
 * @description 当文本溢出容器时显示跑马灯动画，鼠标悬停显示完整文本的提示
 * @param text - 显示的文本内容
 * @param speed - 动画速度（像素/秒）
 * @uses ResizeObserver 监听容器和文本尺寸变化
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import FRTooltip from './FRTooltip.vue'

const props = withDefaults(defineProps<{
  text: string
  class?: HTMLAttributes['class']
  textClass?: HTMLAttributes['class']
  speed?: number
}>(), {
  speed: 20,
})

const containerRef = ref<HTMLDivElement | null>(null)
const textRef = ref<HTMLSpanElement | null>(null)
const isOverflowing = ref(false)
const overflowDistance = ref(0)

let resizeObserver: ResizeObserver | null = null

const marqueeDuration = computed(() => {
  const base = overflowDistance.value / props.speed
  const seconds = Math.max(12, base + 8)
  return `${seconds.toFixed(2)}s`
})

const marqueeStyle = computed<Record<string, string> | undefined>(() => {
  if (!isOverflowing.value) return undefined
  return {
    '--fr-marquee-distance': `${overflowDistance.value}px`,
    '--fr-marquee-duration': marqueeDuration.value,
  }
})

function measureOverflow() {
  if (!containerRef.value || !textRef.value) {
    isOverflowing.value = false
    overflowDistance.value = 0
    return
  }

  const containerWidth = containerRef.value.clientWidth
  const textWidth = textRef.value.scrollWidth
  const exceeds = textWidth > containerWidth + 1

  isOverflowing.value = exceeds
  overflowDistance.value = exceeds ? Math.ceil(textWidth - containerWidth) : 0
}

function handleViewportChange() {
  measureOverflow()
}

onMounted(async () => {
  await nextTick()
  measureOverflow()

  resizeObserver = new ResizeObserver(() => {
    measureOverflow()
  })

  if (containerRef.value) resizeObserver.observe(containerRef.value)
  if (textRef.value) resizeObserver.observe(textRef.value)

  window.addEventListener('resize', handleViewportChange)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', handleViewportChange)
})

watch(
  () => props.text,
  async () => {
    await nextTick()
    measureOverflow()
  }
)
</script>

<template>
  <FRTooltip :content="props.text" trigger-class="w-full min-w-0">
    <div :class="cn('relative min-w-0 w-full', props.class)">
      <div ref="containerRef" class="overflow-hidden whitespace-nowrap">
        <span
          ref="textRef"
          :class="cn(
            'inline-block align-middle',
            props.textClass,
            isOverflowing && 'fr-overflow-marquee'
          )"
          :style="marqueeStyle"
        >
          {{ props.text }}
        </span>
      </div>
    </div>
  </FRTooltip>

</template>

<style scoped>
.fr-overflow-marquee {
  padding-right: 1.25rem;
  animation: fr-overflow-marquee var(--fr-marquee-duration) ease-in-out infinite;
}

@keyframes fr-overflow-marquee {
  0%,
  25% {
    transform: translateX(0);
  }

  75% {
    transform: translateX(calc(var(--fr-marquee-distance) * -1));
  }

  100% {
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fr-overflow-marquee {
    animation: none;
  }
}
</style>
