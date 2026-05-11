import { createApp } from 'vue'
import './main.css'
import 'driver.js/dist/driver.css'
import 'highlight.js/styles/github.css'
import App from './App.vue'
import { i18n } from './i18n'

const app = createApp(App)
app.use(i18n)
app.mount('#app')
