import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../ui/desktop/App'
import { installMockIfNeeded } from '../../adapters/browser/mock'
import { installPorts } from '../../runtime/ports'
import { installCompositorKeepalive } from '../../runtime/compositor-keepalive'
import { createElectronPorts } from '../../adapters/electron/ports'
import 'katex/dist/katex.min.css'
import '../../ui/styles/app.css'

// 浏览器里没有 preload 时用本地 mock 数据，装了真插件时这行不生效
installMockIfNeeded()
// 端口的 electron 实现只是把 preload 的同步桥包成 async；
// 纯浏览器预览时桥是 mock，同样能跑通，不需要额外分支。
installPorts(createElectronPorts())
// 防「长时间空闲后整窗白屏」：ZTools 是 WebContentsView，Windows 遮挡检测会停渲染，
// 恢复后不重绘，只有 resize 才回来。周期性出帧让 surface 活着。
installCompositorKeepalive()

/** 把运行时错误写到磁盘可读的位置，避免白屏后无从查起 */
function recordError(where: string, e: unknown) {
  const msg = e instanceof Error ? `${e.message}\n${(e.stack || '').split('\n').slice(0, 8).join('\n')}` : String(e)
  console.error('[cmark]', where, msg)
  try {
    const prev = localStorage.getItem('cmark:lastError') || ''
    localStorage.setItem('cmark:lastError', `${new Date().toISOString()} ${where}\n${msg}\n\n---prev---\n${prev.slice(0, 2000)}`)
  } catch (err) {}
}

window.addEventListener('error', (e) => recordError('window.error', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => recordError('unhandledrejection', e.reason))

/** 渲染期错误在这里兜住，页面不会整片空白 */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  componentDidCatch(err: Error) {
    recordError('render', err)
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: 'Consolas, monospace', fontSize: 12, color: '#cf222e', whiteSpace: 'pre-wrap' }}>
          {'渲染失败：\n\n' + this.state.err.message + '\n\n' + (this.state.err.stack || '').split('\n').slice(0, 12).join('\n')}
        </div>
      )
    }
    return this.props.children
  }
}

window.addEventListener('load', () => {
  const last = localStorage.getItem('cmark:lastError')
  if (last) console.warn('[cmark] 上次错误:', last)
})

// 不用 StrictMode：它会把 effect 跑两遍，编辑器实例会双建
createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>
)
