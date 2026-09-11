import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { installDevMock } from './devMock'

if (import.meta.env.DEV && !window.deviceLink) installDevMock()

createApp(App).mount('#app')
