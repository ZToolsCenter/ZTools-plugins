import { useEffect, useState } from 'react'
import GoldPrice from './GoldPrice'

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const zt = (window as any).ztools
    if (!zt) {
      // 非 ZTools 环境（浏览器开发模式），直接显示
      setReady(true)
      return
    }
    // ZTools 环境：注册插件生命周期并监听路由
    zt.onPluginEnter((action: any) => {
      // 收到 enter 事件后渲染页面
      setReady(true)
    })
    zt.onPluginOut(() => {
      setReady(false)
    })
  }, [])

  // 未收到 enter 事件前显示 loading，避免空白闪烁
  if (!ready) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: '#9ca3af',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 14,
      }}>
        加载中...
      </div>
    )
  }

  return <GoldPrice />
}