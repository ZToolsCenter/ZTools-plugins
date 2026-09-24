import { createApp, ref } from 'vue'
import './main.css'
import App from './App.vue'

// Dev mode: inject mocks for window.ztools and window.services
if (import.meta.env.DEV) {
  import('./dev/mockZtools').then(({ injectMocks }) => {
    injectMocks()
  })
}

// ZTools 插件入口：监听插件启动，捕获搜索文本
interface LaunchParam {
  type?: string
  payload?: any
  code?: string
}

let pluginInitPayload: LaunchParam | null = null

if (typeof window !== 'undefined' && window.ztools?.onPluginEnter) {
  window.ztools.onPluginEnter((param: LaunchParam) => {
    // over 类型触发的指令会把搜索文本放到 payload 中
    if (param?.type === 'over' && param.payload) {
      pluginInitPayload = param
    }
  })
}

// 暴露给 App.vue 读取
;(window as any).__getPluginInitPayload = () => pluginInitPayload

createApp(App).mount('#app')