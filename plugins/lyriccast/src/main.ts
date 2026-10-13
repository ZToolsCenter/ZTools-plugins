import { createApp } from 'vue'
import './dev-mock' // dev 浏览器预览用 mock;必须先于 App/store 求值
import './main.css'
import App from './App.vue'

createApp(App).mount('#app')
