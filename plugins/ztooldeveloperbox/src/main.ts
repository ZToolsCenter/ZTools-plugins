import { createApp } from 'vue'
import './main.css'
import { setupZtoolsFallback } from './dev/ztools-mock'
import App from './App.vue'

setupZtoolsFallback()

createApp(App).mount('#app')
