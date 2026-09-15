const TOOLTIP_STATE = Symbol('zvc-tooltip-state')
const TOOLTIP_ID = 'zvc-global-tooltip'
const DEFAULT_DELAY_MS = 500
const EDGE_MARGIN_PX = 12
const TOOLTIP_GAP_PX = 8
const SUPPORTED_SIDES = new Set(['right', 'bottom', 'top'])

let activeAnchor = null
let tooltipBubble = null
let mountedTooltipCount = 0

/**
 * 将指令值和修饰符规范化为稳定的提示配置。
 * @param {import('vue').DirectiveBinding} binding Vue 指令绑定信息。
 * @returns {{label: string, side: 'right'|'bottom'|'top', delayMs: number, maxWidth: number|null, disabled: boolean, overflowOnly: boolean}} 规范化后的提示配置。
 */
function normalizeTooltipBinding(binding) {
  const input = binding.value && typeof binding.value === 'object'
    ? binding.value
    : { label: binding.value }
  const modifierSide = ['right', 'bottom', 'top'].find((side) => binding.modifiers?.[side])
  const requestedSide = modifierSide || input.side
  const requestedDelay = binding.modifiers?.instant ? 0 : Number(input.delayMs)
  const requestedMaxWidth = Number(input.maxWidth)
  return {
    label: String(input.label ?? '').trim(),
    side: SUPPORTED_SIDES.has(requestedSide) ? requestedSide : 'bottom',
    delayMs: Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : DEFAULT_DELAY_MS,
    maxWidth: Number.isFinite(requestedMaxWidth) && requestedMaxWidth > 0 ? requestedMaxWidth : null,
    disabled: Boolean(input.disabled),
    overflowOnly: Boolean(input.overflowOnly),
  }
}

/**
 * 判断锚点当前是否满足提示显示条件。
 * @param {HTMLElement} anchor 提示锚点。
 * @param {Record<string, unknown>} state 当前指令状态。
 * @returns {boolean} 配置有效且文本需要提示时返回 true。
 */
function canShowTooltip(anchor, state) {
  if (!state?.config?.label || state.config.disabled || !anchor.isConnected) return false
  if (!state.config.overflowOnly) return true
  // 仅在元素实际发生横向或纵向裁切时展示完整内容。
  return anchor.scrollWidth > anchor.clientWidth + 1 || anchor.scrollHeight > anchor.clientHeight + 1
}

/**
 * 创建或返回复用的全局提示层，避免每个按钮产生独立浮层节点。
 * @returns {HTMLSpanElement} 已挂载到 document.body 的提示层。
 */
function ensureTooltipBubble() {
  if (tooltipBubble?.isConnected) return tooltipBubble
  tooltipBubble = document.createElement('span')
  tooltipBubble.id = TOOLTIP_ID
  tooltipBubble.className = 'zvc-tooltip'
  tooltipBubble.setAttribute('role', 'tooltip')
  tooltipBubble.hidden = true
  document.body.appendChild(tooltipBubble)
  return tooltipBubble
}

/**
 * 清除指定锚点尚未触发的悬浮计时器。
 * @param {HTMLElement} anchor 提示锚点。
 * @returns {void} 无返回值。
 */
function clearTooltipTimer(anchor) {
  const state = anchor[TOOLTIP_STATE]
  if (!state?.timerId) return
  window.clearTimeout(state.timerId)
  state.timerId = 0
}

/**
 * 恢复锚点原有的无障碍描述关联。
 * @param {HTMLElement} anchor 提示锚点。
 * @returns {void} 无返回值。
 */
function restoreAnchorDescription(anchor) {
  const state = anchor[TOOLTIP_STATE]
  if (!state) return
  if (state.previousDescribedBy) anchor.setAttribute('aria-describedby', state.previousDescribedBy)
  else anchor.removeAttribute('aria-describedby')
}

/**
 * 隐藏当前提示层并释放锚点关联。
 * @param {HTMLElement|null} anchor 请求隐藏的锚点；为空时隐藏任意活动提示。
 * @returns {void} 无返回值。
 */
