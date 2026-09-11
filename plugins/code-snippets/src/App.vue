<script setup lang="ts">
import { onMounted, ref, nextTick } from 'vue'
import Snippets from './Snippets/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  const ztools = (window as any).ztools

  if (!ztools) {
    route.value = 'snippets'
    return
  }

  ztools.setExpendHeight(600)

  ztools.onPluginEnter((action: any) => {
    route.value = action.code
    enterAction.value = action
    // 子输入框失焦，插件应用获得焦点，使快捷键生效
    nextTick(() => {
      ztools.subInputBlur?.()
    })
  })

  ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Snippets v-if="route === 'snippets'" :enter-action="enterAction" />
</template>
