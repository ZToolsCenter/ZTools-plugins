import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

window.addEventListener('error', (event) => {
  console.error('[regex-editor]', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[regex-editor] unhandled rejection:', event.reason)
})

createApp(App).mount('#app')
