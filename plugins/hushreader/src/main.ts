import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './main.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

const saved = localStorage.getItem('hushreader_config')
if (saved) {
  try {
    const cfg = JSON.parse(saved)
    const theme = cfg?.other?.theme
    if (theme) {
      if (theme === 'auto') {
        const isDark = (window as any).ztools?.isDarkColors?.() ?? window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
      } else {
        document.documentElement.setAttribute('data-theme', theme)
      }
    }
  } catch { }
}
