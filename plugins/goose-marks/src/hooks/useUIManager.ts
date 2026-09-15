import { create } from 'zustand'

/**
 * 统一的 UI 状态管理（React / Zustand 版）
 * --------------------------------------------------------------------------
 * 整合 Tooltip、Toast、Dialog 等全局 UI 状态。旧版 Vue 用模块级 ref 共享，
 * React 等价做法是用一个模块级 Zustand store 承载共享状态，组件用
 * useUIManager() 订阅。纯 UI 反馈逻辑。
 */

// ============ Toast 类型 ============
export type ToastVariant = 'success' | 'info' | 'warning' | 'error'
export type ToastPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** 锚点信息，用于智能计算 Toast 位置 */
export interface ToastAnchor {
  rect?: DOMRect
  element?: HTMLElement
  strategy?: 'avoid' | 'near'
}

/** 动画原点，用于 transform-origin */
export interface AnimationOrigin {
  x: string
  y: string
}

export interface ToastState {
  visible: boolean
  title: string
  description?: string
  variant?: ToastVariant
  actionLabel?: string
  onAction?: () => void
  duration?: number
  position?: ToastPosition
  origin?: AnimationOrigin
}

export interface ToastOptions extends Omit<ToastState, 'visible'> {
  anchor?: ToastAnchor
}

// ============ 内部纯计算函数 ============

const calcToastPosition = (anchor?: ToastAnchor): ToastPosition => {
  if (!anchor) return 'top-right'

  const rect = anchor.rect || anchor.element?.getBoundingClientRect()
  if (!rect) return 'top-right'

  const strategy = anchor.strategy || 'avoid'
  const viewWidth = window.innerWidth
  const viewHeight = window.innerHeight

  const anchorCenterX = rect.left + rect.width / 2
  const anchorCenterY = rect.top + rect.height / 2

  const isLeft = anchorCenterX < viewWidth / 2
  const isTop = anchorCenterY < viewHeight / 2

  if (strategy === 'avoid') {
    if (isLeft && isTop) return 'top-right'
    if (!isLeft && isTop) return 'top-left'
    if (isLeft && !isTop) return 'bottom-right'
    return 'bottom-left'
  } else {
    if (isLeft && isTop) return 'top-left'
    if (!isLeft && isTop) return 'top-right'
    if (isLeft && !isTop) return 'bottom-left'
    return 'bottom-right'
  }
}

const calcAnimationOrigin = (anchor?: ToastAnchor, position?: ToastPosition): AnimationOrigin => {
  if (anchor) {
    const rect = anchor.rect || anchor.element?.getBoundingClientRect()
    if (rect) {
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      return { x: `${centerX}px`, y: `${centerY}px` }
    }
  }

  const pos = position || 'bottom-right'
  const origins: Record<ToastPosition, AnimationOrigin> = {
    'top-left': { x: 'left', y: 'top' },
    'top-right': { x: 'right', y: 'top' },
    'bottom-left': { x: 'left', y: 'bottom' },
    'bottom-right': { x: 'right', y: 'bottom' }
  }
  return origins[pos]
}

// ============ Store 定义 ============

interface UIManagerState {
  // Tooltip
  tooltipProviderKey: number
  isTooltipEnabled: boolean
  // Toast
  toastState: ToastState
  // Dialog
  openDialogCount: number

  hideAllTooltips: () => void
  showToast: (options: ToastOptions) => void
  closeToast: () => void
  registerDialogOpen: () => void
  registerDialogClose: () => void
  hasOpenDialog: () => boolean
  onDialogClose: (options?: { closeToast?: boolean }) => void
  onDialogOpen: () => void
  onMainViewSwitch: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUIManager = create<UIManagerState>((set, get) => ({
  tooltipProviderKey: 0,
  isTooltipEnabled: true,
  toastState: {
    visible: false,
    title: '',
    variant: 'info',
    position: 'bottom-right'
  },
  openDialogCount: 0,

  /** 隐藏所有悬浮提示（通过 key 重挂强制销毁当前 Tooltip 内容） */
  hideAllTooltips: () => {
    set((s) => ({ isTooltipEnabled: false, tooltipProviderKey: s.tooltipProviderKey + 1 }))
    // 微任务后恢复，等价旧版 nextTick
    queueMicrotask(() => set({ isTooltipEnabled: true }))
  },

  /** 显示 Toast 提示 */
  showToast: (options) => {
    if (toastTimer) clearTimeout(toastTimer)

    let anchor = options.anchor
    if (!anchor) {
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body && active.tagName !== 'HTML') {
        anchor = { element: active }
      }
    }

    const position = anchor ? calcToastPosition(anchor) : options.position || 'bottom-right'
    const origin = calcAnimationOrigin(anchor, position)

    set({
      toastState: {
        visible: true,
        title: options.title,
        description: options.description,
        variant: options.variant || 'info',
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        position,
        origin
      }
    })

    const duration = options.duration || 4500
    toastTimer = setTimeout(() => {
      get().closeToast()
    }, duration)
  },

  /** 关闭 Toast 提示 */
  closeToast: () => {
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = null
    set((s) => ({ toastState: { ...s.toastState, visible: false } }))
    setTimeout(() => {
      const current = get().toastState
      if (!current.visible) {
        set({ toastState: { ...current, onAction: undefined } })
      }
    }, 300)
  },

  registerDialogOpen: () => set((s) => ({ openDialogCount: s.openDialogCount + 1 })),
  registerDialogClose: () => set((s) => ({ openDialogCount: Math.max(0, s.openDialogCount - 1) })),
  hasOpenDialog: () => get().openDialogCount > 0,

  onDialogClose: (options) => {
    get().hideAllTooltips()
    get().registerDialogClose()
    if (options?.closeToast) get().closeToast()
  },

  onDialogOpen: () => {
    get().hideAllTooltips()
    get().registerDialogOpen()
  },

  onMainViewSwitch: () => {
    get().hideAllTooltips()
    get().closeToast()
  }
}))
