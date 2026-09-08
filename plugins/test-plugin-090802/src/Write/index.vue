<script setup lang="ts">
import { watch } from 'vue'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

watch(
  () => props.enterAction,
  (enterAction: any) => {
    let outputPath
    try {
      if (enterAction.type === 'over') {
        outputPath = window.services.writeTextFile(enterAction.payload)
      } else if (enterAction.type === 'img') {
        outputPath = window.services.writeImageFile(enterAction.payload)
      }
    } catch (err) {
      // 写入错误弹出通知
      window.ztools.showNotification('文件保存出错了！')
    }
    if (outputPath) {
      // 在资源管理器中显示
      window.ztools.shellShowItemInFolder(outputPath)
    }
    // 退出插件应用
    window.ztools.outPlugin()
  },
  {
    immediate: true
  }
)
</script>

<template>
  <div></div>
</template>
