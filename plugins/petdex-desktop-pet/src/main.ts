import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { disposePetWindowController, restorePetWindow } from './petWindowController'

const app = createApp(App)
app.mount('#app')

/**
 * 在插件页面就绪后恢复上次启用的桌宠。
 * @returns 恢复完成后的 Promise。
 */
async function initializeRuntime(): Promise<void> {
  await restorePetWindow()
}

window.ztools.onPluginEnter(() => {
  void restorePetWindow()
})

window.ztools.onPluginOut((isKill) => {
  // 普通隐藏时保留桌宠；插件被终止时释放子窗口与事件监听。
  if (isKill) disposePetWindowController()
})

initializeRuntime().catch((error) => {
  console.error('[petdex-desktop-pet] failed to restore runtime', error)
})
