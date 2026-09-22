import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, getByCategory } from '../registry'

interface Props {
  modules: AlgorithmModule[]
  currentId: string | null
  onSelect: (id: string) => void
  onOpenSettings: () => void
  settingsActive: boolean
}

export default function Sidebar({ modules, currentId, onSelect, onOpenSettings, settingsActive }: Props) {
  return (
    <aside className="ct-side">
      <div className="ct-side-scroll">
        {CATEGORIES.map((cat) => {
          const items = getByCategory(modules, cat.id)
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
      </div>
      <div className="ct-side-foot">
        <button type="button" className={`ct-side-item ${settingsActive ? 'on' : ''}`} onClick={onOpenSettings} style={{ justifyContent: 'center' }}>
          ⚙ 设置
        </button>
      </div>
    </aside>
  )
}
