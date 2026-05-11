<template>
  <div
    ref="triggerRef"
    class="ui-tooltip-trigger"
    @mouseover="scheduleShow"
    @mouseout="scheduleHide"
    @focus="scheduleShow"
    @blur="scheduleHide"
  >
    <slot />
  </div>
  <Teleport to="body">
    <div
      ref="tooltipRef"
      class="ui-tooltip"
      :class="[`ui-tooltip--${currentPlacement}`, { 'ui-tooltip--show': visible }]"
      :style="tooltipStyle"
      role="tooltip"
    >
      <slot name="content">{{ content }}</slot>
      <div class="ui-tooltip__arrow" :class="`ui-tooltip__arrow--${currentPlacement}`" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  content?: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  showDelay?: number
  hideDelay?: number
}>(), {
  content: '',
  placement: 'top',
  showDelay: 200,
  hideDelay: 100
})

const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const visible = ref(false)
const currentPlacement = ref<'top' | 'bottom' | 'left' | 'right'>(props.placement)
const tooltipStyle = ref<Record<string, string>>({
  position: 'fixed',
  top: '0',
  left: '0',
  transform: 'none',
  zIndex: '99998',
  visibility: 'hidden'
})

let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const GAP = 8
const SAFE_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function calcPosition(
  placement: 'top' | 'bottom' | 'left' | 'right',
  triggerRect: DOMRect,
  tooltipRect: DOMRect
): { top: number; left: number } {
  switch (placement) {
    case 'top':
      return {
        top: triggerRect.top - GAP - tooltipRect.height,
        left: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
      }
    case 'bottom':
      return {
        top: triggerRect.bottom + GAP,
        left: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
      }
    case 'left':
      return {
        top: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
        left: triggerRect.left - GAP - tooltipRect.width
      }
    case 'right':
      return {
        top: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
        left: triggerRect.right + GAP
      }
  }
}

function getFallbackPlacement(
  placement: 'top' | 'bottom' | 'left' | 'right'
): 'top' | 'bottom' | 'left' | 'right' {
  if (placement === 'top') return 'bottom'
  if (placement === 'bottom') return 'top'
  if (placement === 'left') return 'right'
  return 'left'
}

function positionTooltip() {
  const trigger = triggerRef.value
  const tooltip = tooltipRef.value
  if (!trigger || !tooltip) return

  const triggerRect = trigger.getBoundingClientRect()
  if (triggerRect.width === 0 || triggerRect.height === 0) return

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxAllowedWidth = Math.max(160, viewportWidth - SAFE_MARGIN * 2)

  tooltipStyle.value = {
    position: 'fixed',
    top: '0px',
    left: '0px',
    transform: 'none',
    zIndex: '99998',
    visibility: 'hidden',
    maxWidth: `${maxAllowedWidth}px`,
    whiteSpace: 'nowrap'
  }

  let tooltipRect = tooltip.getBoundingClientRect()
  const shouldWrap = tooltipRect.width > maxAllowedWidth
  if (shouldWrap) {
    tooltipStyle.value = {
      ...tooltipStyle.value,
      whiteSpace: 'normal'
    }
    tooltipRect = tooltip.getBoundingClientRect()
  }

  let placement = props.placement
  let { top, left } = calcPosition(placement, triggerRect, tooltipRect)

  const overTop = top < SAFE_MARGIN
  const overBottom = top + tooltipRect.height > viewportHeight - SAFE_MARGIN
  const overLeft = left < SAFE_MARGIN
  const overRight = left + tooltipRect.width > viewportWidth - SAFE_MARGIN

  if (
    (placement === 'top' && overTop) ||
    (placement === 'bottom' && overBottom) ||
    (placement === 'left' && overLeft) ||
    (placement === 'right' && overRight)
  ) {
    placement = getFallbackPlacement(placement)
    const fallbackPos = calcPosition(placement, triggerRect, tooltipRect)
    top = fallbackPos.top
    left = fallbackPos.left
  }

  top = clamp(top, SAFE_MARGIN, viewportHeight - SAFE_MARGIN - tooltipRect.height)
  left = clamp(left, SAFE_MARGIN, viewportWidth - SAFE_MARGIN - tooltipRect.width)

  const triggerCenterX = triggerRect.left + triggerRect.width / 2
  const triggerCenterY = triggerRect.top + triggerRect.height / 2
  const arrowX = clamp(triggerCenterX - left, 10, tooltipRect.width - 10)
  const arrowY = clamp(triggerCenterY - top, 10, tooltipRect.height - 10)

  currentPlacement.value = placement

  tooltipStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    transform: 'none',
    zIndex: '99998',
    visibility: 'visible',
    maxWidth: `${maxAllowedWidth}px`,
    whiteSpace: shouldWrap ? 'normal' : 'nowrap',
    '--arrow-x': `${arrowX}px`,
    '--arrow-y': `${arrowY}px`
  }
}

function scheduleShow() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  if (showTimer) return
  showTimer = setTimeout(() => {
    visible.value = true
    showTimer = null
    requestAnimationFrame(() => {
      positionTooltip()
    })
  }, props.showDelay)
}

function scheduleHide() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  if (hideTimer) return
  hideTimer = setTimeout(() => {
    visible.value = false
    hideTimer = null
  }, props.hideDelay)
}

watch(visible, (val) => {
  if (val) {
    requestAnimationFrame(() => {
      positionTooltip()
    })
  }
})

watch(
  () => props.placement,
  (next) => {
    currentPlacement.value = next
    if (visible.value) {
      requestAnimationFrame(() => {
        positionTooltip()
      })
    }
  }
)

onMounted(() => {
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
  if (showTimer) clearTimeout(showTimer)
  if (hideTimer) clearTimeout(hideTimer)
})

function updatePosition() {
  if (!visible.value) return
  positionTooltip()
}
</script>

<style scoped>
.ui-tooltip-trigger {
  display: inline-flex;
  position: relative;
  flex: 0 0 auto;
  width: fit-content;
}
</style>

<style>
.ui-tooltip {
  padding: 5px 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-md);
  max-width: min(320px, calc(100vw - 16px));
  white-space: nowrap;
  overflow-wrap: break-word;
  word-break: normal;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ui-tooltip--show {
  opacity: 1;
}

.ui-tooltip__arrow {
  position: absolute;
  width: 8px;
  height: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}

.ui-tooltip__arrow--top {
  bottom: -5px;
  left: var(--arrow-x, 50%);
  transform: translateX(-50%) rotate(45deg);
  border-left: none;
  border-top: none;
}

.ui-tooltip__arrow--bottom {
  top: -5px;
  left: var(--arrow-x, 50%);
  transform: translateX(-50%) rotate(45deg);
  border-right: none;
  border-bottom: none;
}

.ui-tooltip__arrow--left {
  right: -5px;
  top: var(--arrow-y, 50%);
  transform: translateY(-50%) rotate(45deg);
  border-left: none;
  border-bottom: none;
}

.ui-tooltip__arrow--right {
  left: -5px;
  top: var(--arrow-y, 50%);
  transform: translateY(-50%) rotate(45deg);
  border-right: none;
  border-top: none;
}
</style>
