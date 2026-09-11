const FRAME_WIDTH = 192
const FRAME_HEIGHT = 208
const PET_ACTIONS = [
  { id: 'idle', row: 0, frames: 6, durationMs: 1100 },
  { id: 'waving', row: 3, frames: 4, durationMs: 700 },
  { id: 'jumping', row: 4, frames: 5, durationMs: 840 },
  { id: 'running', row: 7, frames: 6, durationMs: 820 },
  { id: 'review', row: 8, frames: 6, durationMs: 1030 },
  { id: 'waiting', row: 6, frames: 6, durationMs: 1010 }
]

const state = {
  actionIndex: 0,
  lastInteractionActionIndex: 0,
  frameIndex: 0,
  frameStartedAt: performance.now(),
  dragging: false,
  moved: false,
  pointerId: null,
  pressPoint: null,
  image: null,
  scale: 0.72,
  opacity: 1,
  soundEnabled: false,
  returnToDefaultAnimation: true,
  sound: null
}

const canvas = document.querySelector('#pet-canvas')
const context = canvas.getContext('2d', { alpha: true })

/**
 * 把透明度应用到宠物画布，同时保留原生菜单的系统外观。
 * @param {number} opacity 目标透明度。
 * @returns {void} 无返回值。
 */
function setOpacity(opacity) {
  const normalized = Math.min(1, Math.max(0.2, Number(opacity) || 1))
  state.opacity = normalized
  canvas.style.opacity = String(normalized)
}

window.desktopPetView = { setOpacity }

/**
 * 启用或停用点击音效；停用时立即停止当前播放。
 * @param {boolean} enabled 是否启用宠物音效。
 * @returns {void} 无返回值。
 */
function setSoundEnabled(enabled) {
  state.soundEnabled = enabled === true
  canvas.dataset.soundEnabled = String(state.soundEnabled)
  if (!state.soundEnabled && state.sound) {
    state.sound.pause()
    state.sound.currentTime = 0
  }
}

window.desktopPetView.setSoundEnabled = setSoundEnabled

/**
 * 设置交互动作播放完成后是否恢复默认动画。
 * @param {boolean} enabled 是否自动恢复默认动画。
 * @returns {void} 无返回值。
 */
function setReturnToDefaultAnimation(enabled) {
  state.returnToDefaultAnimation = enabled !== false
  canvas.dataset.returnToDefaultAnimation = String(state.returnToDefaultAnimation)
}

window.desktopPetView.setReturnToDefaultAnimation = setReturnToDefaultAnimation

/**
 * 从头播放宠物短音效；浏览器拒绝播放时静默降级。
 * @returns {Promise<void>} 播放请求完成后的 Promise。
 */
async function playPetSound() {
  if (!state.soundEnabled || !state.sound) return
  state.sound.pause()
  state.sound.currentTime = 0
  try {
    await state.sound.play()
  } catch (error) {
    console.warn('[petdex-desktop-pet] failed to play pet sound', error)
  }
}

/**
 * 根据当前动作总时长计算单帧播放时长。
 * @param {{frames: number, durationMs: number}} action 当前动作。
 * @returns {number} 单帧毫秒数。
 */
function getFrameDuration(action) {
  return action.durationMs / action.frames
}

/**
 * 调整 Canvas 像素尺寸以匹配桌宠缩放和设备像素比。
 * @returns {void} 无返回值。
 */
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1
  const width = Math.round(FRAME_WIDTH * state.scale)
  const height = Math.round(FRAME_HEIGHT * state.scale)
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.imageSmoothingEnabled = false
}

/**
 * 绘制当前动作的当前帧并推进动画时钟。
 * @param {number} now 当前高精度时间。
 * @returns {void} 无返回值。
 */
function render(now) {
  const action = PET_ACTIONS[state.actionIndex]
  canvas.dataset.action = action.id
  const frameDuration = getFrameDuration(action)
  if (now - state.frameStartedAt >= frameDuration) {
    state.frameIndex = (state.frameIndex + 1) % action.frames
    state.frameStartedAt = now
    if (
      state.frameIndex === 0 &&
      state.actionIndex !== 0 &&
      !state.dragging &&
      state.returnToDefaultAnimation
    ) {
      state.actionIndex = 0
    }
  }
  const width = FRAME_WIDTH * state.scale
  const height = FRAME_HEIGHT * state.scale
  context.clearRect(0, 0, width, height)
  if (state.image) {
    context.drawImage(
      state.image,
      state.frameIndex * FRAME_WIDTH,
      action.row * FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      0,
      0,
      width,
      height
    )
  }
  requestAnimationFrame(render)
}

/**
 * 切换到下一个交互动作并从首帧播放。
 * @returns {void} 无返回值。
 */
function cycleAction() {
  state.lastInteractionActionIndex =
    state.lastInteractionActionIndex >= PET_ACTIONS.length - 1
      ? 1
      : state.lastInteractionActionIndex + 1
  state.actionIndex = state.lastInteractionActionIndex
  state.frameIndex = 0
  state.frameStartedAt = performance.now()
  canvas.dataset.action = PET_ACTIONS[state.actionIndex].id
  void playPetSound()
}

