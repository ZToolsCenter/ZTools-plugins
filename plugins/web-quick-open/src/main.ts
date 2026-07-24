import { createApp } from 'vue'
import ZToolsUI, { useZtoolsTheme } from 'ztools-ui'
import 'ztools-ui/style.css'
import './style.css'
import App from './App.vue'

useZtoolsTheme()

createApp(App).use(ZToolsUI).mount('#app')
