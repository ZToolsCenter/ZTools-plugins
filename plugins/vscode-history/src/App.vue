<script setup lang="ts">
import { onMounted, ref } from 'vue'
import VSCodeMain from './VSCodeMain/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  window.ztools.onPluginEnter((action: any) => {
    route.value = action.code
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <VSCodeMain :enter-action="enterAction" />
</template>
