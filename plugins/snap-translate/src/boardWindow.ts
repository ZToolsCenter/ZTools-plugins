import { createApp } from 'vue'
import ZToolsUI from 'ztools-ui'
import 'ztools-ui/style'
import { useZtoolsTheme } from 'ztools-ui'
import './main.css'
import BoardView from './views/BoardView.vue'

// 悬浮贴窗口入口（createBrowserWindow 打开）。
// 通过 sendToParent 请求主窗口跑 OCR/翻译；主窗口 inject 回结果。
useZtoolsTheme()

document.documentElement.style.overflow = 'hidden'
document.body.style.overflow = 'hidden'
const appEl = document.getElementById('app')
if (appEl) appEl.style.overflow = 'hidden'

const app = createApp(BoardView)
app.use(ZToolsUI)
app.mount('#app')
