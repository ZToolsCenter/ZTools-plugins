<script setup lang="ts">
import { onMounted } from 'vue'

// 进入此 feature 即自动开启悬浮窗并隐藏主插件窗口
// 不渲染任何 UI，仅作为"直接弹悬浮窗"的触发入口
onMounted(() => {
  const id = window.services.openFloatWindow()
  if (id === null) {
    // openFloatWindow 内部已通过 notification 暴露具体错误
    // 这里兜底提示
    try {
      window.ztools.showNotification && window.ztools.showNotification('悬浮窗开启失败，请重试')
    } catch (_e) {
      // ignore
    }
  }
  // 无论成功失败都隐藏主插件窗口（进程保留以便管理悬浮窗 / 下次快速进入）
  try {
    window.ztools.outPlugin()
  } catch (_e) {
    // ignore
  }
})
</script>

<template>
  <div class="auto-float"></div>
</template>

<style scoped>
.auto-float {
  width: 0;
  height: 0;
  overflow: hidden;
}
</style>
