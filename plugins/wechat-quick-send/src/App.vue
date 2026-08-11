<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    // 根据触发类型分发到对应的 preload 服务
    if (action.type === 'over') {
      // 任意文本触发 → 发送文本到微信
      window.services.sendTextToWeChat(action.payload)
    } else if (action.type === 'files') {
      // 文件拖拽触发 → 发送文件到微信
      const filePaths = action.payload.map((f: any) => f.path)
      window.services.sendFilesToWeChat(filePaths)
    }

    // 无界面插件，处理完毕立即退出
    window.ztools.outPlugin()
  })
})
</script>

<template>
  <div></div>
</template>
