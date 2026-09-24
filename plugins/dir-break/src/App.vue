<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Break from './Break/index.vue'

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
  <Break v-if="route === 'break'" :enter-action="enterAction" />
</template>
