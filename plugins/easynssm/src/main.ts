import { createApp } from 'vue'
// 函数式 API（ElMessage/ElMessageBox/ElLoading）无法被按需引入插件处理，样式需手动引入
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-loading.css'
// 暗色模式适配：ZTools 常跑暗色，缺这个弹窗/表格会白底刺眼
import 'element-plus/theme-chalk/dark/css-vars.css'
import './main.css'
import App from './App.vue'

const mql = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', mql.matches)
applyTheme()
mql.addEventListener('change', applyTheme)

createApp(App).mount('#app')
