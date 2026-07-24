import { createApp } from 'vue'
// Element Plus 样式：函数式 API（ElMessage、ElMessageBox）需要手动引入样式
// 组件标签（<el-button> 等）由 unplugin-vue-components 自动按需引入
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './main.css'
import App from './App.vue'

const app = createApp(App)

// 检测深色模式并应用
const initDarkMode = () => {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (isDark) {
    document.documentElement.classList.add('dark')
  }
}

initDarkMode()

// 监听主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (e.matches) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
})

app.mount('#app')