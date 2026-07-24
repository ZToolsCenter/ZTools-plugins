<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Unlock from './Unlock/index.vue'

const active = ref(false)
const entryPayload = ref<any>(null)

onMounted(() => {
  window.ztools.onPluginEnter((action: any) => {
    active.value = true
    entryPayload.value = action
  })
  window.ztools.onPluginOut(() => {
    active.value = false
  })
})

watch(active, (val) => {
  if (!val) {
    entryPayload.value = null
  }
})
</script>

<template>
  <Unlock v-if="active" :enter-action="entryPayload" />
</template>
