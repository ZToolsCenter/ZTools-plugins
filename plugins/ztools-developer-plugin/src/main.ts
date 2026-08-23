import { createApp } from 'vue'
import './main.css'
// element-plus 暗色 CSS 变量（组件样式由按需导入自动注入，暗色变量需手动引入）
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'

const app = createApp(App)
app.mount('#app')

// 暗色模式适配：element-plus 通过 html.dark 切换暗色
// 用 matchMedia 监听系统暗色（ztools 通常跟随系统，且无暗色变化事件 API）
const mql = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark)
}
applyTheme(mql.matches)
mql.addEventListener('change', (e) => applyTheme(e.matches))
