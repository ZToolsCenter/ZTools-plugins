<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Ocr from './Ocr/index.vue'

const route = ref('')
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
  <Ocr v-if="route === 'ocr'" :enter-action="enterAction" />
</template>
