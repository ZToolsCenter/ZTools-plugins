<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Password from './Password/index.vue'

const route = ref('')
const enterAction = ref<any>(null)

function getZtoolsApi(): ZToolsApi | null {
  const api = (window as any).ztools
  if (!api || typeof api !== 'object') {
    return null
  }
  return api as ZToolsApi
}

onMounted(() => {
  const ztoolsApi = getZtoolsApi()

  if (!ztoolsApi) {
    route.value = 'password'
    return
  }

  ztoolsApi.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })

  ztoolsApi.onPluginOut(() => {
    route.value = ''
    enterAction.value = null
  })
})
</script>

<template>
  <Password v-if="route === 'password'" :enter-action="enterAction" />
</template>
