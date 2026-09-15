import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { useUIManager } from '@/hooks/useUIManager'
import { useSettingsStore } from '@/stores/settings'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

const GAP = 8
const VIEW_PAD = 8
const SHOW_DELAY_MS = 280
const HIDE_DELAY_MS = 150
const MAX_TIP_WIDTH = 280

function isTextOverflowing(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

function readThemeTokens(): {
  bg: string
  fg: string
  muted: string
  border: string
  shadow: string
  radius: string
  theme: string
  accentBorder: string
} {
  const root = document.querySelector('.goose-home') as HTMLElement | null
  const cs = root ? getComputedStyle(root) : null
  const pick = (name: string, fallback: string) => {
    const v = cs?.getPropertyValue(name)?.trim()
    return v || fallback
  }
  return {
    bg: pick('--input', '#ffffff'),
    fg: pick('--fg', '#1f1e1d'),
    muted: pick('--fg-muted', '#6c6b64'),
    border: pick('--border', '#e6e3d9'),
    shadow: pick('--shadow-pop', '0 12px 36px -10px rgba(25,15,9,.22)'),
    radius: pick('--radius-sm', '8px'),
    theme: root?.getAttribute('data-theme') || 'light',
    accentBorder: pick('--accent-border', '#e2b59f'),
  }
}

function measureTipSize(node: HTMLElement): { w: number; h: number } {
  const prev = {
    visibility: node.style.visibility,
    left: node.style.left,
    top: node.style.top,
    transform: node.style.transform,
  }
  node.style.visibility = 'hidden'
  node.style.left = '0'
  node.style.top = '0'
  node.style.transform = 'none'
  const w = Math.ceil(node.offsetWidth)
  const h = Math.ceil(node.offsetHeight)
  node.style.visibility = prev.visibility
  node.style.left = prev.left
  node.style.top = prev.top
  node.style.transform = prev.transform
  return { w, h }
}

export function computeTooltipPosition(
  anchor: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TooltipPlacement[] = ['top', 'bottom', 'right', 'left']
): { left: number; top: number; placement: TooltipPlacement } {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const space = {
    top: anchor.top - VIEW_PAD,
    bottom: vh - anchor.bottom - VIEW_PAD,
    left: anchor.left - VIEW_PAD,
    right: vw - anchor.right - VIEW_PAD,
  }

  const fits = (p: TooltipPlacement) => {
    if (p === 'top' || p === 'bottom') return space[p] >= tipH + GAP
    return space[p] >= tipW + GAP
  }

  let placement = preferred.find(fits)
  if (!placement) {
    placement = (Object.entries(space) as [TooltipPlacement, number][]).sort((a, b) => b[1] - a[1])[0][0]
  }

  let left = 0
  let top = 0
  const centerX = anchor.left + anchor.width / 2
  const centerY = anchor.top + anchor.height / 2

  switch (placement) {
    case 'top':
      left = centerX - tipW / 2
      top = anchor.top - tipH - GAP
      break
    case 'bottom':
      left = centerX - tipW / 2
      top = anchor.bottom + GAP
      break
    case 'left':
      left = anchor.left - tipW - GAP
      top = centerY - tipH / 2
      break
    case 'right':
      left = anchor.right + GAP
      top = centerY - tipH / 2
      break
  }

  left = Math.min(Math.max(VIEW_PAD, left), vw - tipW - VIEW_PAD)
  top = Math.min(Math.max(VIEW_PAD, top), vh - tipH - VIEW_PAD)

  return { left, top, placement }
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else (ref as { current: T | null }).current = value
}

type EventHandler = ((e: unknown) => void) | undefined

export interface OverflowHoverTooltipProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  anchorRef?: Ref<HTMLDivElement>
  disabled?: boolean
  preferredPlacement?: TooltipPlacement[]
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void
  [key: string]: unknown
}

