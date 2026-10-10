import { useEffect, useMemo, useRef, useState } from 'react'
import { algorithms, firstEnabledId } from './registry'
import { Shell, type ShellView } from './shell'
import { loadSettings, saveSettings, syncFeatureDiff, type Settings } from './config'
import { useZtoolsTheme } from './hooks/useZtoolsTheme'

export default function App() {
  // 初始化时只调用一次 loadSettings
  const [settings, setSettings] = useState<Settings>(() => {
    const initial = loadSettings(algorithms)
    // 存储初始 enabled 用于 view 计算
    ;(App as any)._initialEnabled = initial.enabled
    return initial
  })
  const [view, setView] = useState<ShellView>(() => {
    const initialEnabled = (App as any)._initialEnabled ?? loadSettings(algorithms).enabled
    const firstId = firstEnabledId(algorithms, initialEnabled)
    return { kind: 'algorithm', id: firstId ?? '' }
  })
  const [searchText, setSearchText] = useState('')
  const { primaryColor } = useZtoolsTheme()

  // 用一个 ref 追踪上一次的 enabled 状态用于增量同步
  const prevEnabledRef = useRef(settings.enabled)

  useEffect(() => {
    document.documentElement.style.setProperty('--blue', primaryColor)
  }, [primaryColor])

  useEffect(() => {
    // 增量同步：只更新发生变化的模块
    syncFeatureDiff(algorithms, prevEnabledRef.current, settings.enabled)
    prevEnabledRef.current = settings.enabled
  }, [settings.enabled])

  // 用 ref 保持 settings.enabled 最新，避免 effect 依赖它
  const enabledRef = useRef(settings.enabled)
  enabledRef.current = settings.enabled

  useEffect(() => {
    window.ztools.onPluginEnter((action: any) => {
      const code = action.code as string
      if (code && code.startsWith('alg:')) {
        const id = code.slice(4)
        setView({ kind: 'algorithm', id })
        setSearchText('')
      } else {
        const id = firstEnabledId(algorithms, enabledRef.current)
        setView(id ? { kind: 'algorithm', id } : { kind: 'settings' })
        setSearchText('')
      }
    })
  }, [])
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
