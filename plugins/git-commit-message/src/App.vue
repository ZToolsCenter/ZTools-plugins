<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CommitMessage from './CommitMessage/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  if (!window.ztools?.onPluginEnter) return

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
  <CommitMessage v-if="!route || route === 'commit-message'" :enter-action="enterAction" />
</template>
