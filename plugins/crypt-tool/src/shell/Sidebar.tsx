import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, getByCategory } from '../registry'

interface Props {
  modules: AlgorithmModule[]
  currentId: string | null
  onSelect: (id: string) => void
  onOpenSettings: () => void
  settingsActive: boolean
  searchText: string
}

function matchAlgo(m: AlgorithmModule, q: string): boolean {
  if (!q) return true
  const hay = (m.meta.label + '|' + m.meta.title + '|' + m.meta.id).toLowerCase()
  return hay.includes(q.toLowerCase())
}

export default function Sidebar({ modules, currentId, onSelect, onOpenSettings, settingsActive, searchText }: Props) {
  const q = searchText.trim()
  const filtered = q ? modules.filter((m) => matchAlgo(m, q)) : modules

  return (
    <aside className="ct-side">
      <div className="ct-side-scroll">
        {CATEGORIES.map((cat) => {
          const items = getByCategory(filtered, cat.id)
          if (items.length === 0) return null
          return (
            <div key={cat.id}>
              <div className="ct-side-title">{cat.label}</div>
              {items.map((m) => (
                <button
                  key={m.meta.id}
                  type="button"
                  className={`ct-side-item ${!settingsActive && currentId === m.meta.id ? 'on' : ''}`}
                  onClick={() => onSelect(m.meta.id)}
                >
                  <span className="ct-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.5 }} />
                  {m.meta.label}
                </button>
              ))}
            </div>
          )
        })}
        {q && filtered.length === 0 ? (
          <div className="ct-side-empty">没有匹配的算法</div>
        ) : null}
      </div>
      <div className="ct-side-foot">
        <button type="button" className={`ct-side-item ${settingsActive ? 'on' : ''}`} onClick={onOpenSettings} style={{ justifyContent: 'center' }}>
          ⚙ 设置
        </button>
      </div>
    </aside>
  )
}
