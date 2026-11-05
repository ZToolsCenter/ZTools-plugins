import { createApp } from 'vue'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './main.css'
import App from './App.vue'

const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', mq.matches)
applyTheme()
mq.addEventListener('change', applyTheme)

createApp(App).mount('#app')
