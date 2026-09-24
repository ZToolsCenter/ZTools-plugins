import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

const app = createApp(App)
app.mount('#app')

// 暗色模式适配：跟随系统（ztools 通常跟随系统，且无暗色变化事件 API）
const mql = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark)
}
applyTheme(mql.matches)
mql.addEventListener('change', (e) => applyTheme(e.matches))
