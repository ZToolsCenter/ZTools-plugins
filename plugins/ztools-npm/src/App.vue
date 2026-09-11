<script setup lang="ts">
import { onMounted, ref } from 'vue'
import NpmUi from './NpmUi/index.vue'
import NpmQuick from './NpmQuick/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  // 非 ZTools 宿主（浏览器预览）下安全退出，避免整棵树崩溃
  if (!window.ztools) return
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
  <NpmUi v-if="!route || route === 'npm-ui'" :enter-action="enterAction" />
  <NpmQuick v-else-if="route === 'npm-search'" :enter-action="enterAction" />
  <NpmUi v-else :enter-action="enterAction" />
</template>
