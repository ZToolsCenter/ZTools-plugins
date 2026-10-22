import { memo, useCallback, useMemo, useState } from 'react'
import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, getByCategory } from '../registry'
import { defaultSettings, type Settings } from '../config'
import { Icon } from '../shared'

interface Props {
  modules: AlgorithmModule[]
  settings: Settings
  onChange: (s: Settings) => void
}

function isOn(settings: Settings, m: AlgorithmModule): boolean {
  return settings.enabled[m.meta.id] ?? m.meta.defaultEnabled
}

function SettingsPage({ modules, settings, onChange }: Props) {
  const [query, setQuery] = useState('')

  const toggle = useCallback(
    (id: string, on: boolean) => {
      onChange({ ...settings, enabled: { ...settings.enabled, [id]: on } })
    },
    [onChange, settings]
  )

  const handleReset = useCallback(() => {
    onChange(defaultSettings(modules))
  }, [onChange, modules])

  const enabledCount = useMemo(
    () => modules.filter((m) => isOn(settings, m)).length,
    [modules, settings]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return modules.filter(
      (m) =>
        m.meta.label.toLowerCase().includes(q) ||
        m.meta.title.toLowerCase().includes(q) ||
        m.meta.id.toLowerCase().includes(q)
    )
  }, [modules, query])

  const groups = CATEGORIES.map((cat) => ({
    cat,
    items: getByCategory(filtered ?? modules, cat.id)
  })).filter((group) => group.items.length > 0)

  return (
    <div className="ct-main ct-main--settings">
      <header className="ct-head">
        <div className="ct-head-row">
          <div className="ct-crumb">
            <span>系统</span>
            <span className="ct-crumb-sep">/</span>
            <span className="ct-crumb-id">settings</span>
          </div>
          <div className="ct-head-tools">
            <span className="ct-settings-count">
              已启用 {enabledCount} / {modules.length}
            </span>
          </div>
        </div>
        <div className="ct-title-row">
          <h1 className="ct-title">设置</h1>
        </div>
        <p className="ct-head-desc">
          选择要出现在侧栏和直达指令里的算法。切换会立即保存，并同步到 ZTools 的直达关键词。
        </p>
      </header>

      <div className="ct-settings-scroll">
        <div className="ct-settings-toolbar">
          <div className="ct-searchbox">
            <Icon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按名称或 ID 筛选"
              aria-label="筛选算法"
              spellCheck={false}
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">
                <Icon name="x" size={14} />
              </button>
            ) : null}
          </div>
          <button type="button" className="ct-btn ct-btn-ghost ct-btn--sm" onClick={handleReset}>
            恢复默认
          </button>
        </div>

        {filtered && filtered.length === 0 ? (
          <div className="ct-settings-empty">没有匹配的算法</div>
        ) : (
          groups.map(({ cat, items }) => {
            const onCount = items.filter((m) => isOn(settings, m)).length
            return (
              <section className="ct-settings-group" key={cat.id} aria-label={cat.label}>
                <div className="ct-settings-group-head">
                  <span>{cat.label}</span>
                  <span>
                    {onCount} / {items.length} 启用
                  </span>
                </div>
                {items.map((m) => {
                  const on = isOn(settings, m)
                  return (
                    <div className="ct-switch-row" key={m.meta.id}>
                      <div className="ct-switch-text">
                        <div className="ct-switch-name">{m.meta.label}</div>
                        <div className="ct-switch-id">alg:{m.meta.id}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${on ? '停用' : '启用'} ${m.meta.label}`}
                        className="ct-switch"
                        onClick={() => toggle(m.meta.id, !on)}
                      />
                    </div>
                  )
                })}
              </section>
            )
          })
        )}

        <p className="ct-settings-note">
          停用只会收起侧栏入口并移除对应的直达指令，不会删除算法实现。恢复默认会重新启用初始的算法集合。
        </p>
      </div>
    </div>
  )
}

export default memo(SettingsPage)
