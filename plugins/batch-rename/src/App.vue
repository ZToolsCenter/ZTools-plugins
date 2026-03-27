<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Rename from './Rename/index.vue'

const route = ref('')
const enterAction = ref<any>({})

const isDev = computed(() => import.meta.env.DEV)

onMounted(() => {
  if (window.ztools && window.ztools.onPluginEnter) {
    window.ztools.onPluginEnter((action) => {
      route.value = action.code
      enterAction.value = action
    })
    window.ztools.onPluginOut(() => {
      route.value = ''
    })
  }
})
</script>

<template>
  <Rename v-if="route === 'rename' || isDev" :enter-action="enterAction" />
</template>
