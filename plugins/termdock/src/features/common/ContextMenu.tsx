import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { t } from '../../i18n'

export type ContextMenuEntry = {
  label?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  action?(): void
  separator?: boolean
}

export function ContextMenu({
  className,
  items,
  onClose,
  position
}: {
  className?: string
  items: ContextMenuEntry[]
  onClose(): void
  position: { x: number; y: number }
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [resolvedPosition, setResolvedPosition] = useState(position)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const menu = menuRef.current
      const target = event.target
      if (!(target instanceof Node) || !menu) {
        onClose()
        return
      }
      if (!menu.contains(target)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const handleBlur = () => onClose()

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('blur', handleBlur)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const margin = 8
    const rect = menu.getBoundingClientRect()
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)

    setResolvedPosition({
      x: Math.min(maxLeft, Math.max(margin, position.x)),
      y: Math.min(maxTop, Math.max(margin, position.y))
    })
  }, [items, position])

  return (
    <div
      ref={menuRef}
      className={`context-menu ${className ?? ''}`.trim()}
      onClick={(event) => event.stopPropagation()}
      style={{ left: resolvedPosition.x, top: resolvedPosition.y } as CSSProperties}
    >
      {items.map((item, index) => item.separator ? (
        <span key={`sep-${index}`} className="context-menu-separator" />
      ) : (
        <button
          key={`${item.label}-${index}`}
          className={item.danger ? 'is-danger' : ''}
          disabled={item.disabled}
          onClick={() => {
            item.action?.()
            onClose()
          }}
          type="button"
        >
          <span>{item.label}</span>
          {item.shortcut ? <span className="context-menu-shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
      <button className="context-close" type="button" onClick={onClose}>{t.closeTab}</button>
    </div>
  )
}
