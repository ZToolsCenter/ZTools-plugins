<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Containers from './Containers/index.vue'

const route = ref('containers')

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    // 本期唯一注册功能为 containers；直接点开插件时 code 为空，默认进主页
    if (action.code && action.code !== 'containers') return
    route.value = 'containers'
  })
  window.ztools.onPluginOut(() => {
    // 卸载 Containers，触发其 onBeforeUnmount 清理 3s 轮询与日志子进程
    route.value = ''
  })
})
</script>

<template>
  <Containers v-if="route === 'containers'" />
</template>
