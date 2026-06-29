<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Fast from './Fast/index.vue'

const route = ref('fast')
const enterAction = ref<Record<string, unknown>>({})
const enterKey = ref(0)

onMounted(() => {
  if (!window.ztools?.onPluginEnter) return

  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
    enterKey.value += 1
  })

  window.ztools.onPluginOut(() => {
    route.value = ''
    enterAction.value = {}
  })
})
</script>

<template>
  <Fast v-if="route === 'fast'" :key="enterKey" :enter-action="enterAction" />
</template>
