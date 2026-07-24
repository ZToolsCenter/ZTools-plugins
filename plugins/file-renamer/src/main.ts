import { createApp } from 'vue'
import './main.css'
import App from './App.vue'
import { registry } from './core/registry'
import { builtInPlugins } from './plugins'
import { i18n } from './i18n'

/**
 * 初始化应用程序，在挂载Vue应用程序之前将所有内置插件注册到全局注册表。
 */
builtInPlugins.forEach(plugin => {
  registry.register(plugin)
})

const app = createApp(App)
app.use(i18n)
app.mount('#app')
