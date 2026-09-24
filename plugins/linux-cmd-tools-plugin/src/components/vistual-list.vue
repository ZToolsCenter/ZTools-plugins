<!-- VirtualList.vue -->
<template>
  <div
    ref="containerRef"
    class="virtual-list"
    :style="containerStyle"
    @scroll.passive="handleScroll"
  >
    <div class="virtual-list__phantom" :style="{ height: totalHeight + 'px' }" />

    <div class="virtual-list__viewport" :style="{ transform: `translateY(${offsetY}px)` }">
      <div
        v-for="row in visibleRows"
        :key="row.key"
        class="virtual-list__item"
        :style="{ height: itemHeight + 'px' }"
      >
        <slot :item="row.data" :index="row.index" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  type CSSProperties,
} from 'vue'

/* ================== 类型定义 ================== */

/** 可视行结构 */
interface VisibleRow<T> {
  index: number
  data: T
  key: string | number
}

/** 滚动对齐方式 */
type ScrollAlign = 'start' | 'center' | 'end'

/** Props 定义 */
interface VirtualListProps<T> {
  /** 列表数据 */
  list: T[]
  /** 每项固定高度（px） */
  itemHeight: number
  /** 容器高度，数字（px）或任意 CSS 字符串，如 '50vh' */
  height?: number | string
  /** 上下缓冲区条数，防止快速滚动白屏 */
  buffer?: number
  /**
   * 取 key 的方式：
   * - 传字段名（keyof T，如 'id'）
   * - 传 (item, index) => key
   * - 不传时回退到 index
   */
  itemKey?: keyof T | ((item: T, index: number) => string | number)
  /** 距离底部多少 px 触发 reach-bottom */
  bottomThreshold?: number
}

/** Emits 定义（元组语法） */
interface VirtualListEmits {
  scroll: [event: Event]
  'reach-bottom': []
}

/** 通过 defineExpose 暴露的方法 */
interface VirtualListExpose {
  scrollToIndex: (index: number, align?: ScrollAlign) => void
  scrollToTop: (smooth?: boolean) => void
  scrollToBottom: (smooth?: boolean) => void
  containerRef: Readonly<typeof containerRef>
}

/* ================== Props / Emits / Slots ================== */

const props = withDefaults(defineProps<VirtualListProps<T>>(), {
  height: 400,
  buffer: 3,
  bottomThreshold: 0,
})

const emit = defineEmits<VirtualListEmits>()

defineSlots<{
  default: (props: { item: T; index: number }) => any
}>()

/* ================== 状态 ================== */

const containerRef = ref<HTMLDivElement | null>(null)
const scrollTop = ref<number>(0)
// 用 props.height 预初始化，避免首屏只渲染 1 条造成闪烁
const viewportHeight = ref<number>(
  typeof props.height === 'number' ? props.height : 0
)

/* ================== 计算属性 ================== */

const totalHeight = computed<number>(() => props.list.length * props.itemHeight)

const containerStyle = computed<CSSProperties>(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
}))

/** 可视区第一条下标（未含 buffer） */
const rawStart = computed<number>(() =>
  Math.floor(scrollTop.value / props.itemHeight)
)

/** 一屏能放几条 */
const visibleCount = computed<number>(() =>
  Math.max(
    1,
    Math.ceil((viewportHeight.value || props.itemHeight) / props.itemHeight)
  )
)

const startIndex = computed<number>(() =>
  Math.max(0, rawStart.value - props.buffer)
)

const endIndex = computed<number>(() =>
  Math.min(props.list.length, rawStart.value + visibleCount.value + props.buffer)
)

/** 渲染区的偏移量 */
const offsetY = computed<number>(() => startIndex.value * props.itemHeight)

/** 当前需渲染的行 */
const visibleRows = computed<VisibleRow<T>[]>(() => {
  const rows: VisibleRow<T>[] = []
  for (let i = startIndex.value; i < endIndex.value; i++) {
    rows.push({
      index: i,
      data: props.list[i],
      key: resolveKey(props.list[i], i),
    })
  }
  return rows
})

/* ================== 工具函数 ================== */

function resolveKey(item: T, index: number): string | number {
  const key = props.itemKey
  if (typeof key === 'function') return key(item, index)
  if (
    key != null &&
    item != null &&
    typeof item === 'object' &&
    (key as PropertyKey) in (item as object)
  ) {
    return (item as Record<PropertyKey, string | number>)[key as PropertyKey]
  }
  return index
}

/* ================== 滚动处理 ================== */

let rafId = 0

function handleScroll(e: Event): void {
  const target = e.target as HTMLDivElement
  scrollTop.value = target.scrollTop
  emit('scroll', e)

  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      rafId = 0
      checkBottom()
    })
  }
}

function checkBottom(): void {
  const el = containerRef.value
  if (!el) return
  const { scrollTop: top, clientHeight, scrollHeight } = el
  if (top + clientHeight >= scrollHeight - props.bottomThreshold) {
    emit('reach-bottom')
  }
}

/* ================== 尺寸监听 ================== */

let resizeObserver: ResizeObserver | null = null

function measure(): void {
  if (containerRef.value) {
    viewportHeight.value = containerRef.value.clientHeight
  }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(containerRef.value)
  } else {
    window.addEventListener('resize', measure)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', measure)
  if (rafId) cancelAnimationFrame(rafId)
})

// 数据变短时把滚动位置拉回合法范围
watch(
  () => props.list.length,
  () => {
    const el = containerRef.value
    if (!el) return
    const maxTop = Math.max(0, totalHeight.value - viewportHeight.value)
    if (el.scrollTop > maxTop) el.scrollTop = maxTop
  }
)

/* ================== 对外方法 ================== */

/**
 * 滚动到指定下标
 * @param index 目标下标
 * @param align 对齐方式：start / center / end
 */
function scrollToIndex(index: number, align: ScrollAlign = 'start'): void {
  const el = containerRef.value
  if (!el) return
  const maxTop = Math.max(0, totalHeight.value - viewportHeight.value)
  let top = index * props.itemHeight
  if (align === 'center') top -= (viewportHeight.value - props.itemHeight) / 2
  else if (align === 'end') top -= viewportHeight.value - props.itemHeight
  el.scrollTop = Math.min(Math.max(0, top), maxTop)
}

function scrollToTop(smooth = false): void {
  containerRef.value?.scrollTo({
    top: 0,
    behavior: smooth ? 'smooth' : 'auto',
  })
}

function scrollToBottom(smooth = false): void {
  const el = containerRef.value
  if (!el) return
  el.scrollTo({
    top: totalHeight.value,
    behavior: smooth ? 'smooth' : 'auto',
  })
}

defineExpose<VirtualListExpose>({
  scrollToIndex,
  scrollToTop,
  scrollToBottom,
  containerRef,
})
</script>

<style scoped>
.virtual-list {
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  contain: strict;
}

.virtual-list__phantom {
  width: 100%;
  pointer-events: none;
}

.virtual-list__viewport {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  will-change: transform;
}

.virtual-list__item {
  box-sizing: border-box;
  overflow: hidden;
}
</style>