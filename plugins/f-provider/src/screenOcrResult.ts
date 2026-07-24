import { createApp } from 'vue'
import ZToolsUI from 'ztools-ui'
import 'ztools-ui/style'
import { useZtoolsTheme } from 'ztools-ui'
import './main.css'
import ScreenOcrResult from './views/ScreenOcrResult.vue'

// 结果展示窗口入口（由 ztools.createBrowserWindow 打开）。
//
// 与主窗口的区别：该窗口由 createBrowserWindow 创建，**不带 preload**，
// 也没有可靠的 window.ztools API（子窗口未必注入）。因此窗口只做展示——
// 主窗口在外层完成「截图 + OCR 识别」后，通过 webContents.executeJavaScript
// 把识别结果（imageSrc + lines + isDark）注入到本窗口。
//
// 注入方式：主窗口调用 executeJavaScript('window.__loadScreenOcrResult({...})')。
// 本入口在挂载后挂载 window.__loadScreenOcrResult，并把数据交给组件渲染。

// useZtoolsTheme 在无 window.ztools 时会优雅降级（不报错），主题以注入的 isDark 为准。
useZtoolsTheme()

const app = createApp(ScreenOcrResult)
app.use(ZToolsUI)
app.mount('#app')
