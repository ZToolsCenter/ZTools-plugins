<script setup lang="ts">
import { ref, onMounted } from 'vue'
import LxButton from '../vendor/lx/src/renderer/components/base/Btn.vue'
const host = ref('等待连接 ZTools')
const feature = ref('未触发')
const count = ref(0)
const message = ref('')
const available = Boolean(window.ztools && window.services)
/** 检查 preload 桥接和宿主信息。 */
function diagnose() {
  if (!available) { host.value = '浏览器预览 · 请在 ZTools 中验证本地能力'; return }
  try {
    const result = window.services.diagnose()
    host.value = `${result.app} ${result.version} · Node ${result.node}`
    count.value = window.services.getLaunchCount()
    message.value = 'preload 桥接正常'
  } catch (error) { message.value = String(error) }
}
/** 写入并回读插件专属存储。 */
function checkStorage() {
  try { message.value = window.services.checkStorage() ? '存储写入与回读成功' : '存储校验失败' }
  catch (error) { message.value = String(error) }
}
onMounted(() => {
  diagnose()
  if (!available) return
  window.services.subscribe('lifecycle:enter', (action) => {
    feature.value = action.code || '打开插件'
    count.value = window.services.getLaunchCount()
    message.value = '插件进入事件已接收'
  })
  window.services.subscribe('lifecycle:hide', () => { message.value = '插件已转入后台' })
})
</script>
<template>
  <main>
    <header><img src="../src-ztools/logo.png" alt="LX Music" /><div><p class="eyebrow">ZTOOLS PLUGIN · 0.0.1</p><h1>LX Music</h1></div><span class="tag">框架验证版</span></header>
    <p class="intro">插件运行环境与发布链路验证。音乐功能将在后续移植中接入。</p>
    <dl><div><dt>宿主环境</dt><dd data-testid="host">{{ host }}</dd></div><div><dt>触发指令</dt><dd data-testid="feature">{{ feature }}</dd></div><div><dt>累计进入</dt><dd data-testid="count">{{ count }}</dd></div></dl>
    <div class="actions"><LxButton @click="diagnose">原 LX 组件 · 检查环境</LxButton><button :disabled="!available" @click="checkStorage">验证插件存储</button></div>
    <p role="status">{{ message }}</p><footer>输入「LX Music」或「洛雪音乐」打开插件</footer>
  </main>
</template>
