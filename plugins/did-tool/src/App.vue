<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DockerDownloader from './DockerDownloader.vue'

const active = ref(!('ztools' in window))

onMounted(() => {
  if (!('ztools' in window)) return
  window.ztools.onPluginEnter((action) => {
    if (action.code === 'docker-pull') {
      active.value = true
      window.ztools.setExpendHeight(650)
    }
  })
})
</script>

<template>
  <DockerDownloader v-if="active" />
</template>
