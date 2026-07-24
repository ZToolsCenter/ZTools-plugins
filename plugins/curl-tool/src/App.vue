<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CurlToolPage from './pages/CurlToolPage.vue'

const route = ref('curl')
const enterAction = ref<any>({})
const enterTick = ref(0)

onMounted(() => {
  const ztools = (window as any).ztools
  if (!ztools?.onPluginEnter) return

  ztools.onPluginEnter((action: any) => {
    route.value = action.code || 'curl'
    enterTick.value += 1
    enterAction.value = { ...action, __tick: enterTick.value }
  })
  ztools.onPluginOut(() => {
    route.value = 'curl'
  })
})
</script>

<template>
  <CurlToolPage v-if="route === 'curl' || route === 'curl-tool' || !route" :enter-action="enterAction" />
</template>
