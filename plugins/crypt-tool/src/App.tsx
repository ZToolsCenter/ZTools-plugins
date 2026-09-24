import { useEffect, useMemo, useState } from 'react'
import { algorithms, firstEnabledId } from './registry'
import { Shell, type ShellView } from './shell'
import { loadSettings, saveSettings, syncFeatures, type Settings } from './config'
import { useZtoolsTheme } from './hooks/useZtoolsTheme'

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(algorithms))
  const [view, setView] = useState<ShellView>(() => ({
    kind: 'algorithm',
    id: firstEnabledId(algorithms, loadSettings(algorithms).enabled) ?? ''
  }))
  const [searchText, setSearchText] = useState('')
  const { primaryColor } = useZtoolsTheme()

  useEffect(() => {
    document.documentElement.style.setProperty('--blue', primaryColor)
  }, [primaryColor])

  useEffect(() => {
    syncFeatures(algorithms, settings.enabled)
  }, [settings.enabled])

  useEffect(() => {
    window.ztools.onPluginEnter((action: any) => {
      const code = action.code as string
      if (code && code.startsWith('alg:')) {
        const id = code.slice(4)
        setView({ kind: 'algorithm', id })
        setSearchText('')
      } else {
        const id = firstEnabledId(algorithms, settings.enabled)
        setView(id ? { kind: 'algorithm', id } : { kind: 'settings' })
        setSearchText('')
      }
    })
  }, [settings.enabled])
  useEffect(() => {
    // @ts-ignore
    window.ztools.onThemeChange((themeInfo: {
      isDark: boolean,
      primaryColor: string,
      customColor: string,
      windowMaterial: string
    }) => {
      const root = document.documentElement

      // 1. 应用主色调
      if (themeInfo.primaryColor) {
        root.style.setProperty('--blue', themeInfo.primaryColor)
      }

      // 2. 应用自定义色（如有）
      if (themeInfo.customColor) {
        root.style.setProperty('--custom-color', themeInfo.customColor)
      }

      // 3. 切换深色/浅色模式 class
      if (themeInfo.isDark) {
        root.classList.add('theme-dark')
        root.classList.remove('theme-light')
      } else {
        root.classList.add('theme-light')
        root.classList.remove('theme-dark')
      }

      // 4. 应用窗口材质（如支持）
      if (themeInfo.windowMaterial) {
        root.dataset.windowMaterial = themeInfo.windowMaterial
      }
    })
  }, [])

  useEffect(() => {
    const ok = window.ztools.setSubInput(
      ({ text }) => { setSearchText(text.trim()) },
      '搜索算法名称...',
      false
    )
    if (!ok) return
    return () => { window.ztools.removeSubInput() }
  }, [])

  const onSettingsChange = (s: Settings) => {
    saveSettings(s)
    setSettings(s)
    if (view.kind === 'algorithm') {
      const still = s.enabled[view.id]
      if (!still) {
        const next = firstEnabledId(algorithms, s.enabled)
        setView(next ? { kind: 'algorithm', id: next } : { kind: 'settings' })
      }
    }
  }

  const mods = useMemo(() => algorithms, [])

  return (
    <div className="ct-app">
      <Shell
        modules={mods}
        settings={settings}
        view={view}
        onViewChange={setView}
        onSettingsChange={onSettingsChange}
        searchText={searchText}
        onSearchClear={() => setSearchText('')}
      />
    </div>
  )
}
