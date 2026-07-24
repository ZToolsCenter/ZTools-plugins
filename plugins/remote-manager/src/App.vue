<script setup lang="ts">
import { onMounted, ref } from 'vue'
import RemoteManager from './RemoteManager/index.vue'

const route = ref('remote-manager')
const enterAction = ref<any>({})

onMounted(() => {
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
  <RemoteManager v-if="route === 'remote-manager'" :enter-action="enterAction" />
</template>
