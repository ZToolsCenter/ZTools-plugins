import { createApp } from 'vue'
import ZToolsUI from 'ztools-ui'
import 'ztools-ui/style'
import { useZtoolsTheme } from 'ztools-ui'
import './main.css'
import App from './App.vue'

// 同步宿主主题：html.dark / data-material / os-* / theme-* / --primary-color
useZtoolsTheme()

createApp(App).use(ZToolsUI).mount('#app')
