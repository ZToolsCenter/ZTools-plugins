import { createApp } from 'vue'
import './styles/main.scss'
import App from './App.vue'
// pinia 实例与持久化插件在 store 层出口组装，入口只负责挂载
import { pinia } from './store'

createApp(App).use(pinia).mount('#app');
