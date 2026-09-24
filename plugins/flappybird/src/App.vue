<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Game from './game/index.vue'

const route = ref('')
const enterAction = ref<Record<string, unknown>>({})

onMounted(() => {
  const enter = (action: { code?: string } | undefined) => {
    route.value = action?.code || 'flappy'
    enterAction.value = (action as Record<string, unknown>) ?? {}
  }

  try {
    window.ztools.onPluginEnter((action) => enter(action))
    window.ztools.onPluginOut(() => {
      route.value = ''
    })
  } catch {
    enter({ code: 'flappy' })
  }

  window.setTimeout(() => {
    if (!route.value) enter({ code: 'flappy' })
  }, 400)
})
</script>

<template>
  <Game v-if="route === 'flappy'" :enter-action="enterAction" />
</template>
