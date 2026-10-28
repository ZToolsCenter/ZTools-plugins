<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ClipboardRecord } from '../types'
import { ROW_GAP, rowHeightOf, type ImgScale } from '../utils/layout'
import ClipboardItem from './ClipboardItem.vue'
import CodeCard from './CodeCard.vue'
import FileCard from './FileCard.vue'
import ImageCard from './ImageCard.vue'

const props = defineProps<{
  items: ClipboardRecord[]
  selectedId: string | null
  /**
   * 判断某条记录是否已收藏。
   * 这里必须是"函数"而不是"已收藏 id 的集合"：收藏是以**内容 key**（`favKey`）
   * 存的，而记录的 `id` 是宿主给的历史 id，两者不是同一个值 ——
   * 直接拿 `id` 去查收藏集合会永远查不中，表现为"点了星却不亮"
   * （只有收藏分类下 id 恰好等于 key，才碰巧是对的）。
   */
  isStarred: (r: ClipboardRecord) => boolean
  /** 图片行的缩放档位 */
  imgScale: ImgScale
  /**
   * 列表标识（分类 + 搜索词）。变化时代表"换了一批数据"，
   * 必须回到顶部：沿用旧滚动位置会让组件内的 scrollTop 与 DOM 实际值
   * 短暂错位（新内容更短时浏览器是异步夹取 scrollTop 的），
   * 那一帧会渲染出错误区间的行 —— 视觉上就是旧列表残留、行错位。
   * 加载下一页时该值不变，因此滚动位置得以保留。
   */
  resetKey: string
}>()

const emit = defineEmits<{
  copy: [record: ClipboardRecord]
  star: [record: ClipboardRecord]
  remove: [record: ClipboardRecord]
  preview: [record: ClipboardRecord]
  /** 在文件管理器中定位到某个路径（来自文件卡片的定位按钮） */
  reveal: [path: string]
  /** 在系统浏览器中打开（来自链接记录的打开按钮） */
  open: [record: ClipboardRecord]
  'load-more': []
}>()

/** 视口外多渲染几行，避免快速滚动出现白块 */
const BUFFER = 4

const viewport = ref<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const clientH = ref(400)
const clientW = ref(600)

/* ------------------------------------------------------------------ */
/* 度量：每行高度可变（图片行按宽高比撑开）                              */
/* ------------------------------------------------------------------ */

const heights = computed<number[]>(() =>
  props.items.map((r) => rowHeightOf(r, clientW.value, props.imgScale, clientH.value))
)

/**
 * 前缀和：offsets[i] = 第 i 行顶部相对滚动内容的偏移，offsets[n] = 总高度。
 * 依赖项变化时才重算，滚动本身不触发。
 */
const offsets = computed<number[]>(() => {
  const hs = heights.value
  const off = new Array<number>(hs.length + 1)
  off[0] = 0
  for (let i = 0; i < hs.length; i++) off[i + 1] = off[i] + hs[i]
  return off
})

const total = computed(() => offsets.value[props.items.length] ?? 0)

