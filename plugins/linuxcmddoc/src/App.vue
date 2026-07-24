<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LinuxCmdDoc from './linuxcmd/index.vue'

const route = ref('linuxcmddoc')
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
  <LinuxCmdDoc v-if="route === 'linuxcmddoc'" :enter-action="enterAction" />
</template>
