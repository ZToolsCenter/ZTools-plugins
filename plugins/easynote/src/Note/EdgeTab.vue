<template>
  <div
    class="edge-tab"
    :class="[`edge-tab--${side}`, `edge-tab--${noteType}`]"
    :title="`${title}｜点击还原，拖动可换位置`"
    @pointerdown="onPointerDown"
    @click="onClick"
    @auxclick="onAuxClick"
    @contextmenu.prevent
  >
    <button
      class="edge-tab-close"
      type="button"
      aria-label="关闭便签"
      @pointerdown.stop
      @click.stop="onClose"
    >
      ×
    </button>
    <span class="edge-tab-title">{{ title }}</span>
    <span class="edge-tab-grip" aria-hidden="true">
      <i></i><i></i><i></i>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { getBridge } from './bridge'

// 标签窗口拿不到管家的内存，标题 / 类型 / 吸附边通过 url query 带过来
const params = new URLSearchParams(location.search)
const title = params.get('title') || '便签'
const noteType = params.get('type') === 'todo' ? 'todo' : 'note'
/** 吸附边会随拖动变化，所以是响应式的 */
const side = ref(params.get('side') === 'left' ? 'left' : 'right')

/** 超过这个位移才算拖动，否则算点击 */
const DRAG_THRESHOLD = 4

let dragFrom: { x: number; y: number } | null = null
let cursor: { x: number; y: number } | null = null
let dragging = false
/** 刚拖完的那一下不要当成点击（指针抬起后 click 还会跟一发） */
let justDragged = false
let rafId = 0

getBridge()?.onCmd((msg) => {
  if (msg?.type === 'side' && msg.side) side.value = msg.side
})

/**
 * 拖动：窗口自己动不了（只有管家持有窗口句柄），所以把光标的屏幕坐标报上去，
 * 由管家 setPosition。用 rAF 节流，避免每个 pointermove 都打一次 IPC。
 */
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !getBridge()) return
  dragFrom = { x: e.screenX, y: e.screenY }
  cursor = { ...dragFrom }
  dragging = false
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!dragFrom) return
  cursor = { x: e.screenX, y: e.screenY }

  if (!dragging) {
    const moved =
      Math.abs(cursor.x - dragFrom.x) > DRAG_THRESHOLD ||
      Math.abs(cursor.y - dragFrom.y) > DRAG_THRESHOLD
    if (!moved) return
    dragging = true
    document.body.classList.add('edge-tab-dragging')
    send('start')
  }
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    send('move')
  })
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  document.body.classList.remove('edge-tab-dragging')
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (dragging) {
    send('end')
    justDragged = true
    setTimeout(() => (justDragged = false), 300)
  }
  dragFrom = null
  dragging = false
}

function send(phase: 'start' | 'move' | 'end') {
  getBridge()?.toHost({
    type: 'tab-drag',
    phase,
    x: cursor?.x ?? 0,
    y: cursor?.y ?? 0
  })
}

/** 单击还原便利贴 */
function onRestore() {
  getBridge()?.toHost({ type: 'restore' })
}

function onClick() {
  // 拖完那一下不算点击，并且就地消费掉，免得挡掉紧接着的下一次点击
  if (justDragged) {
    justDragged = false
    return
  }
  onRestore()
}

/** 关闭：交给管家先还原便利贴，再走便利贴原有的关闭流程 */
function onClose() {
  getBridge()?.toHost({ type: 'request-close' })
}

/** 中键关闭，和浏览器标签页的习惯一致 */
function onAuxClick(e: MouseEvent) {
  if (e.button === 1) {
    e.preventDefault()
    onClose()
  }
}
</script>
