<script setup lang="ts">
import { onMounted, ref } from 'vue'
import V2exBrowser from './V2exBrowser/index.vue'

const enterAction = ref<any>({})

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    enterAction.value = action
  })
})
</script>

<template>
  <V2exBrowser :enter-action="enterAction" />
</template>
