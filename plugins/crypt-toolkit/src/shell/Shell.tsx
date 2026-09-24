import type { AlgorithmModule } from '../registry/types'
import type { Settings } from '../config'
import { firstEnabledId, getById, getEnabledList } from '../registry'
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
  onSearchClear: () => void
}

export default function Shell({
  modules,
  settings,
  view,
  onViewChange,
  onSettingsChange,
  searchText,
  onSearchClear
}: Props) {
  const enabled = getEnabledList(modules, settings.enabled)
  const settingsActive = view.kind === 'settings'
  const currentId = view.kind === 'algorithm' ? view.id : null
  const currentMod = currentId ? getById(modules, currentId) : undefined
  const isCurrentEnabled = currentMod ? !!settings.enabled[currentMod.meta.id] : false

  let main: React.ReactNode
  if (settingsActive) {
    main = (
      <SettingsPage
        modules={modules}
        settings={settings}
        onChange={onSettingsChange}
      />
    )
  } else if (enabled.length === 0) {
    main = (
      <div className="ct-main">
        <div className="ct-empty">
          <p>没有启用的算法</p>
          <button type="button" className="ct-btn ct-btn-primary" onClick={() => onViewChange({ kind: 'settings' })}>
            打开设置
          </button>
        </div>
      </div>
    )
  } else if (!currentMod || !isCurrentEnabled) {
    const fallback = firstEnabledId(modules, settings.enabled)
    main = (
      <div className="ct-main">
        <div className="ct-empty">
          <p>该算法已禁用</p>
          <button type="button" className="ct-btn ct-btn-primary" onClick={() => onViewChange({ kind: 'settings' })}>
            打开设置
          </button>
          {fallback ? (
            <p>
              <button type="button" className="ct-btn ct-btn-ghost" onClick={() => onViewChange({ kind: 'algorithm', id: fallback })}>
                返回 {fallback}
              </button>
            </p>
          ) : null}
        </div>
      </div>
    )
  } else {
    main = <AlgorithmHost module={currentMod} />
  }

  return (
    <div className="ct-panel">
      <Sidebar
        modules={enabled}
        currentId={currentId}
        settingsActive={settingsActive}
        searchText={searchText}
        onSelect={(id) => { onSearchClear(); onViewChange({ kind: 'algorithm', id }) }}
        onOpenSettings={() => { onSearchClear(); onViewChange({ kind: 'settings' }) }}
      />
      {main}
    </div>
  )
}
