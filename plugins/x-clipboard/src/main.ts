import { createApp } from 'vue'

import App from './App.vue'
import { initTheme } from './lib/theme'
import './styles/base.css'

// 挂载前先把强调色的派生变量算好，免得首帧闪一下白字
initTheme()

createApp(App).mount('#app')
