import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

// 开发预览时模拟 ZTools 环境，生产构建会被摇除
if (import.meta.env.DEV && typeof window.ztools === 'undefined') {
  const { installDevMock } = await import('./dev-mock')
  installDevMock()
}

const isDark =
  typeof window.ztools !== 'undefined'
    ? window.ztools.isDarkColors()
    : window.matchMedia('(prefers-color-scheme: dark)').matches
if (isDark) document.documentElement.classList.add('dark')

createApp(App).mount('#app')
