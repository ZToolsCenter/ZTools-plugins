import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CURRENCIES, type Currency } from '../api/currencies'

interface CurrencyPickerProps {
  value: string
  onChange: (code: string) => void
}

const CurrencyPicker = memo(function CurrencyPicker({ value, onChange }: CurrencyPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)

  const cur = useMemo(() => CURRENCIES.find((c) => c.code === value), [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CURRENCIES
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.cn.includes(q) ||
        c.name.toLowerCase().includes(q)
    )
  }, [query])

  // 打开时重置搜索/高亮（focus 由 <input autoFocus /> 在挂载即接管，避免 setTimeout 造成的无焦点闪一下）
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
    }
  }, [open])

  // 点击外部关闭 — 用 openRef 避免闭包陷阱
  useEffect(() => {
    openRef.current = open
  }, [open])
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!openRef.current) return
      if (
        triggerRef.current?.contains(e.target as Node) ||
        popRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // 滚动高亮项到可视区
  useEffect(() => {
    if (!open) return
    const el = popRef.current?.querySelector<HTMLDivElement>(
      `[data-idx="${activeIdx}"]`
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const pick = (c: Currency) => {
    onChange(c.code)
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[activeIdx]
      if (c) pick(c)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="cp">
      <button
        ref={triggerRef}
        type="button"
        className="cp-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="cp-flag">{cur?.flag}</span>
        <span className="cp-text">
          <span className="cp-code">{value}</span>
          <span className="cp-cn">{cur?.cn}</span>
        </span>
        <svg
          className={`cp-arrow ${open ? 'open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div ref={popRef} className="cp-pop" role="listbox">
          <div className="cp-search">
            <svg className="cp-search-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="cp-search-input"
              placeholder="搜索货币代码或名称"
              value={query}
              autoFocus
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={onKey}
            />
          </div>

          <div className="cp-list">
            {filtered.length === 0 && (
              <div className="cp-empty">未找到匹配的货币</div>
            )}
            {filtered.map((c, idx) => (
              <div
                key={c.code}
                data-idx={idx}
                className={`cp-item ${idx === activeIdx ? 'active' : ''} ${
                  c.code === value ? 'selected' : ''
                }`}
                role="option"
                aria-selected={c.code === value}
                onClick={() => pick(c)}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <span className="cp-item-flag">{c.flag}</span>
                <span className="cp-item-code">{c.code}</span>
                <span className="cp-item-cn">{c.cn}</span>
                {c.code === value && <span className="cp-item-check">✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

export default CurrencyPicker
