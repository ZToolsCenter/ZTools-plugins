<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Editor from './Editor/index.vue'

const enterAction = ref<Record<string, unknown>>({})

onMounted(() => {
  try {
    window.ztools?.onPluginEnter?.((action) => {
      enterAction.value = action
    })
  } catch (err) {
    console.error('[regex-editor] ztools init failed:', err)
  }
})
</script>

<template>
  <Editor :enter-action="enterAction" />
</template>
