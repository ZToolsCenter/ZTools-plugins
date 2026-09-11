<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { writeClipboard } from '../utils/clipboard.js'

const props = defineProps({
  workspace: { type: Object, required: true },
})

const anchor = ref(null)
const card = ref(null)
const open = ref(false)
const positioned = ref(false)
const copied = ref(false)
const position = ref({ left: 0, top: 0 })
let openTimer = 0
let closeTimer = 0
let copiedTimer = 0
let copyPending = false

/**
 * 将工作区创建时间格式化为稳定的中文绝对时间。
 * @param {unknown} timestamp 工作区创建时间戳。
 * @returns {string} `创建于 YYYY年M月D日 HH:mm` 格式文本；时间无效时返回空字符串。
 */
function formatCreatedAt(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `创建于 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

/**
 * 清除指定计时器，并返回可重新赋值的空计时器标识。
 * @param {number} timerId 浏览器计时器标识。
 * @returns {number} 固定返回 0，便于调用方同步重置状态。
 */
function clearTimer(timerId) {
  if (timerId) window.clearTimeout(timerId)
  return 0
}

/**
 * 根据工作区行位置计算右侧卡片坐标，并避让视口边界。
 * @returns {void} 无返回值。
 */
function updatePosition() {
  if (!anchor.value || !card.value) return
  const anchorBounds = anchor.value.getBoundingClientRect()
  const cardBounds = card.value.getBoundingClientRect()
  const edge = 8
  const preferredLeft = anchorBounds.right + 8
  const maxLeft = Math.max(edge, window.innerWidth - cardBounds.width - edge)
  const maxTop = Math.max(edge, window.innerHeight - cardBounds.height - edge)

  // 正常空间始终放在工作区右侧，窄窗口只做视口边缘钳制。
  position.value = {
    left: Math.min(preferredLeft, maxLeft),
    top: Math.min(Math.max(edge, anchorBounds.top), maxTop),
  }
  positioned.value = true
}

/**
 * 打开工作区信息卡，并在渲染完成后校准固定定位坐标。
 * @returns {Promise<void>} 卡片完成渲染与定位后的 Promise。
 */
async function openCard() {
  closeTimer = clearTimer(closeTimer)
  if (open.value) return
  positioned.value = false
  open.value = true
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  updatePosition()
  window.addEventListener('resize', updatePosition)
  document.addEventListener('scroll', updatePosition, true)
}

/**
 * 在 Harness 使用的驻留延迟后打开工作区信息卡。
 * @returns {void} 无返回值。
 */
function scheduleOpen() {
  closeTimer = clearTimer(closeTimer)
  if (open.value || openTimer) return
  openTimer = window.setTimeout(() => {
    openTimer = 0
    void openCard()
  }, 500)
}

/**
 * 关闭工作区信息卡并释放只在显示期间需要的视口监听。
 * @returns {void} 无返回值。
 */
function closeCard() {
  openTimer = clearTimer(openTimer)
  closeTimer = clearTimer(closeTimer)
  copiedTimer = clearTimer(copiedTimer)
  copied.value = false
  positioned.value = false
  open.value = false
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('scroll', updatePosition, true)
}

/**
 * 延迟关闭卡片，为指针跨越锚点与右侧卡片之间的间隙预留时间。
 * @returns {void} 无返回值。
 */
function scheduleClose() {
  openTimer = clearTimer(openTimer)
  closeTimer = clearTimer(closeTimer)
  if (!open.value) return
  closeTimer = window.setTimeout(closeCard, 120)
}

/**
 * 复制工作区完整路径，并短暂显示成功反馈。
 * @returns {Promise<void>} 剪贴板写入和反馈状态更新完成后的 Promise。
 */
async function copyWorkspacePath() {
  const path = String(props.workspace?.path || '')
  if (!path || copied.value || copyPending) return
  copyPending = true
  const accepted = await writeClipboard(path)
  copyPending = false
  if (!accepted || !open.value) return

  // 复制成功后保持卡片尺寸稳定，并在一秒后恢复详情。
  copied.value = true
  copiedTimer = clearTimer(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copiedTimer = 0
    copied.value = false
  }, 1000)
}

/**
 * 处理卡片键盘激活，仅接受 Enter 和空格键。
 * @param {KeyboardEvent} event 卡片键盘事件。
 * @returns {void} 无返回值。
 */
function handleCardKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  void copyWorkspacePath()
}

onBeforeUnmount(() => {
  // 组件释放时终止延迟任务和全局监听，防止切换会话后遗留浮层。
  copyPending = false
  closeCard()
})
</script>

<template>
  <div
    ref="anchor"
    class="workspace-hover-anchor"
    @pointerenter="scheduleOpen"
    @pointerleave="scheduleClose"
    @pointerdown="closeCard"
  >
    <slot />
  </div>
  <Teleport to="body">
    <div
      v-if="open"
      ref="card"
      class="workspace-hover-card"
      :class="{ 'is-positioned': positioned, 'is-copied': copied }"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      role="button"
      tabindex="0"
      :aria-label="`复制: ${workspace.path}`"
      @pointerenter="closeTimer = clearTimer(closeTimer)"
      @pointerleave="scheduleClose"
      @click="copyWorkspacePath"
      @keydown="handleCardKeydown"
    >
      <span v-if="copied" class="workspace-hover-copied" role="status">已复制</span>
      <template v-else>
        <strong>{{ workspace.name }}</strong>
        <span class="workspace-hover-path">{{ workspace.path }}</span>
        <time v-if="formatCreatedAt(workspace.createdAt)">{{ formatCreatedAt(workspace.createdAt) }}</time>
      </template>
    </div>
  </Teleport>
</template>
