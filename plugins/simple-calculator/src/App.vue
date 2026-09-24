<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Calc from './Calc/index.vue'

const route = ref('')

onMounted(() => {
  if (!window.ztools) {
    // 独立浏览器调试模式，直接显示计算草稿
    route.value = 'calc'
    return
  }
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Calc v-if="route === 'calc' || route === 'calc_regex'" />
</template>
