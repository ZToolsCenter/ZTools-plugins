<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Page from './Page/index.vue'

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
  <Page v-if="route === 'page'" :enter-action="enterAction" />
</template>
