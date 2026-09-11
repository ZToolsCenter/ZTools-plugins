import type { InstalledPet, PetRuntimeConfig, PetWindowHandle } from './types'

const FRAME_WIDTH = 192
const FRAME_HEIGHT = 208
const POSITION_MARGIN = 12

let petWindow: PetWindowHandle | null = null
let activeSlug: string | null = null
let activeScale: number | null = null
let dragState: {
  cursorX: number
  cursorY: number
  windowX: number
  windowY: number
} | null = null
let unsubscribePetEvents: (() => void) | null = null

/**
 * 计算缩放后的桌宠窗口尺寸。
 * @param scale 桌宠缩放比例。
 * @returns 桌宠窗口宽高。
 */
export function getPetWindowSize(scale: number): { width: number; height: number } {
  return {
    width: Math.round(FRAME_WIDTH * scale),
    height: Math.round(FRAME_HEIGHT * scale)
  }
}

/**
 * 把桌宠位置限制在最近显示器的可用工作区内。
 * @param position 期望的窗口左上角位置。
 * @param size 当前桌宠窗口尺寸。
 * @returns 调整后的安全位置。
 */
export function constrainPetPosition(
  position: { x: number; y: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  const display = window.ztools.getDisplayNearestPoint(position)
  const workArea = display.workArea ?? display.bounds
  const minimumX = workArea.x + POSITION_MARGIN
  const minimumY = workArea.y + POSITION_MARGIN
  const maximumX = workArea.x + workArea.width - size.width - POSITION_MARGIN
  const maximumY = workArea.y + workArea.height - size.height - POSITION_MARGIN
  return {
    x: Math.min(Math.max(Math.round(position.x), minimumX), Math.max(minimumX, maximumX)),
    y: Math.min(Math.max(Math.round(position.y), minimumY), Math.max(minimumY, maximumY))
  }
}

/**
 * 为首次启用的桌宠选择主显示器右下角位置。
 * @param size 当前桌宠窗口尺寸。
 * @returns 默认窗口位置。
 */
function getDefaultPosition(size: { width: number; height: number }): { x: number; y: number } {
  const display = window.ztools.getPrimaryDisplay()
  const workArea = display.workArea ?? display.bounds
  return constrainPetPosition(
    {
      x: workArea.x + workArea.width - size.width - 48,
      y: workArea.y + workArea.height - size.height - 48
    },
    size
  )
}

/**
 * 判断当前桌宠子窗口仍然可用。
 * @returns 子窗口存在且未销毁时返回 true。
 */
function hasLiveWindow(): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed())
}

/**
 * 保存当前窗口位置并同步传入的运行配置。
 * @param config 当前运行配置。
 * @returns 已保存的新运行配置。
 */
async function persistCurrentPosition(config: PetRuntimeConfig): Promise<PetRuntimeConfig> {
  if (!hasLiveWindow() || !petWindow) return config
  const [x, y] = petWindow.getPosition()
  return window.desktopPet.saveRuntimeConfig({ ...config, position: { x, y } })
}

/**
 * 把子窗口产生的运行配置变化发布给桌宠管理界面。
 * @param config 最新运行配置。
 * @returns 无返回值。
 */
function publishRuntimeConfig(config: PetRuntimeConfig): void {
  window.dispatchEvent(new CustomEvent('petdex-desktop-pet:runtime-config', { detail: config }))
}

/**
 * 把透明度应用到桌宠画布，避免系统原生菜单随窗口一起变淡。
 * @param opacity 规范化后的桌宠透明度。
 * @returns 应用完成后的 Promise。
 */
async function applyPetOpacity(opacity: number): Promise<void> {
  if (!hasLiveWindow() || !petWindow) return
  await petWindow.webContents.executeJavaScript(
    `window.desktopPetView?.setOpacity(${JSON.stringify(opacity)})`
  )
}

/**
 * 将声音开关同步到当前桌宠页面。
 * @param enabled 是否允许点击时播放音效。
 * @returns 应用完成后的 Promise。
 */
