import { createApp } from 'vue'
import App from './App.vue'
import tooltip from './directives/tooltip.js'
import './styles.css'

// 页面挂载前关闭历史滚动恢复，避免开发 URL 重载时 Chromium 覆盖会话控制器的贴底位置。
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

const app = createApp(App)
app.directive('tooltip', tooltip)
app.mount('#app')
