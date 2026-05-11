import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

createApp(App).mount('#app')

try {
  window.ztools?.onPluginEnter?.((action) => {
    if (action.payload) {
      window.dispatchEvent(new CustomEvent('ztools-enter', { detail: action.payload }))
    }
  })
} catch {
  // 独立开发模式下 ztools 不可用
}
