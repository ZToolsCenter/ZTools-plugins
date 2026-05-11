import { createApp } from 'vue';
import Toast from '../components/Toast/index.vue';

let instance = null

function getInstance() {
  if (!instance) {
    const div = document.createElement('div')
    document.body.appendChild(div)

    const app = createApp(Toast)
    instance = app.mount(div)
  }
  return instance
}

export default function showToast(message, type = 'info', duration = 3000) {
  const inst = getInstance()
  inst.open(message, type, duration)
}