import { createApp } from 'vue'
// 函数式 API（ElMessage / ElMessageBox）的样式需要手动引入
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
// 暗色模式变量（html.dark 下生效，App.vue 中跟随 ZTools 主题切换 class）
import 'element-plus/theme-chalk/dark/css-vars.css'
import './main.css'
import App from './App.vue'

createApp(App).mount('#app')
