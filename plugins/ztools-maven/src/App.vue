<script setup lang="ts">
import { onMounted, ref } from 'vue'
import MavenUi from './MavenUi/index.vue'
import MavenSearch from './MavenSearch/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  // Guard against non-ZTools host (browser preview, dev tools) — window.ztools
  // is undefined outside the ZTools preload context. Without this guard the
  // onMounted hook throws and the entire component tree fails to render,
  // leaving a blank page.
  if (!window.ztools) return

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
  <!-- Default fallback when no feature has been triggered yet, or when the
       plugin is being previewed outside ZTools. MavenUi is the home. -->
  <MavenUi v-if="!route || route === 'maven-ui'" :enter-action="enterAction" />
  <MavenSearch v-else-if="route === 'maven-search'" :enter-action="enterAction" />
  <MavenUi v-else :enter-action="enterAction" />
</template>