export function OverflowHoverTooltip({
  title: _title,
  description,
  children,
  className,
  style,
  anchorRef,
  disabled,
  preferredPlacement,
  onClick,
  onContextMenu,
  ...rest
}: OverflowHoverTooltipProps) {
  const tipId = useId()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const showTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)
  const selectingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; placement: TooltipPlacement } | null>(null)
  const [tokens, setTokens] = useState(() => readThemeTokens())

  const isTooltipEnabled = useUIManager((s) => s.isTooltipEnabled)
  const tooltipProviderKey = useUIManager((s) => s.tooltipProviderKey)
  const descriptionSelectable = useSettingsStore((s) => s.descriptionSelectable)
  // 浮层只展示描述；有描述时才允许选中交互
  const tipText = description || ''
  const canSelectDesc = Boolean(descriptionSelectable && tipText)

  // 合并 rest 中可能来自 dnd-kit listeners 的指针/鼠标事件，避免覆盖 hide
  const {
    onPointerDown: restPointerDown,
    onMouseEnter: restMouseEnter,
    onMouseLeave: restMouseLeave,
    ...domRest
  } = rest as {
    onPointerDown?: EventHandler
    onMouseEnter?: EventHandler
    onMouseLeave?: EventHandler
    [key: string]: unknown
  }

  const setHostRef = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node
      assignRef(anchorRef, node)
    },
    [anchorRef]
  )

  const clearShowTimer = useCallback(() => {
    if (showTimer.current !== undefined) {
      window.clearTimeout(showTimer.current)
      showTimer.current = undefined
    }
  }, [])

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== undefined) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }
  }, [])

  const hide = useCallback(() => {
    clearShowTimer()
    clearHideTimer()
    selectingRef.current = false
    setOpen(false)
    setPos(null)
  }, [clearShowTimer, clearHideTimer])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    // 正在拖选时不关闭，避免选中中途浮层消失
    if (selectingRef.current) return
    if (!canSelectDesc) {
      hide()
      return
    }
    hideTimer.current = window.setTimeout(() => {
      // 若浮层内仍有选区，再等一轮，避免选完立刻被关掉
      const sel = window.getSelection()
      const tip = tipRef.current
      if (sel && !sel.isCollapsed && tip && (tip.contains(sel.anchorNode) || tip.contains(sel.focusNode))) {
        hideTimer.current = window.setTimeout(hide, HIDE_DELAY_MS)
        return
      }
      hide()
    }, HIDE_DELAY_MS)
  }, [canSelectDesc, clearHideTimer, hide])

  const cancelHide = useCallback(() => {
    clearHideTimer()
  }, [clearHideTimer])

  useEffect(() => {
    hide()
  }, [tooltipProviderKey, hide])

  useEffect(() => {
    if (!isTooltipEnabled) hide()
  }, [isTooltipEnabled, hide])

  useEffect(() => () => {
    clearShowTimer()
    clearHideTimer()
  }, [clearShowTimer, clearHideTimer])

  const hasOverflow = useCallback(() => {
    const host = hostRef.current
    if (!host) return false
    // 浮层只展示描述，仅描述溢出时弹出
    const dsc = host.querySelector('.dsc') as HTMLElement | null
    return isTextOverflowing(dsc)
  }, [])

  const reposition = useCallback(() => {
    const host = hostRef.current
    const tip = tipRef.current
    if (!host || !tip) return
    const { w, h } = measureTipSize(tip)
    const next = computeTooltipPosition(
      host.getBoundingClientRect(),
      w,
      h,
      preferredPlacement
    )
    setPos(next)
  }, [preferredPlacement])

  useLayoutEffect(() => {
    if (!open) return
    setTokens(readThemeTokens())
    reposition()
  }, [open, tipText, canSelectDesc, reposition])

  useEffect(() => {
    if (!open) return
    const onScrollOrResize = () => reposition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, reposition])

  const tryShow = useCallback(() => {
    if (disabled || !isTooltipEnabled) return
    if (!tipText) return
    if (!hasOverflow()) return
    setTokens(readThemeTokens())
    setOpen(true)
  }, [disabled, isTooltipEnabled, tipText, hasOverflow])

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!disabled && isTooltipEnabled) {
        cancelHide()
        clearShowTimer()
        showTimer.current = window.setTimeout(tryShow, SHOW_DELAY_MS)
      }
      ;(restMouseEnter as ((ev: React.MouseEvent<HTMLDivElement>) => void) | undefined)?.(e)
    },
    [disabled, isTooltipEnabled, cancelHide, clearShowTimer, tryShow, restMouseEnter]
  )

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      clearShowTimer()
      scheduleHide()
      ;(restMouseLeave as ((ev: React.MouseEvent<HTMLDivElement>) => void) | undefined)?.(e)
    },
    [clearShowTimer, scheduleHide, restMouseLeave]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 卡片上按下（拖拽/点击）立即收起，避免挡操作
      hide()
      ;(restPointerDown as ((ev: React.PointerEvent<HTMLDivElement>) => void) | undefined)?.(e)
    },
    [hide, restPointerDown]
  )

  const handleTipMouseEnter = useCallback(() => {
    cancelHide()
  }, [cancelHide])

  const handleTipMouseLeave = useCallback(() => {
    scheduleHide()
  }, [scheduleHide])

  const handleDescPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    selectingRef.current = true
    cancelHide()
  }, [cancelHide])

  const handleDescPointerUp = useCallback(() => {
    selectingRef.current = false
  }, [])

  const tipBody =
    open && tipText
      ? createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            data-placement={pos?.placement ?? 'top'}
            data-theme={tokens.theme}
            className={`gm-overflow-tip${canSelectDesc ? ' gm-overflow-tip--selectable' : ''}`}
            onMouseEnter={canSelectDesc ? handleTipMouseEnter : undefined}
            onMouseLeave={canSelectDesc ? handleTipMouseLeave : undefined}
            onPointerDown={canSelectDesc ? handleDescPointerDown : undefined}
            onPointerUp={canSelectDesc ? handleDescPointerUp : undefined}
            style={{
              position: 'fixed',
              left: pos ? pos.left : -9999,
              top: pos ? pos.top : -9999,
              zIndex: 20050,
              maxWidth: Math.min(MAX_TIP_WIDTH, window.innerWidth - VIEW_PAD * 2),
              visibility: pos ? 'visible' : 'hidden',
              pointerEvents: canSelectDesc ? 'auto' : 'none',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: tokens.radius || '8px',
              background: tokens.bg,
              color: tokens.muted,
              // 可选中时边框略偏 accent，提示可拖选
              border: `1px solid ${canSelectDesc ? tokens.accentBorder : tokens.border}`,
              boxShadow: tokens.shadow,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 500,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              cursor: canSelectDesc ? 'text' : undefined,
              WebkitUserSelect: canSelectDesc ? 'auto' : undefined,
              userSelect: canSelectDesc ? 'text' : undefined,
              fontFamily:
                '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif',
            }}
          >
            <div className={canSelectDesc ? 'user-select-text' : undefined}>
              {tipText}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <div
        ref={setHostRef}
        className={className}
        style={style}
        {...domRest}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-describedby={open ? tipId : undefined}
      >
        {children}
      </div>
      {tipBody}
    </>
  )
}
