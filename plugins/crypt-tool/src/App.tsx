import { useCallback, useEffect, useRef, useState } from 'react'
import { algorithms, firstEnabledId } from './registry'
import { Shell, type ShellView } from './shell'
import { loadSettings, saveSettings, syncFeatureDiff, type Settings } from './config'
import { useZtoolsTheme } from './hooks/useZtoolsTheme'

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(algorithms))
  const [view, setView] = useState<ShellView>(() => {
    const firstId = firstEnabledId(algorithms, settings.enabled)
    return firstId ? { kind: 'algorithm', id: firstId } : { kind: 'settings' }
  })
  const [searchText, setSearchText] = useState('')

  useZtoolsTheme()

  const prevEnabledRef = useRef(settings.enabled)

  useEffect(() => {
    syncFeatureDiff(algorithms, prevEnabledRef.current, settings.enabled)
    prevEnabledRef.current = settings.enabled
  }, [settings.enabled])

  const enabledRef = useRef(settings.enabled)
  enabledRef.current = settings.enabled

  const syncSearch = useCallback((text: string) => {
    setSearchText(text)
    try {
      window.ztools?.setSubInputValue?.(text)
    } catch {
      // 宿主未提供子输入框时只保留面板内搜索
    }
  }, [])

  useEffect(() => {
    window.ztools.onPluginEnter((action) => {
      const code = action.code
      if (code && code.startsWith('alg:')) {
        setView({ kind: 'algorithm', id: code.slice(4) })
      } else {
        const id = firstEnabledId(algorithms, enabledRef.current)
        setView(id ? { kind: 'algorithm', id } : { kind: 'settings' })
      }
      syncSearch('')
    })
  }, [syncSearch])

  useEffect(() => {
    const ok = window.ztools.setSubInput(
      ({ text }) => {
        setSearchText(text.trim())
      },
      '搜索算法名称...',
      false
    )
    if (!ok) return
    return () => {
      window.ztools.removeSubInput()
    }
  }, [])

  const onSettingsChange = (next: Settings) => {
    saveSettings(next)
    setSettings(next)
    if (view.kind === 'algorithm' && !next.enabled[view.id]) {
      const fallback = firstEnabledId(algorithms, next.enabled)
      setView(fallback ? { kind: 'algorithm', id: fallback } : { kind: 'settings' })
    }
  }

  return (
    <div className="ct-app">
      <Shell
        modules={algorithms}
        settings={settings}
        view={view}
        onViewChange={setView}
        onSettingsChange={onSettingsChange}
        searchText={searchText}
        onSearchChange={syncSearch}
        onSearchClear={() => syncSearch('')}
      />
    </div>
  )
}