function hideTooltip(anchor = null) {
  if (anchor) clearTooltipTimer(anchor)
  if (anchor && activeAnchor !== anchor) return
  if (activeAnchor) restoreAnchorDescription(activeAnchor)
  activeAnchor = null
  if (tooltipBubble) tooltipBubble.hidden = true
}

/**
 * 根据锚点边界放置提示层，并在视口边缘自动平移或上下翻转。
 * @param {HTMLElement} anchor 提示锚点。
 * @param {HTMLSpanElement} bubble 提示层节点。
 * @param {'right'|'bottom'|'top'} requestedSide 首选方向。
 * @returns {void} 无返回值。
 */
function positionTooltip(anchor, bubble, requestedSide) {
  const anchorRect = anchor.getBoundingClientRect()
  let placement = requestedSide
  const bubbleHeight = bubble.offsetHeight
  const fitsBelow = anchorRect.bottom + TOOLTIP_GAP_PX + bubbleHeight <= window.innerHeight - EDGE_MARGIN_PX
  const fitsAbove = anchorRect.top - TOOLTIP_GAP_PX - bubbleHeight >= EDGE_MARGIN_PX

  // 只有另一侧完整容纳提示时才翻转，避免空间不足时反复跳动。
  if (placement === 'bottom' && !fitsBelow && fitsAbove) placement = 'top'
  else if (placement === 'top' && !fitsAbove && fitsBelow) placement = 'bottom'

  bubble.dataset.side = placement
  bubble.style.left = placement === 'right'
    ? `${anchorRect.right + 10}px`
    : `${anchorRect.left + anchorRect.width / 2}px`
  bubble.style.top = placement === 'right'
    ? `${anchorRect.top + anchorRect.height / 2}px`
    : placement === 'top'
      ? `${anchorRect.top - TOOLTIP_GAP_PX}px`
      : `${anchorRect.bottom + TOOLTIP_GAP_PX}px`

  // 固定定位不会自动避让横向边界，测量后将浮层限制在安全边距内。
  const measured = bubble.getBoundingClientRect()
  let horizontalOffset = 0
  if (measured.right > window.innerWidth - EDGE_MARGIN_PX) {
    horizontalOffset = window.innerWidth - EDGE_MARGIN_PX - measured.right
  }
  if (measured.left + horizontalOffset < EDGE_MARGIN_PX) {
    horizontalOffset += EDGE_MARGIN_PX - (measured.left + horizontalOffset)
  }
  if (horizontalOffset) bubble.style.left = `${Number.parseFloat(bubble.style.left) + horizontalOffset}px`
}

/**
 * 立即显示指定锚点的提示层。
 * @param {HTMLElement} anchor 提示锚点。
 * @returns {void} 无返回值。
 */
function showTooltip(anchor) {
  const state = anchor[TOOLTIP_STATE]
  if (!canShowTooltip(anchor, state)) {
    if (activeAnchor === anchor) hideTooltip(anchor)
    return
  }
  clearTooltipTimer(anchor)
  if (activeAnchor && activeAnchor !== anchor) hideTooltip(activeAnchor)

  const bubble = ensureTooltipBubble()
  activeAnchor = anchor
  bubble.textContent = state.config.label
  bubble.style.maxWidth = state.config.maxWidth ? `${state.config.maxWidth}px` : ''
  bubble.hidden = false
  const describedBy = [state.previousDescribedBy, TOOLTIP_ID].filter(Boolean).join(' ')
  anchor.setAttribute('aria-describedby', describedBy)
  positionTooltip(anchor, bubble, state.config.side)
}

/**
 * 按配置延迟显示悬浮提示，键盘聚焦由调用方直接显示。
 * @param {HTMLElement} anchor 提示锚点。
 * @returns {void} 无返回值。
 */
function scheduleTooltip(anchor) {
  const state = anchor[TOOLTIP_STATE]
  if (!canShowTooltip(anchor, state)) return
  clearTooltipTimer(anchor)
  if (state.config.delayMs === 0) {
    showTooltip(anchor)
    return
  }
  state.timerId = window.setTimeout(() => {
    state.timerId = 0
    if (state.hovered) showTooltip(anchor)
  }, state.config.delayMs)
}

