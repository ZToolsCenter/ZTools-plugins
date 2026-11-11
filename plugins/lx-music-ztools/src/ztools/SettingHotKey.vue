<template>
  <dt id="hotkey">快捷键设置</dt>
  <dd>
    <p>快捷键由 ZTools 统一管理，可在下方为各条 LX 指令设置全局快捷键。</p>
    <p v-for="label in labels" :key="label" class="gap-top"><base-btn class="btn" min @click="configure(label)">{{ label }}</base-btn></p>
    <p v-if="error" role="alert" class="gap-top">{{ error }}</p>
    <p class="gap-top">在 ZTools 输入「lx 搜索 歌曲名」可以搜索音乐。媒体键及 Windows 任务栏缩略图按钮目前不提供独立注册。</p>
  </dd>
</template>
<script setup>
import { ref } from 'vue'
const labels = ['LX 播放/暂停', 'LX 上一首', 'LX 下一首', 'LX 搜索', 'LX 桌面歌词']
const error = ref('')
const configure = async label => {
  error.value = ''
  try { if (await window.lxHost.invoke('host:hotkeySetting', label) === false) throw new Error('无法打开快捷键设置，请从 ZTools 设置中配置该指令。') }
  catch (cause) { error.value = String(cause.message || cause) }
}
</script>
