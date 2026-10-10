import { useMemo, memo } from 'react'
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

function Shell({
  modules,
  settings,
  view,
  onViewChange,
  onSettingsChange,
  searchText,
  onSearchClear
}: Props) {
  // 缓存 enabled 列表，只在 modules 或 enabled 引用变化时重新计算
  const enabled = useMemo(
    () => getEnabledList(modules, settings.enabled),
    [modules, settings.enabled]
  )

  const settingsActive = view.kind === 'settings'
  const currentId = view.kind === 'algorithm' ? view.id : null

  const currentMod = useMemo(
    () => currentId ? getById(modules, currentId) : undefined,
    [modules, currentId]
  )

  const isCurrentEnabled = currentMod ? !!settings.enabled[currentMod.meta.id] : false

  // 缓存 callback 函数，避免每次渲染创建新引用
  const handleSelect = useMemo(
    () => (id: string) => { onSearchClear(); onViewChange({ kind: 'algorithm', id }) },
    [onSearchClear, onViewChange]
  )

  const handleOpenSettings = useMemo(
    () => () => { onSearchClear(); onViewChange({ kind: 'settings' }) },
    [onSearchClear, onViewChange]
  )

  // 只在相关条件变化时重新计算 fallback
  const fallback = useMemo(
    () => (!currentMod || !isCurrentEnabled) ? firstEnabledId(modules, settings.enabled) : null,
    [currentMod, isCurrentEnabled, modules, settings.enabled]
  )

  return (
    <div className="ct-panel">
      <Sidebar
        modules={enabled}
        currentId={currentId}
        settingsActive={settingsActive}
        searchText={searchText}
        onSelect={handleSelect}
        onOpenSettings={handleOpenSettings}
      />
      {settingsActive ? (
        <SettingsPage
          modules={modules}
          settings={settings}
          onChange={onSettingsChange}
        />
      ) : enabled.length === 0 ? (
        <div className="ct-main">
          <div className="ct-empty">
            <p>没有启用的算法</p>
            <button type="button" className="ct-btn ct-btn-primary" onClick={() => onViewChange({ kind: 'settings' })}>
              打开设置
            </button>
          </div>
        </div>
      ) : !currentMod || !isCurrentEnabled ? (
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
      ) : (
        <AlgorithmHost module={currentMod} />
      )}
    </div>
  )
}

export default memo(Shell)
