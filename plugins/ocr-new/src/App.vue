<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Ocr from './Ocr/index.vue'

const route = ref('ocr')
const enterAction = ref<any>({})
const exitTick = ref(0)

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    route.value = action.code?.startsWith('ocr') ? 'ocr' : action.code || 'ocr'
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = 'ocr'
    exitTick.value += 1
  })
})
</script>

<template>
  <Ocr v-if="route === 'ocr'" :enter-action="enterAction" :exit-tick="exitTick" />
</template>
