<script setup lang="ts">
import { onMounted, ref } from 'vue'
import KillProcess from './KillProcess/index.vue'

const route = ref('killprocess')
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
  <KillProcess v-if="route === 'killprocess'" :enter-action="enterAction" />
</template>
