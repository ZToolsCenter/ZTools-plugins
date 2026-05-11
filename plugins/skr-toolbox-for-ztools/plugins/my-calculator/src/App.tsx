import { useEffect, useState } from 'react'
import Calculator from './Calculator'

export default function App() {
  const [enterAction, setEnterAction] = useState<{ code: string; type: string; payload: unknown; option: unknown }>({ code: '', type: '', payload: undefined, option: undefined })
  const [route, setRoute] = useState('')

  useEffect(() => {
    // ZTools 环境检查
    if (!window.ztools) {
      console.log('ZTools not detected, running in standalone mode')
      return
    }

    window.ztools.onPluginEnter((action) => {
      setRoute(action.code)
      setEnterAction(action)
    })
    window.ztools.onPluginOut(() => {
      setRoute('')
    })
  }, [])

  if (route === 'calculator') return <Calculator enterAction={enterAction} />

  return null
}
