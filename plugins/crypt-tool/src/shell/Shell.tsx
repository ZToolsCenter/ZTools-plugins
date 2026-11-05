import { useMemo, memo } from 'react'
import type { AlgorithmModule } from '../registry/types'
import type { Settings } from '../config'
import { firstEnabledId, getById, getEnabledList } from '../registry'
import { Icon } from '../shared'
import Sidebar from './Sidebar'
import SettingsPage from './SettingsPage'
import AlgorithmHost from './AlgorithmHost'

export type ShellView =
  | { kind: 'algorithm'; id: string }
  | { kind: 'settings' }

interface Props {
  modules: AlgorithmModule[]
  settings: Settings
  view: ShellView
  onViewChange: (v: ShellView) => void
  onSettingsChange: (s: Settings) => void
  searchText: string
  onSearchChange: (text: string) => void
  onSearchClear: () => void
}

function Shell({
  modules,
  settings,
  view,
  onViewChange,
  onSettingsChange,
  searchText,
  onSearchChange,
  onSearchClear
}: Props) {
  const enabled = useMemo(
    () => getEnabledList(modules, settings.enabled),
    [modules, settings.enabled]
  )

  const settingsActive = view.kind === 'settings'
  const currentId = view.kind === 'algorithm' ? view.id : null

  const currentMod = useMemo(
    () => (currentId ? getById(modules, currentId) : undefined),
    [modules, currentId]
  )

  const isCurrentEnabled = currentMod ? !!settings.enabled[currentMod.meta.id] : false

  const handleSelect = useMemo(
    () => (id: string) => {
      onSearchClear()
      onViewChange({ kind: 'algorithm', id })
    },
    [onSearchClear, onViewChange]
  )

  const handleOpenSettings = useMemo(
    () => () => {
      onSearchClear()
      onViewChange({ kind: 'settings' })
    },
    [onSearchClear, onViewChange]
  )

  const fallback = useMemo(
    () => (!currentMod || !isCurrentEnabled ? firstEnabledId(modules, settings.enabled) : null),
    [currentMod, isCurrentEnabled, modules, settings.enabled]
  )

  const fallbackLabel = fallback ? getById(modules, fallback)?.meta.label ?? fallback : null

  return (
    <div className="ct-panel">
      <Sidebar
        modules={enabled}
        currentId={currentId}
        settingsActive={settingsActive}
        searchText={searchText}
        onSelect={handleSelect}
        onOpenSettings={handleOpenSettings}
        onSearchChange={onSearchChange}
        onSearchClear={onSearchClear}
      />

      {settingsActive ? (
        <SettingsPage modules={modules} settings={settings} onChange={onSettingsChange} />
      ) : enabled.length === 0 ? (
        <div className="ct-main ct-main--empty">
          <div className="ct-empty">
            <span className="ct-empty-mark">
              <Icon name="sliders" size={24} />
            </span>
            <h2>没有启用的算法</h2>
            <p>去设置里打开至少一个算法，它就会出现在侧栏和直达指令里。</p>
            <div className="ct-empty-actions">
              <button type="button" className="ct-btn ct-btn-primary" onClick={handleOpenSettings}>
                打开设置
              </button>
            </div>
          </div>
        </div>
      ) : !currentMod || !isCurrentEnabled ? (
        <div className="ct-main ct-main--empty">
          <div className="ct-empty">
            <span className="ct-empty-mark">
              <Icon name="note" size={24} />
            </span>
            <h2>这个算法已停用</h2>
            <p>它仍在算法库里，只是暂时没有出现在侧栏。</p>
            <div className="ct-empty-actions">
              <button type="button" className="ct-btn ct-btn-primary" onClick={handleOpenSettings}>
                打开设置
              </button>
              {fallback && fallbackLabel ? (
                <button
                  type="button"
                  className="ct-btn ct-btn-ghost"
                  onClick={() => onViewChange({ kind: 'algorithm', id: fallback })}
                >
                  返回 {fallbackLabel}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <AlgorithmHost key={currentMod.meta.id} module={currentMod} />
      )}
    </div>
  )
}

export default memo(Shell)
