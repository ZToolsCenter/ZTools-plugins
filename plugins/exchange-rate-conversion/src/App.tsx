import { useEffect, useState } from 'react'
import Rate from './Rate'

export default function App() {
  const [enterAction, setEnterAction] = useState<any>({})
  const [route, setRoute] = useState('')

  useEffect(() => {
    // 浏览器开发预览（非 ZTools 环境）：直接进入 rate 路由
    if (typeof window.ztools === 'undefined' || !window.ztools.onPluginEnter) {
      setRoute('rate')
      setEnterAction({ code: 'rate', type: 'regex' })
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

  if (route === 'rate') return <Rate enterAction={enterAction} />

  return null
}