/** 二分查找：落在偏移 y 处的行下标 */
function indexAt(y: number): number {
  const off = offsets.value
  let lo = 0
  let hi = props.items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (off[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

const windowRows = computed(() => {
  const n = props.items.length
  if (n === 0) return []
  const off = offsets.value
  const hs = heights.value

  const first = Math.max(0, indexAt(scrollTop.value) - BUFFER)
  const last = Math.min(n, indexAt(scrollTop.value + clientH.value) + BUFFER + 1)

  const rows: { rec: ClipboardRecord; top: number; height: number }[] = []
  for (let i = first; i < last; i++) {
    rows.push({ rec: props.items[i], top: off[i], height: hs[i] })
  }
  return rows
})

function onScroll(): void {
  const el = viewport.value
  if (!el) return
  scrollTop.value = el.scrollTop
  // 内容不足一屏时没有"更多"可翻，避免在短列表里无谓地触发加载
  if (total.value <= el.clientHeight) return
  if (scrollTop.value + el.clientHeight > total.value - 600) {
    emit('load-more')
  }
}

/** 把滚动位置拉回顶部，并同步组件内的 ref（不能等 scroll 事件，否则慢一帧） */
function scrollToTop(): void {
  const el = viewport.value
  if (el && el.scrollTop !== 0) el.scrollTop = 0
  scrollTop.value = 0
}

/** 换了一批数据：回到顶部 */
watch(() => props.resetKey, scrollToTop, { flush: 'sync' })

/**
 * 内容变短（删除、清空、远端搜索结果替换）时，浏览器会把 DOM 的 scrollTop
 * 夹到新的最大值，但那次 scroll 事件是异步的；这里同步夹一次，
 * 保证上面用于算可见区间的 scrollTop 不会指向已经不存在的偏移。
 */
watch([total, clientH], ([t, ch]) => {
  const el = viewport.value
  if (!el) return
  const max = Math.max(0, t - ch)
  if (el.scrollTop > max) {
    el.scrollTop = max
    scrollTop.value = max
  }
})

/** 选中项变化时保证滚入视口 */
watch(
  () => props.selectedId,
  (id) => {
    const el = viewport.value
    if (!el || !id) return
    const idx = props.items.findIndex((r) => r.id === id)
    if (idx < 0) return
    const top = offsets.value[idx]
    const bottom = offsets.value[idx + 1]
    if (top < el.scrollTop) {
      el.scrollTo({ top: Math.max(0, top) })
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: bottom - el.clientHeight })
    }
  }
)

let ro: ResizeObserver | null = null

onMounted(() => {
  const el = viewport.value
  if (!el) return
  clientH.value = el.clientHeight
  clientW.value = el.clientWidth
  ro = new ResizeObserver(() => {
    clientH.value = el.clientHeight
    clientW.value = el.clientWidth
  })
  ro.observe(el)
})

onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div ref="viewport" class="vlist" @scroll.passive="onScroll">
    <div class="spacer" :style="{ height: total + 'px' }">
      <div
        v-for="row in windowRows"
        :key="row.rec.id"
        class="row"
        :style="{
          transform: `translateY(${row.top}px)`,
          height: row.height + 'px',
          paddingBottom: ROW_GAP + 'px'
        }"
      >
        <ImageCard
          v-if="row.rec.kind === 'image'"
          :record="row.rec"
          :selected="row.rec.id === selectedId"
          :starred="isStarred(row.rec)"
          @copy="emit('copy', row.rec)"
          @star="emit('star', row.rec)"
          @remove="emit('remove', row.rec)"
          @preview="emit('preview', row.rec)"
        />
        <CodeCard
          v-else-if="row.rec.kind === 'code'"
          :record="row.rec"
          :selected="row.rec.id === selectedId"
          :starred="isStarred(row.rec)"
          @copy="emit('copy', row.rec)"
          @star="emit('star', row.rec)"
          @remove="emit('remove', row.rec)"
          @preview="emit('preview', row.rec)"
        />
        <FileCard
          v-else-if="row.rec.kind === 'file'"
          :record="row.rec"
          :selected="row.rec.id === selectedId"
          :starred="isStarred(row.rec)"
          @copy="emit('copy', row.rec)"
          @star="emit('star', row.rec)"
          @remove="emit('remove', row.rec)"
          @reveal="(p) => emit('reveal', p)"
        />
        <ClipboardItem
          v-else
          :record="row.rec"
          :selected="row.rec.id === selectedId"
          :starred="isStarred(row.rec)"
          @copy="emit('copy', row.rec)"
          @star="emit('star', row.rec)"
          @remove="emit('remove', row.rec)"
          @open="emit('open', row.rec)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px;
  scrollbar-gutter: stable;
}

.spacer { position: relative; }

.row {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  box-sizing: border-box;
  /* 不要给 .row 加任何 transform 动画：这里的 translateY 是行的定位，
     带 transform 的关键帧会在动画期间把它覆盖掉 */
}
</style>
