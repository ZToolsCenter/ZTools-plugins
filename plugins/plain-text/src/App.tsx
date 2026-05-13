import { useEffect, useState } from 'react'
import Editor from './Editor'

export default function App() {
  const [route, setRoute] = useState('')

  useEffect(() => {
    window.ztools.onPluginEnter((action) => {
      setRoute(action.code)
    })
    window.ztools.onPluginOut(() => {
      setRoute('')
    })
  }, [])

  if (route === 'editor') return <Editor />

  return null
}
