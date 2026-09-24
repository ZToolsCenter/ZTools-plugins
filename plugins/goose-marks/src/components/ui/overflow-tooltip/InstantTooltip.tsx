/**
 * 即时 Tooltip：0 延迟、portal 渲染、按视口自动选上下左右。
 * 用于顶栏图标等易被 overflow 裁切的场景。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { computeTooltipPosition, type TooltipPlacement } from './OverflowHoverTooltip'

const VIEW_PAD = 8
/** 模块级常量：禁止在组件参数默认值里写新数组（会触发 effect 死循环） */
const DEFAULT_PLACEMENT: TooltipPlacement[] = ['bottom', 'top', 'left', 'right']

type Pos = { left: number; top: number; placement: TooltipPlacement }

function readThemeTokens() {
  const root = document.querySelector('.goose-home') as HTMLElement | null
  const cs = root ? getComputedStyle(root) : null
  const pick = (name: string, fallback: string) => {
    const v = cs?.getPropertyValue(name)?.trim()
    return v || fallback
  }
  return {
    bg: pick('--input', '#ffffff'),
    muted: pick('--fg-muted', '#6c6b64'),
    border: pick('--border', '#e6e3d9'),
    shadow: pick('--shadow-pop', '0 12px 36px -10px rgba(25,15,9,.22)'),
    radius: pick('--radius-sm', '8px'),
    theme: root?.getAttribute('data-theme') || 'light',
  }
}

function samePos(a: Pos | null, b: Pos | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a.left === b.left && a.top === b.top && a.placement === b.placement
}

export type InstantTooltipProps = {
  label: string
  children: React.ReactNode
  preferredPlacement?: TooltipPlacement[]
  disabled?: boolean
  className?: string
}

export function InstantTooltip({
  label,
  children,
  preferredPlacement,
  disabled = false,
  className,
}: InstantTooltipProps) {
  const tipId = useId()
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  // 用 ref 持有 placement，避免数组引用变化导致 effect 重跑
  const placementRef = useRef<TooltipPlacement[]>(preferredPlacement ?? DEFAULT_PLACEMENT)
  placementRef.current = preferredPlacement ?? DEFAULT_PLACEMENT

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const tokensRef = useRef(readThemeTokens())

  const reposition = useCallback(() => {
    const host = hostRef.current
    const tip = tipRef.current
    if (!host || !tip) return

    const prev = {
      visibility: tip.style.visibility,
      left: tip.style.left,
      top: tip.style.top,
    }
    tip.style.visibility = 'hidden'
    tip.style.left = '0'
    tip.style.top = '0'
    const w = Math.ceil(tip.offsetWidth)
    const h = Math.ceil(tip.offsetHeight)
    tip.style.visibility = prev.visibility
    tip.style.left = prev.left
    tip.style.top = prev.top

    const next = computeTooltipPosition(
      host.getBoundingClientRect(),
      w,
      h,
      placementRef.current
    )
    setPos((cur) => (samePos(cur, next) ? cur : next))
  }, [])

  // open 后：tip 已挂载，测一次位；deps 只含 open/label，绝不挂不稳定数组
  useLayoutEffect(() => {
    if (!open) return
    tokensRef.current = readThemeTokens()
    reposition()
  }, [open, label, reposition])

  useEffect(() => {
    if (!open) return
    const onMove = () => reposition()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, reposition])

  const show = useCallback(() => {
    if (disabled || !label.trim()) return
    tokensRef.current = readThemeTokens()
    setOpen(true)
  }, [disabled, label])

  const hide = useCallback(() => {
    setOpen(false)
    setPos(null)
  }, [])

  const tokens = tokensRef.current

  return (
    <>
      <span
        ref={hostRef}
        className={className ? `gm-instant-tip-host ${className}` : 'gm-instant-tip-host'}
        style={{ display: 'inline-flex', maxWidth: '100%' }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open && label
        ? createPortal(
            <div
              ref={tipRef}
              id={tipId}
              role="tooltip"
              data-placement={pos?.placement ?? 'bottom'}
              data-theme={tokens.theme}
              className="gm-instant-tip"
              style={{
                position: 'fixed',
                left: pos ? pos.left : -9999,
                top: pos ? pos.top : -9999,
                zIndex: 20060,
                maxWidth: Math.min(
                  240,
                  typeof window !== 'undefined' ? window.innerWidth - VIEW_PAD * 2 : 240
                ),
                visibility: pos ? 'visible' : 'hidden',
                pointerEvents: 'none',
                boxSizing: 'border-box',
                padding: '5px 9px',
                borderRadius: tokens.radius || '8px',
                background: tokens.bg,
                color: tokens.muted,
                border: `1px solid ${tokens.border}`,
                boxShadow: tokens.shadow,
                fontSize: 11.5,
                fontWeight: 500,
                lineHeight: 1.35,
                whiteSpace: 'nowrap',
                fontFamily:
                  '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif',
              }}
            >
              {label}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
