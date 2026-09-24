import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

// ElMessage / ElMessageBox 为函数式调用，自动导入插件无法处理其样式，需手动引入
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
// 暗色主题变量：跟随系统切换 html.dark，否则弹窗/卡片在暗色下是白底
import 'element-plus/theme-chalk/dark/css-vars.css'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', media.matches)
applyTheme()
media.addEventListener('change', applyTheme)

createApp(App).mount('#app')
