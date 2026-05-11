/**
 * 应用程序入口文件
 * 负责初始化 Vue 应用和国际化配置
 */

import { createApp } from 'vue'
import 'virtual:svg-icons-register'
import '@/assets/styles/main.scss'
import App from './App.vue'
import i18n from './i18n'
import '@/utils/polyfills'

/**
 * 创建 Vue 应用实例
 */
const app = createApp(App)

/**
 * 安装插件并挂载应用
 * - i18n: 国际化支持
 */
app.use(i18n)
  .mount('#app')