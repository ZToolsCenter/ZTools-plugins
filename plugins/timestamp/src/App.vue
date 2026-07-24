<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Timestamp from './components/timestamp/timestamp.vue'

const route = ref('')
const launchParam = ref<any>({})

onMounted(() => {
  window.ztools.onPluginEnter((param) => {
    route.value = param.code
    launchParam.value = param
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Timestamp v-if="route === 'timestamp'" :launch-param="launchParam" />
</template>
