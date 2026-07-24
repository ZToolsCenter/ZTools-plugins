<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import WebApp from './WebApp/index.vue'

const route = ref('')

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
  })

  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <WebApp v-if="route === 'webapp'" />
</template>
