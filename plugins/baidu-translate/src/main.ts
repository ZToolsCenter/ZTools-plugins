import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

createApp(App).mount('#app')

// 跟随宿主暗色模式：根节点挂 dark class（样式变量在 main.css）
try {
  const apply = () => {
    const dark = (window as unknown as Record<string, any>).ztools?.isDarkColors?.()
    document.documentElement.classList.toggle('dark', !!dark)
  }
  apply()
  ;(window as unknown as Record<string, any>).ztools?.onThemeChange?.(apply)
} catch {
  /* 无宿主（浏览器开发）：跟随系统 */
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark')
  }
}
