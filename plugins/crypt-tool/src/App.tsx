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
  const [enterPayload, setEnterPayload] = useState<string | undefined>(undefined)
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
      const payload =
        action.type === 'text' || action.type === 'over' || action.type === 'regex'
          ? typeof action.payload === 'string'
            ? action.payload
            : undefined
          : undefined

      if (code && code.startsWith('alg:')) {
        const id = code.slice(4)
        setEnterPayload(payload)
        setView({ kind: 'algorithm', id })
      } else {
        const id = firstEnabledId(algorithms, settings.enabled)
        setEnterPayload(payload)
        setView(id ? { kind: 'algorithm', id } : { kind: 'settings' })
      }
    })
    window.ztools.onPluginOut(() => {
      setEnterPayload(undefined)
    })
  }, [settings.enabled])

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
        enterPayload={enterPayload}
      />
    </div>
  )
}
