import { createApp } from 'vue'
import mavonEditor from 'mavon-editor'
import 'mavon-editor/dist/css/index.css'
import './main.css'
import App from './App.vue'

createApp(App).use(mavonEditor).mount('#app')
