import { createApp } from 'vue'
import ZToolsUI from 'ztools-ui'
import 'ztools-ui/style'
import 'virtual:uno.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)
app.use(ZToolsUI)

app.mount('#app')