async function applyPetSoundEnabled(enabled: boolean): Promise<void> {
  if (!hasLiveWindow() || !petWindow) return
  await petWindow.webContents.executeJavaScript(
    `window.desktopPetView?.setSoundEnabled(${JSON.stringify(enabled)})`
  )
}

/**
 * 将交互动作结束后的恢复策略同步到当前桌宠页面。
 * @param enabled 是否在交互动作播放一遍后恢复默认动画。
 * @returns 应用完成后的 Promise。
 */
async function applyReturnToDefaultAnimation(enabled: boolean): Promise<void> {
  if (!hasLiveWindow() || !petWindow) return
  await petWindow.webContents.executeJavaScript(
    `window.desktopPetView?.setReturnToDefaultAnimation(${JSON.stringify(enabled)})`
  )
}

/**
 * 处理桌宠子窗口发来的拖动、加载失败和状态事件。
 * @param payload 子窗口事件载荷。
 * @returns 事件处理完成后的 Promise。
 */
async function handlePetEvent(payload: {
  type: string
  detail: Record<string, unknown>
}): Promise<void> {
  if (!hasLiveWindow() || !petWindow) return
  if (payload.type === 'drag-start') {
    const [windowX, windowY] = petWindow.getPosition()
    dragState = {
      cursorX: Number(payload.detail.x) || 0,
      cursorY: Number(payload.detail.y) || 0,
      windowX,
      windowY
    }
    return
  }
  if (payload.type === 'drag-move' && dragState) {
    const config = await window.desktopPet.getRuntimeConfig()
    const size = getPetWindowSize(config.scale)
    const position = constrainPetPosition(
      {
        x: dragState.windowX + (Number(payload.detail.x) - dragState.cursorX),
        y: dragState.windowY + (Number(payload.detail.y) - dragState.cursorY)
      },
      size
    )
    petWindow.setPosition(position.x, position.y)
    return
  }
  if (payload.type === 'drag-end') {
    dragState = null
    const config = await window.desktopPet.getRuntimeConfig()
    await persistCurrentPosition(config)
    return
  }
  if (payload.type === 'scale-change') {
    const currentConfig = await window.desktopPet.getRuntimeConfig()
    const requestedScale = Number(payload.detail.scale)
    const scale = Math.min(
      1.4,
      Math.max(0.4, Number.isFinite(requestedScale) ? requestedScale : currentConfig.scale)
    )
    const size = getPetWindowSize(scale)
    const [x, y] = petWindow.getPosition()
    const position = constrainPetPosition({ x, y }, size)

    // 先同步原生窗口，再持久化最终尺寸与安全位置。
    petWindow.setSize(size.width, size.height)
    petWindow.setPosition(position.x, position.y)
    activeScale = scale
    const config = await window.desktopPet.saveRuntimeConfig({
      ...currentConfig,
      scale,
      position
    })
    publishRuntimeConfig(config)
    return
  }
  if (payload.type === 'opacity-change') {
    const currentConfig = await window.desktopPet.getRuntimeConfig()
    const requestedDelta = Number(payload.detail.delta)
    const delta = Number.isFinite(requestedDelta) ? requestedDelta : 0
    const opacity = Math.min(
      1,
      Math.max(0.2, Math.round((currentConfig.opacity + delta) * 100) / 100)
    )

    // 画布透明度和持久化配置使用同一规范化值，原生菜单保持系统正常外观。
    await applyPetOpacity(opacity)
    const config = await window.desktopPet.saveRuntimeConfig({
      ...currentConfig,
      opacity
    })
    publishRuntimeConfig(config)
    return
  }
  if (payload.type === 'close') {
    const currentConfig = await window.desktopPet.getRuntimeConfig()

    // 关闭前保留最后位置并停用，防止插件下次进入时自动恢复桌宠。
    const config = await persistCurrentPosition({ ...currentConfig, enabled: false })
    publishRuntimeConfig(config)
    closePetWindow()
    return
  }
  if (payload.type === 'load-error') {
    console.error('[petdex-desktop-pet] child window failed to load', payload.detail.message)
    closePetWindow()
  }
}

/**
 * 注册桌宠子窗口事件监听，重复调用时复用单个监听器。
 * @returns 无返回值。
 */
