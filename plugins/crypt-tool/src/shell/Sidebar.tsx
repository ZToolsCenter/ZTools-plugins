import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AlgorithmModule, CategoryId } from '../registry/types'
import { CATEGORIES, getByCategory } from '../registry'
import { Icon } from '../shared'

interface Props {
  modules: AlgorithmModule[]
  currentId: string | null
  onSelect: (id: string) => void
  onOpenSettings: () => void
  onSearchChange: (text: string) => void
  onSearchClear: () => void
  settingsActive: boolean
  searchText: string
}

function matchAlgo(m: AlgorithmModule, q: string): boolean {
  if (!q) return true
  const hay = `${m.meta.label}|${m.meta.title}|${m.meta.id}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

function Sidebar({
  modules,
  currentId,
  onSelect,
  onOpenSettings,
  onSearchChange,
  onSearchClear,
  settingsActive,
  searchText
}: Props) {
  const q = searchText.trim()
  const isSearching = q.length > 0
  const searchRef = useRef<HTMLInputElement>(null)

  const [openCats, setOpenCats] = useState<Set<CategoryId>>(() => {
    const current = currentId ? modules.find((m) => m.meta.id === currentId) : undefined
    return new Set<CategoryId>(current ? [current.meta.category] : [])
  })

  useEffect(() => {
    if (!currentId) return
    const current = modules.find((m) => m.meta.id === currentId)
    if (!current) return
    const category = current.meta.category
    setOpenCats((prev) => (prev.has(category) ? prev : new Set([...prev, category])))
  }, [currentId, modules])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (
        !searchRef.current ||
        (target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable))
      ) {
        return
      }
      event.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const filtered = useMemo(
    () => (isSearching ? modules.filter((m) => matchAlgo(m, q)) : modules),
    [modules, q, isSearching]
  )

  const toggleCat = (id: CategoryId) => {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="ct-side">
      <div className="ct-side-head">
        <div className="ct-side-index">
          <span>算法索引</span>
          <span className="ct-side-total">{modules.length}</span>
        </div>
        <div className="ct-side-search">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索算法"
            aria-label="搜索算法"
            spellCheck={false}
          />
          {searchText ? (
            <button type="button" onClick={onSearchClear} aria-label="清除搜索">
              <Icon name="x" size={13} />
            </button>
          ) : (
            <span className="ct-side-search-key">/</span>
          )}
        </div>
      </div>

      <div className="ct-side-scroll">
        {CATEGORIES.map((cat) => {
          const items = getByCategory(filtered, cat.id)
          if (items.length === 0) return null
          const open = isSearching || openCats.has(cat.id)
          return (
            <div className="ct-side-group" key={cat.id}>
              <button
                type="button"
                className={`ct-side-cat ${open ? 'is-open' : ''}`}
                onClick={() => {
                  if (!isSearching) toggleCat(cat.id)
                }}
                aria-expanded={open}
              >
                <Icon name="chevron" className="ct-side-chev" size={10} />
                <span>{cat.label}</span>
                <span className="ct-side-count">{items.length}</span>
              </button>
              {open ? (
                <div className="ct-side-items">
                  {items.map((m) => {
                    const active = !settingsActive && currentId === m.meta.id
                    return (
                      <button
                        key={m.meta.id}
                        type="button"
                        className={`ct-side-item ${active ? 'on' : ''}`}
                        onClick={() => onSelect(m.meta.id)}
                        aria-current={active ? 'page' : undefined}
                      >
                        {active ? <span className="ct-side-tick" /> : null}
                        <span>{m.meta.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
        {isSearching && filtered.length === 0 ? (
          <div className="ct-side-empty">没有匹配的算法</div>
        ) : null}
        {!isSearching && modules.length === 0 ? (
          <div className="ct-side-empty">没有启用的算法</div>
        ) : null}
      </div>

      <div className="ct-side-foot">
        <button
          type="button"
          className={`ct-side-settings ${settingsActive ? 'on' : ''}`}
          onClick={onOpenSettings}
        >
          <Icon name="sliders" />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}

export default memo(Sidebar)
