import { useEffect, useState } from 'react'
import CalcDraft from './CalcDraft'

export default function App() {
  const [route, setRoute] = useState('')

  useEffect(() => {
    // 非 ZTools 环境（如浏览器直接打开）没有插件 API，直接渲染便于调试预览
    if (!window.ztools) {
      setRoute('calc')
      return
    }
    window.ztools.onPluginEnter((action: any) => {
      setRoute(action.code)
    })
    window.ztools.onPluginOut(() => {
      setRoute('')
    })
  }, [])

  if (route === 'calc') return <CalcDraft />

  return null
}
