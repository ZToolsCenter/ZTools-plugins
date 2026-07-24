import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { Plus, Delete, Clock, Key, CopyDocument } from '@element-plus/icons-vue'
import './main.css'
import App from './App.vue'

const app = createApp(App)
app.use(ElementPlus)
app.component('Plus', Plus)
app.component('Delete', Delete)
app.component('Clock', Clock)
app.component('Key', Key)
app.component('CopyDocument', CopyDocument)
app.mount('#app')
