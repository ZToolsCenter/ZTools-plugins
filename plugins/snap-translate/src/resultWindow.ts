import { createApp } from 'vue'
import ZToolsUI from 'ztools-ui'
import 'ztools-ui/style'
import { useZtoolsTheme } from 'ztools-ui'
import './main.css'
import ResultView from './views/ResultView.vue'

// 结果展示窗口入口（由 ztools.createBrowserWindow 打开）。
//
// 该窗口不带 preload，也没有可靠的 window.ztools —— 只做纯展示。
// 主窗口完成「截图 + OCR + 翻译」后，通过 webContents.executeJavaScript
// 调用本窗口挂载的 window.__loadSnapResult(payload) 注入数据。
// 注入是幂等的（主窗口有 800ms 兜底重注），重复调用无副作用。

// useZtoolsTheme 在无 window.ztools 时优雅降级；主题以注入的 isDark 为准。
useZtoolsTheme()

const app = createApp(ResultView)
app.use(ZToolsUI)
app.mount('#app')
