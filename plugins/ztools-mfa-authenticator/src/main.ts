import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

async function bootstrap() {
  if (import.meta.env.DEV && !window.ztools) {
    await import('./mock-ztools')
  }
  createApp(App).mount('#app')
}

bootstrap()
