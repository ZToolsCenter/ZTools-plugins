import { createApp } from 'vue'
import ZToolsUI from 'ztools-ui'
import 'ztools-ui/style.css'
import './styles/base.scss'
import './styles/shared.scss'
import App from './App.vue'

createApp(App).use(ZToolsUI).mount('#app')
