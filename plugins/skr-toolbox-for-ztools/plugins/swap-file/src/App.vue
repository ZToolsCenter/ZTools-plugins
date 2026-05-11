<script setup lang="ts">
import FileShare from './FileShare/index.vue'
import { useFileShareStore } from './store/fileShare'

const store = useFileShareStore()

window.ztools.onPluginEnter(async (action) => {
  if (action.type === 'files' && action.payload?.length) {
    for (const item of action.payload) {
      if (item.path) {
        await store.addFile(item.path)
      }
    }
    if (store.serverRunning) {
      await store.startServer()
    }
  }
})
window.ztools.onPluginOut(() => {})
</script>

<template>
  <FileShare />
</template>
