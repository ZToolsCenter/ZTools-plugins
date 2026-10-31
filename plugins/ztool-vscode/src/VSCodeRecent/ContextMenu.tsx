import { useEffect, useRef, useState, useCallback } from 'react'
import './ContextMenu.css'

export interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  divider?: boolean
}

interface ContextMenuProps {
  items: MenuItem[]
  x: number
  y: number
  onSelect: (key: string) => void
  onClose: () => void
}

export function ContextMenu({ items, x, y, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  // 调整位置确保菜单不超出视口
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let newX = x
      let newY = y

      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 8
      }
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 8
      }

      setPosition({ x: newX, y: newY })
    }
  }, [x, y])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleItemClick = useCallback((key: string) => {
    onSelect(key)
    onClose()
  }, [onSelect, onClose])

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return <div key={`divider-${index}`} className="context-menu-divider" />
        }
        return (
          <div
            key={item.key}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => !item.disabled && handleItemClick(item.key)}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}