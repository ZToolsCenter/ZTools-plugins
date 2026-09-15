<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Reminder from './Reminder/index.vue'

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
  <Reminder v-if="route === 'easyreminder'" :enter-action="enterAction" />
</template>
