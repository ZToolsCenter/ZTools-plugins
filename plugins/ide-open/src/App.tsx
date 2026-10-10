import { useEffect, useState } from 'react'
import Settings from './Settings'
import ProjectList from './ProjectList'
import { getIDEs, type IDEItem } from './store'

type View =
  | { page: 'settings' }
  | { page: 'projects'; ide: IDEItem }

export default function App() {
  const [view, setView] = useState<View>({ page: 'settings' })

  useEffect(() => {
    window.ztools.onPluginEnter((action) => {
      window.services?.debugLog('onPluginEnter', action.code)
      if (action.code === 'ideopen') { setView({ page: 'settings' }); return }
      const ides = getIDEs()
      window.services?.debugLog('当前 IDE 列表', ides.map(i => i.code))
      const ide = ides.find(i => i.code === action.code)
      if (ide) {
        window.services?.debugLog('匹配到 IDE', ide)
        setView({ page: 'projects', ide })
      } else {
        window.services?.debugLog('未找到匹配的 IDE', action.code)
      }
    })
    window.ztools.onPluginOut(() => {
      setView({ page: 'settings' })
    })
  }, [])

  if (view.page === 'projects') return <ProjectList ide={view.ide} onBack={() => setView({ page: 'settings' })} />

  return <Settings />
}
