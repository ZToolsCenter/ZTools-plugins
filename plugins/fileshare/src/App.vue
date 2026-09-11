<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Share from './Share/index.vue'

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
  <Share v-if="route === 'share'" :enter-action="enterAction" />
</template>
