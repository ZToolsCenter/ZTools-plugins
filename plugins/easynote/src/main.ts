import { createApp } from 'vue'
// ElMessage 等 JS 函数式调用需要手动引入样式（自动导入插件不处理函数式 API 样式）
import 'element-plus/theme-chalk/el-message.css'
import './main.css'
import App from './App.vue'

createApp(App).mount('#app')
