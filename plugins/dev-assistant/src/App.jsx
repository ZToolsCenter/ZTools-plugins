import { useEffect, useState } from 'react'
import Hello from './Hello'
import Read from './Read'
import Write from './Write'
import DevTools from './DevTools'
import { getHost } from './host.js'

export default function App () {
  const [enterAction, setEnterAction] = useState({})
  const [route, setRoute] = useState('dev-tools')

  useEffect(() => {
    const host = getHost()
    if (!host) return
    host.onPluginEnter((action) => {
      setRoute(action.code || 'dev-tools')
      setEnterAction(action)
    })
    host.onPluginOut(() => {
      setRoute('dev-tools')
    })
  }, [])

  if (route === 'hello') {
    return <Hello enterAction={enterAction} />
  }

  if (route === 'read') {
    return <Read enterAction={enterAction} />
  }

  if (route === 'write') {
    return <Write enterAction={enterAction} />
  }

  return <DevTools enterAction={enterAction} />
}
