import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus, { messageConfig } from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import '@/styles/common.scss'
import router from './router'
// 移除了remixicon字体导入，以减少打包体积

const app = createApp(App)
const pinia = createPinia()

Object.assign(messageConfig, {
  showClose: true
})

app.use(router)
app.use(pinia)
app.use(ElementPlus)
app.mount('#app') 