/**
 * 请求宿主显示桌宠原生右键菜单。
 * @param {MouseEvent} event 右键菜单事件。
 * @returns {void} 无返回值。
 */
function openContextMenu(event) {
  event.preventDefault()
  void window.desktopPet.showPetContextMenu()
}

/**
 * 执行宿主原生菜单返回的缩放、透明度或关闭命令。
 * @param {'zoom-in' | 'zoom-out' | 'opacity-increase' | 'opacity-decrease' | 'close'} command 菜单命令。
 * @returns {void} 无返回值。
 */
function handleContextMenuCommand(command) {
  if (command === 'close') {
    window.desktopPet.emitPetEvent('close')
    return
  }
  if (command === 'opacity-increase' || command === 'opacity-decrease') {
    // “透明度+”表示增加透明程度，因此需要降低 Canvas 的不透明度数值。
    const delta = command === 'opacity-increase' ? -0.1 : 0.1
    window.desktopPet.emitPetEvent('opacity-change', { delta })
    return
  }

  // 按固定步长更新缩放，并将边界与设置页保持一致。
  const direction = command === 'zoom-in' ? 1 : -1
  const nextScale = Math.min(
    1.4,
    Math.max(0.4, Math.round((state.scale + direction * 0.1) * 100) / 100)
  )
  if (nextScale === state.scale) return
  state.scale = nextScale
  resizeCanvas()
  window.desktopPet.emitPetEvent('scale-change', { scale: nextScale })
}

const unsubscribeContextMenuCommand =
  window.desktopPet.onPetContextMenuCommand(handleContextMenuCommand)

/**
 * 页面销毁前释放宿主菜单命令监听。
 * @returns {void} 无返回值。
 */
function disposePetPage() {
  // 页面销毁前停止媒体资源，避免桌宠关闭后继续播放。
  if (state.sound) {
    state.sound.pause()
    state.sound.currentTime = 0
    state.sound.src = ''
    state.sound = null
  }
  unsubscribeContextMenuCommand()
}

/**
 * 记录指针按下状态并通知父控制器开始窗口拖动。
 * @param {PointerEvent} event 指针事件。
 * @returns {void} 无返回值。
 */
function handlePointerDown(event) {
  if (event.button !== 0) return
  state.dragging = true
  state.moved = false
  state.pointerId = event.pointerId
  state.pressPoint = { x: event.screenX, y: event.screenY }
  canvas.classList.add('dragging')
  canvas.setPointerCapture(event.pointerId)
  window.desktopPet.emitPetEvent('drag-start', { x: event.screenX, y: event.screenY })
}

/**
 * 在拖动期间向父控制器发送屏幕坐标。
 * @param {PointerEvent} event 指针事件。
 * @returns {void} 无返回值。
 */
function handlePointerMove(event) {
  if (!state.dragging || event.pointerId !== state.pointerId) return
  if (state.pressPoint) {
    state.moved =
      state.moved ||
      Math.hypot(event.screenX - state.pressPoint.x, event.screenY - state.pressPoint.y) > 4
  }
  window.desktopPet.emitPetEvent('drag-move', { x: event.screenX, y: event.screenY })
}

/**
 * 结束拖动；未产生位移时把手势解释为点击换动作。
 * @param {PointerEvent} event 指针事件。
 * @returns {void} 无返回值。
 */
function handlePointerUp(event) {
  if (!state.dragging || event.pointerId !== state.pointerId) return
  state.dragging = false
  state.pointerId = null
  canvas.classList.remove('dragging')
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  window.desktopPet.emitPetEvent('drag-end', { x: event.screenX, y: event.screenY })
  if (!state.moved) cycleAction()
}

/**
 * 加载当前启用宠物并启动帧动画。
 * @returns {Promise<void>} 页面初始化完成后的 Promise。
 * @throws {Error} 缺少 slug 或本地宠物资源无法读取时抛错。
 */
async function initializePet() {
  const params = new URLSearchParams(window.location.search)
  const slug = params.get('slug')
  if (!slug) throw new Error('缺少桌宠标识')
  const payload = await window.desktopPet.getPetWindowPayload(slug)
  state.scale = Number(params.get('scale')) || 0.72
  setOpacity(Number(params.get('opacity')) || 1)
  setSoundEnabled(params.get('soundEnabled') === 'true')
  setReturnToDefaultAnimation(params.get('returnToDefaultAnimation') !== 'false')
  if (payload.soundUrl) {
    state.sound = new Audio(payload.soundUrl)
    state.sound.preload = 'auto'
  }
  resizeCanvas()
  const image = new Image()
  image.decoding = 'async'
  image.src = payload.spritesheetUrl
  await image.decode()
  state.image = image
  requestAnimationFrame(render)
}

canvas.addEventListener('pointerdown', handlePointerDown)
canvas.addEventListener('pointermove', handlePointerMove)
canvas.addEventListener('pointerup', handlePointerUp)
canvas.addEventListener('pointercancel', handlePointerUp)
canvas.addEventListener('contextmenu', openContextMenu)
window.addEventListener('beforeunload', disposePetPage, { once: true })

initializePet().catch((error) => {
  console.error('[petdex-desktop-pet] failed to initialize pet window', error)
  window.desktopPet.emitPetEvent('load-error', { message: error.message })
})
