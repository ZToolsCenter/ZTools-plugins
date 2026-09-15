import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

// Avoid a dark first-frame flash before the persisted ZTools preference is read.
document.documentElement.dataset.theme ||= 'light'
document.documentElement.style.colorScheme ||= 'light'

createApp(App).mount('#app')
