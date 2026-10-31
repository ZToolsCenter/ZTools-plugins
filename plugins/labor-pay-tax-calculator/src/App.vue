<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Calculator from './Calculator/index.vue'

const enterAction = ref<any>({})

function handleEnter(action: any) {
  enterAction.value = action || {}
}

function handleOut() {
  enterAction.value = {}
}

onMounted(() => {
  window.ztools.onPluginEnter(handleEnter)
  window.ztools.onPluginOut(handleOut)
})
</script>

<template>
  <Calculator :enter-action="enterAction" />
</template>
