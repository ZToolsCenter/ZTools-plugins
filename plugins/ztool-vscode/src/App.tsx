import { useEffect, useState } from 'react'
import VSCodeRecent from './VSCodeRecent'
import VSCodeSettings from './VSCodeSettings'

export default function App() {
  const [enterAction, setEnterAction] = useState<any>({})
  const [route, setRoute] = useState('')

  useEffect(() => {
    window.ztools.onPluginEnter((action) => {
      setRoute(action.code)
      setEnterAction(action)
    })
    window.ztools.onPluginOut(() => {
      setRoute('')
    })
  }, [])

  if (route === 'vscode') return <VSCodeRecent />
  if (route === 'vsc-settings') return <VSCodeSettings />

  return null
}
