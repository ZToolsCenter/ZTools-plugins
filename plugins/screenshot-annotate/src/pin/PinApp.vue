<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const params = new URLSearchParams(location.search)
const winId = params.get('win') || ''
const rawImg = params.get('img') || ''

// img query 可能是内联 dataURL，也可能是临时文件路径（大图走文件通道），统一解析为 dataURL
const imgSrc = ref('')

const imgRef = ref<HTMLImageElement>()
const menu = ref<{ x: number; y: number } | null>(null)
const alwaysOnTop = ref(true)

let naturalW = 0
let naturalH = 0

function resolveImg(raw: string): string {
  if (raw.startsWith('data:image/')) return raw
  try {
    return window.services.readTempImage(decodeURIComponent(raw))
  } catch {
    return ''
  }
}

function closeWin() {
  // 子窗口自身 preload 的 pins map 是空的（窗口由主窗口 preload 创建并注册），
  // pinClose 找不到 winId 会静默失败 → 关闭按钮 / Esc 全失效。
  // 因此这里用渲染进程原生 window.close() 直接关掉当前 browserWindow（ZTms 内部同款）。
  window.close()
}

/** 所有依赖主窗口 pins map 的钉图窗口操作，统一经 sendToParent 送回主窗口执行 */
function pinCmd(action: 'move' | 'resize' | 'setTop' | 'setBounds', obj: Record<string, unknown> = {}) {
  const anyZtools = window.ztools as unknown as {
    sendToParent?: (channel: string, ...args: unknown[]) => void
  }
  if (winId && typeof anyZtools.sendToParent === 'function') {
    anyZtools.sendToParent('screenshot-annotate:pin-cmd', { winId, action, ...obj })
  }
}
function copyImg() {
  window.services.copyImageDataURL(imgSrc.value)
  menu.value = null
}
function saveImg() {
  const r = window.services.saveImageDataURL(imgSrc.value, { format: 'png' })
  menu.value = null
  // 无 toast 通道时静默；success 跳过
  void r
}
function toggleTop() {
  alwaysOnTop.value = !alwaysOnTop.value
  pinCmd('setTop', { flag: alwaysOnTop.value })
  menu.value = null
}
function onContext(e: MouseEvent) {
  e.preventDefault()
  menu.value = { x: e.clientX, y: e.clientY }
}
function closeMenu() {
  menu.value = null
}

// ── 拖动：绝对屏幕坐标定位移动窗口 ──
// 目标位置 = `screenX - clientX`（= 窗口左上角屏幕坐标，frame:false 恒成立），
// 由指针绝对位置算出，不含窗口当前位置，被 setPosition 移动后不会反馋进下一次目标，
// 彻底规避"clientX 相对窗口 + 增量回读"导致的整窗往返震动。rAF 合并，目标未变不发。
let dragging = false
let moveTargetX = 0
let moveTargetY = 0
let rafPending = false
// 拖动开始时指针相对窗口的位置（固定基准）。onMove 必须用这个**起始**值而非实时 e.clientX：
// 实时 clientX 会随窗口移动而变化，与 screenX 同步相减后得到的是"窗口当前位置"这个常数，
// setPosition(原位) 永远移不动 → 拖不动。用固定 startClient 则目标随 screenX 单调变化 → 窗口跟随。
let startClientX = 0
let startClientY = 0
function flushMove() {
  rafPending = false
  // mousemove 只在指针真正移动时触发（指针静止不发事件），因此被调度就必然动过，
  // 直接发绝对目标；不设 `target===lastSent` 去重——那类拦截会在坐标恒等于初始值时
  // 把窗口钉死原地（"完全拖不动"），而 rAF 节流本身已保证静止不产生 IPC。
  pinCmd('move', { x: Math.round(moveTargetX), y: Math.round(moveTargetY) })
}
function onDown(e: MouseEvent) {
  if (menu.value) {
    closeMenu()
    return
  }
  dragging = true
  startClientX = e.clientX
  startClientY = e.clientY
  // 拖动起始基准：窗口左上角屏幕坐标 = 按下时 screenX - clientX
  moveTargetX = e.screenX - startClientX
  moveTargetY = e.screenY - startClientY
  imgRef.value?.classList.add('dragging')
  // 捕获后续 pointer，防止移出图片/窗口丢事件
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
function onMove(e: MouseEvent) {
  if (!dragging) return
  // 兜底：左键实际已松开（e.buttons 左键位为 0）但 mouseup 丢失（拖窗时指针可能移出窗口）→ 强制复位
  if (e.buttons === undefined || (e.buttons & 1) === 0) {
    onUp()
    return
  }
  if (!winId) return
  // 窗口左上角目标 = screenX - 固定基准 startClient。用固定 startClient 而非实时 e.clientX，
  // 使目标随指针屏幕位置单调变化（跟随移动），避免"实时 clientX 抵消 → 目标恒为原位 → 拖不动"。
  moveTargetX = e.screenX - startClientX
  moveTargetY = e.screenY - startClientY
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(flushMove)
  }
}
function onUp() {
  dragging = false
  // 把最后一次未提交的目标发出，避免拖尾残留
  if (rafPending) {
    rafPending = false
    flushMove()
  }
  imgRef.value?.classList.remove('dragging')
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}

// ── 滚轮缩放（左上锚改尺寸）──
function onWheel(e: WheelEvent) {
  if (!winId) return
  e.preventDefault()
  const step = e.deltaY > 0 ? -60 : 60
  pinCmd('resize', { dw: step, dh: step })
}

// ── 双击：回到图片自然尺寸（自适应） ──
function fitNatural() {
  if (!winId || !naturalW || !naturalH) return
  // 贴合图片自然尺寸（仅留极小边距保证圆角阴影不被裁切，透明区无黑框）
  const pad = 4
  const nw = naturalW + pad * 2
  const nh = naturalH + pad * 2
  pinCmd('setBounds', { bounds: { x: 0, y: 0, width: nw, height: nh } })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeWin()
    return
  }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase()
    if (k === 'c') {
      e.preventDefault()
      copyImg()
    } else if (k === 's') {
      e.preventDefault()
      saveImg()
    } else if (k === 'q') {
      e.preventDefault()
      closeWin()
    }
  }
}

onMounted(() => {
  imgSrc.value = resolveImg(rawImg)
  const img = imgRef.value
  if (img && imgSrc.value) {
    img.onload = () => {
      naturalW = img.naturalWidth
      naturalH = img.naturalHeight
    }
    img.src = imgSrc.value
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', closeMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
})
</script>

<template>
  <div class="pin-root" @contextmenu.prevent="onContext" @pointerdown.self="closeMenu">
    <img
      ref="imgRef"
      v-if="imgSrc"
      class="pin-image"
      :src="imgSrc"
      draggable="false"
      @mousedown="onDown"
      @wheel.prevent="onWheel"
      @dblclick="fitNatural"
    />

    <div v-if="menu" class="pin-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
      <button @click="copyImg">复制</button>
      <button @click="saveImg">保存</button>
      <div class="sep" />
      <button @click="toggleTop">{{ alwaysOnTop ? '取消置顶' : '置顶' }}</button>
      <div class="sep" />
      <button @click="closeWin">关闭</button>
    </div>
  </div>
</template>