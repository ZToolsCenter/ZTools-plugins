<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Utc from './Utc/index.vue'
import Float from './Utc/Float.vue'
import AutoFloat from './Utc/AutoFloat.vue'

const route = ref('')
const enterAction = ref<any>({})
const isFloat = computed(() => window.location.hash === '#float')

onMounted(() => {
  // 悬浮窗模式不监听插件进入/退出（独立窗口无此事件）
  if (isFloat.value) return

  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Float v-if="isFloat" />
  <AutoFloat v-else-if="route === 'utc-float'" />
  <Utc v-else :enter-action="enterAction" />
</template>
