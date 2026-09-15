import { createApp } from 'vue'
import { useZtoolsTheme } from 'ztools-ui'
import './main.css'
import App from './App.vue'

// 同步宿主主题：html.dark / data-material / os-* / theme-* / --primary-color。
// ztools-ui 组件库已整体移除（UI 换为本地 Scandi 组件层 + reka-ui 原语），
// 唯一保留点是这条主题同步 composable —— 宿主切换亮暗时在 <html> 上切换
// .dark 等类名，main.css 的深色令牌块（html.dark）随之生效。
useZtoolsTheme()

createApp(App).mount('#app')
