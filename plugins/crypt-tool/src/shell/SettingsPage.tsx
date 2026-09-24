import { memo, useMemo, useState, useCallback } from 'react'
import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, categoryLabel, getByCategory } from '../registry'
import { defaultSettings, type Settings } from '../config'
import { Field } from '../shared'

interface Props {
  modules: AlgorithmModule[]
  settings: Settings
  onChange: (s: Settings) => void
}

function SettingsPage({ modules, settings, onChange }: Props) {
  const [query, setQuery] = useState('')

  const toggle = useCallback((id: string, on: boolean) => {
    onChange({ ...settings, enabled: { ...settings.enabled, [id]: on } })
  }, [onChange, settings])

  const handleReset = useCallback(() => {
    onChange(defaultSettings(modules))
  }, [onChange, modules])

  // 缓存搜索结果
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return null
    const lower = q.toLowerCase()
    return modules.filter((m) =>
      m.meta.label.toLowerCase().includes(lower) ||
      m.meta.title.toLowerCase().includes(lower) ||
      m.meta.id.toLowerCase().includes(lower)
    )
  }, [modules, query])

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
          onClick={handleReset}
        >
          恢复默认
        </button>
      </div>
      <p className="ct-settings-tip">点击标签可切换启用/禁用，修改后自动同步到直达指令。</p>
    </div>
  )
}

export default memo(SettingsPage)
