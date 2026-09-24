<template>
  <svg
    v-if="show && (guides.length || dragPreview)"
    ref="overlayRef"
    class="guides-overlay"
    :viewBox="`0 0 ${width} ${height}`"
    :style="overlayStyle"
    role="group"
    aria-label="对齐参考线"
    @contextmenu.prevent
  >
    <template v-for="guide in guides" :key="guide.id">
      <!-- 可见线：non-scaling-stroke 保证任意缩放下线宽恒为 1px -->
      <line
        class="guide-line"
        :x1="guide.orientation === 'horizontal' ? 0 : guide.position"
        :y1="guide.orientation === 'horizontal' ? guide.position : 0"
        :x2="guide.orientation === 'horizontal' ? width : guide.position"
        :y2="guide.orientation === 'horizontal' ? guide.position : height"
      />
      <!-- 透明热区：宽度按 1/zoom 折算，命中范围在任何缩放下都约为 10 屏幕像素 -->
      <line
        class="guide-hit"
        :x1="guide.orientation === 'horizontal' ? 0 : guide.position"
        :y1="guide.orientation === 'horizontal' ? guide.position : 0"
        :x2="guide.orientation === 'horizontal' ? width : guide.position"
        :y2="guide.orientation === 'horizontal' ? guide.position : height"
        :stroke-width="hitStrokeWidth"
        @pointerdown="handleGuidePointerDown($event, guide)"
        @contextmenu.stop.prevent="emit('guide-remove', guide.id)"
      />
    </template>
    <!-- 从标尺拖出的新建预览线（未落定前不写入参考线列表） -->
    <line
      v-if="dragPreview"
      class="guide-line guide-preview"
      :x1="dragPreview.orientation === 'horizontal' ? 0 : dragPreview.position"
      :y1="dragPreview.orientation === 'horizontal' ? dragPreview.position : 0"
      :x2="dragPreview.orientation === 'horizontal' ? width : dragPreview.position"
      :y2="dragPreview.orientation === 'horizontal' ? dragPreview.position : height"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { GuideOrientation, ProjectGuide } from '../documentGuides'

/**
 * 对齐参考线覆盖层：与 Keyline / 像素网格同风格的画布内 DOM SVG overlay，
 * 覆盖在画布 wrapper 上按 viewBox 缩放渲染，绝不进入 fabric 序列化（见使用处说明）。
 * 组件只负责渲染与指针手势，位置夹取、撤销与持久化都由运行时处理。
 */
const props = defineProps<{
  guides: ProjectGuide[]
  show: boolean
  /** 画布宽度（viewBox 单位，等于画布坐标系像素）。 */
  width: number
  /** 画布高度。 */
  height: number
  zoom: number
  /** 从标尺拖出的新建参考线预览（isNew 阶段尚未进入 guides 列表）。 */
  dragPreview: { orientation: GuideOrientation; position: number } | null
}>()

const emit = defineEmits<{
  /** 在参考线热区上按下左键：开始拖动该参考线。 */
  (event: 'guide-drag-start', guideId: string): void
  /** 拖动过程中的最新画布坐标位置（未夹取）。 */
  (event: 'guide-drag-move', position: number): void
  /** 拖动落定：父组件根据落点决定保留或删除（拖回标尺区域删除）。 */
  (event: 'guide-drag-commit', payload: { guideId: string; orientation: GuideOrientation; position: number; clientX: number; clientY: number }): void
  /** 右键 / 快捷删除单条参考线。 */
  (event: 'guide-remove', guideId: string): void
}>()

// 命中热区的屏幕像素宽度：viewBox 坐标系下需按缩放折算，保证任何缩放级别手感一致。
const GUIDE_HIT_SCREEN_PX = 10
const hitStrokeWidth = computed(() => {
  const z = props.zoom > 0 ? props.zoom : 1
  return GUIDE_HIT_SCREEN_PX / z
})

const overlayStyle = computed(() => ({
  width: `${props.width * (props.zoom > 0 ? props.zoom : 1)}px`,
  height: `${props.height * (props.zoom > 0 ? props.zoom : 1)}px`
}))

// 进行中的热区拖拽上下文（组件内只跟踪指针，位置语义由运行时统一处理）。
const dragContext = ref<{ guide: ProjectGuide; pointerId: number } | null>(null)
const overlayRef = ref<SVGSVGElement | null>(null)

/** 把指针客户区坐标换算为画布坐标系位置（以覆盖层自身左上角为画布原点）。 */
function computeGuidePosition(orientation: GuideOrientation, clientX: number, clientY: number) {
  const overlay = overlayRef.value
  if (!overlay) return 0
  const rect = overlay.getBoundingClientRect()
  const z = props.zoom > 0 ? props.zoom : 1
  return orientation === 'horizontal' ? (clientY - rect.top) / z : (clientX - rect.left) / z
}

function onWindowPointerMove(event: PointerEvent) {
  const context = dragContext.value
  if (!context || event.pointerId !== context.pointerId) return
  emit('guide-drag-move', computeGuidePosition(context.guide.orientation, event.clientX, event.clientY))
}

function onWindowPointerUp(event: PointerEvent) {
  const context = dragContext.value
  if (!context || event.pointerId !== context.pointerId) return
  detachWindowListeners()
  dragContext.value = null
  emit('guide-drag-commit', {
    guideId: context.guide.id,
    orientation: context.guide.orientation,
    position: computeGuidePosition(context.guide.orientation, event.clientX, event.clientY),
    clientX: event.clientX,
    clientY: event.clientY
  })
}

function attachWindowListeners() {
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
}

function detachWindowListeners() {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
}

// 在参考线热区上按下左键开始拖动；坐标语义（夹取/落定/删除）由运行时处理。
function handleGuidePointerDown(event: PointerEvent, guide: ProjectGuide) {
  if (event.button !== 0) return
  event.preventDefault()
  dragContext.value = { guide: { ...guide }, pointerId: event.pointerId }
  emit('guide-drag-start', guide.id)
  attachWindowListeners()
}

onBeforeUnmount(detachWindowListeners)
</script>

<style scoped>
.guides-overlay {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  z-index: 10;
  pointer-events: none;
}
.guide-line {
  stroke: var(--primary-color, #0284c7);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
.guide-preview {
  stroke-dasharray: 6 4;
  opacity: 0.85;
}
/* 热区线不可见但可命中，右键同样作用其上以删除参考线 */
.guide-hit {
  stroke: transparent;
  cursor: move;
  pointer-events: stroke;
}
</style>