function ensurePetEventSubscription(): void {
  if (unsubscribePetEvents) return
  unsubscribePetEvents = window.desktopPet.onPetEvent((payload) => {
    void handlePetEvent(payload)
  })
}

/**
 * 关闭并清理当前桌宠窗口引用。
 * @returns 无返回值。
 */
export function closePetWindow(): void {
  dragState = null
  activeSlug = null
  activeScale = null
  if (petWindow && !petWindow.isDestroyed()) petWindow.close()
  petWindow = null
}

/**
 * 创建或复用当前启用宠物的透明桌面窗口。
 * @param pet 已安装宠物信息。
 * @param config 当前运行配置。
 * @returns 桌宠窗口创建完成后的 Promise。
 */
export async function showPetWindow(pet: InstalledPet, config: PetRuntimeConfig): Promise<void> {
  ensurePetEventSubscription()
  const size = getPetWindowSize(config.scale)
  const desiredPosition = constrainPetPosition(config.position ?? getDefaultPosition(size), size)

  // 同一宠物只更新窗口属性，切换宠物或缩放时重建本地页面。
  if (hasLiveWindow() && petWindow && activeSlug === pet.slug && activeScale === config.scale) {
    petWindow.setAlwaysOnTop(config.alwaysOnTop)
    await applyPetOpacity(config.opacity)
    await applyPetSoundEnabled(config.soundEnabled)
    await applyReturnToDefaultAnimation(config.returnToDefaultAnimation)
    petWindow.setPosition(desiredPosition.x, desiredPosition.y)
    petWindow.show()
    return
  }
  closePetWindow()
  const query = new URLSearchParams({
    slug: pet.slug,
    scale: String(config.scale),
    opacity: String(config.opacity),
    soundEnabled: String(config.soundEnabled),
    returnToDefaultAnimation: String(config.returnToDefaultAnimation)
  })
  const created = window.ztools.createBrowserWindow(`pet.html?${query.toString()}`, {
    width: size.width,
    height: size.height,
    x: desiredPosition.x,
    y: desiredPosition.y,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    // 桌宠只处理指针交互，不获取键盘焦点，避免插件进入时宿主主窗口因失焦而隐藏。
    focusable: false,
    webPreferences: {
      preload: 'preload/services.js',
      backgroundThrottling: false,
      zoomFactor: 1
    }
  }) as unknown as PetWindowHandle
  petWindow = created
  activeSlug = pet.slug
  activeScale = config.scale
}

/**
 * 根据持久化配置恢复桌宠；宠物缺失时自动关闭启用状态。
 * @returns 恢复完成后的 Promise。
 */
export async function restorePetWindow(): Promise<void> {
  const config = await window.desktopPet.getRuntimeConfig()
  if (!config.enabled || !config.activeSlug) return
  const installedPets = await window.desktopPet.listInstalledPets()
  const pet = installedPets.find((item) => item.slug === config.activeSlug)
  if (!pet) {
    await window.desktopPet.saveRuntimeConfig({ ...config, enabled: false, activeSlug: null })
    closePetWindow()
    return
  }
  await showPetWindow(pet, config)
}

/**
 * 更新运行配置并把变化应用到当前桌宠窗口。
 * @param nextConfig 新运行配置。
 * @param installedPets 当前已安装宠物列表。
 * @returns 保存后的运行配置。
 */
export async function applyPetRuntimeConfig(
  nextConfig: PetRuntimeConfig,
  installedPets: InstalledPet[]
): Promise<PetRuntimeConfig> {
  const config = await window.desktopPet.saveRuntimeConfig(nextConfig)
  if (!config.enabled || !config.activeSlug) {
    closePetWindow()
    return config
  }
  const pet = installedPets.find((item) => item.slug === config.activeSlug)
  if (!pet) throw new Error('启用的宠物尚未安装')

  await showPetWindow(pet, config)
  return config
}

/**
 * 释放父页面注册的事件监听；宿主完全终止插件时调用。
 * @returns 无返回值。
 */
export function disposePetWindowController(): void {
  closePetWindow()
  unsubscribePetEvents?.()
  unsubscribePetEvents = null
}