/**
 * 在视口尺寸或滚动位置变化后重新计算当前提示位置。
 * @returns {void} 无返回值。
 */
function handleTooltipViewportChange() {
  if (!activeAnchor || !tooltipBubble || tooltipBubble.hidden) return
  const state = activeAnchor[TOOLTIP_STATE]
  if (!state) {
    hideTooltip()
    return
  }
  positionTooltip(activeAnchor, tooltipBubble, state.config.side)
}

/**
 * 为元素挂载提示交互，并保留它已有的无障碍描述。
 * @param {HTMLElement} anchor 待增强的锚点元素。
 * @param {import('vue').DirectiveBinding} binding Vue 指令绑定信息。
 * @returns {void} 无返回值。
 */
function mountTooltip(anchor, binding) {
  const state = {
    config: normalizeTooltipBinding(binding),
    previousDescribedBy: anchor.getAttribute('aria-describedby') || '',
    hovered: false,
    focused: false,
    timerId: 0,
    handlers: {},
  }
  state.handlers.mouseenter = () => {
    state.hovered = true
    scheduleTooltip(anchor)
  }
  state.handlers.mouseleave = () => {
    state.hovered = false
    // 与 Harness 一致，指针移出时立即收起，避免聚焦状态留下悬空提示。
    hideTooltip(anchor)
  }
  state.handlers.focus = () => {
    state.focused = true
    showTooltip(anchor)
  }
  state.handlers.blur = () => {
    state.focused = false
    if (!state.hovered) hideTooltip(anchor)
  }
  anchor[TOOLTIP_STATE] = state
  anchor.addEventListener('mouseenter', state.handlers.mouseenter)
  anchor.addEventListener('mouseleave', state.handlers.mouseleave)
  anchor.addEventListener('focus', state.handlers.focus)
  anchor.addEventListener('blur', state.handlers.blur)

  mountedTooltipCount += 1
  if (mountedTooltipCount === 1) {
    window.addEventListener('resize', handleTooltipViewportChange)
    document.addEventListener('scroll', handleTooltipViewportChange, true)
  }
}

/**
 * 在响应式值变化时更新元素提示，并同步当前可见浮层。
 * @param {HTMLElement} anchor 已挂载的提示锚点。
 * @param {import('vue').DirectiveBinding} binding 最新 Vue 指令绑定信息。
 * @returns {void} 无返回值。
 */
function updateTooltip(anchor, binding) {
  const state = anchor[TOOLTIP_STATE]
  if (!state) return
  state.config = normalizeTooltipBinding(binding)
  if (activeAnchor !== anchor) return
  if (!canShowTooltip(anchor, state)) {
    hideTooltip(anchor)
    return
  }
  showTooltip(anchor)
}

/**
 * 移除元素提示交互，并在最后一个实例卸载后释放全局资源。
 * @param {HTMLElement} anchor 待清理的提示锚点。
 * @returns {void} 无返回值。
 */
function unmountTooltip(anchor) {
  const state = anchor[TOOLTIP_STATE]
  if (!state) return
  hideTooltip(anchor)
  anchor.removeEventListener('mouseenter', state.handlers.mouseenter)
  anchor.removeEventListener('mouseleave', state.handlers.mouseleave)
  anchor.removeEventListener('focus', state.handlers.focus)
  anchor.removeEventListener('blur', state.handlers.blur)
  delete anchor[TOOLTIP_STATE]

  mountedTooltipCount = Math.max(0, mountedTooltipCount - 1)
  if (mountedTooltipCount > 0) return
  // 页面不再包含提示锚点时释放全局监听和浮层，便于开发热重载干净重建。
  window.removeEventListener('resize', handleTooltipViewportChange)
  document.removeEventListener('scroll', handleTooltipViewportChange, true)
  tooltipBubble?.remove()
  tooltipBubble = null
}

export default {
  mounted: mountTooltip,
  updated: updateTooltip,
  beforeUnmount: unmountTooltip,
}
