import { createApp } from 'vue'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-loading.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './main.css'
import App from './App.vue'

const html = document.documentElement
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
function syncTheme(e: MediaQueryListEvent | MediaQueryList) {
  html.classList.toggle('dark', e.matches)
}
syncTheme(darkQuery)
darkQuery.addEventListener('change', syncTheme)

createApp(App).mount('#app')
