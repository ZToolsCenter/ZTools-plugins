import { useState } from 'react'
import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, categoryLabel, getByCategory } from '../registry'
import { defaultSettings, type Settings } from '../config'
import { Field } from '../shared'

interface Props {
  modules: AlgorithmModule[]
  settings: Settings
  onChange: (s: Settings) => void
}

export default function SettingsPage({ modules, settings, onChange }: Props) {
  const [query, setQuery] = useState('')

  const toggle = (id: string, on: boolean) => {
    onChange({ ...settings, enabled: { ...settings.enabled, [id]: on } })
  }

  const filtered = query.trim()
    ? modules.filter((m) => {
        const q = query.trim().toLowerCase()
        return (
          m.meta.label.toLowerCase().includes(q) ||
          m.meta.title.toLowerCase().includes(q) ||
          m.meta.id.toLowerCase().includes(q)
        )
      })
    : null

  return (
    <div className="ct-main">
      <div className="ct-main-head">
        <h4>设置</h4>
        <span className="ct-cat">算法启停</span>
      </div>
      <Field
        label="搜索"
        value={query}
        onChange={setQuery}
        placeholder="按名称或 ID 筛选..."
        onClear={query.trim() ? () => setQuery('') : undefined}
      />
      {filtered ? (
        filtered.length === 0 ? (
          <p className="ct-settings-empty">没有匹配的算法</p>
        ) : (
          <div className="ct-settings-group">
            <div className="ct-settings-group-label">
              搜索结果 ({filtered.length})
            </div>
            <div className="ct-tags">
              {filtered.map((m) => {
                const on = settings.enabled[m.meta.id] ?? m.meta.defaultEnabled
                return (
                  <button
                    key={m.meta.id}
                    type="button"
                    className={`ct-tag ${on ? 'on' : ''}`}
                    onClick={() => toggle(m.meta.id, !on)}
                  >
                    {m.meta.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      ) : (
        CATEGORIES.map((cat) => {
          const items = getByCategory(modules, cat.id)
          if (!items.length) return null
          return (
            <div key={cat.id} className="ct-settings-group">
              <div className="ct-settings-group-label">{categoryLabel(cat.id)}</div>
              <div className="ct-tags">
                {items.map((m) => {
                  const on = settings.enabled[m.meta.id] ?? m.meta.defaultEnabled
                  return (
                    <button
                      key={m.meta.id}
                      type="button"
                      className={`ct-tag ${on ? 'on' : ''}`}
                      onClick={() => toggle(m.meta.id, !on)}
                    >
                      {m.meta.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
      <div className="ct-settings-foot">
        <button
          type="button"
          className="ct-btn ct-btn-primary"
          onClick={() => onChange(defaultSettings(modules))}
        >
          恢复默认
        </button>
      </div>
      <p className="ct-settings-tip">点击标签可切换启用/禁用，修改后自动同步到直达指令。</p>
    </div>
  )
}
