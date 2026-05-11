<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Snippets from './Snippets/index.vue'

const route = ref('')
const enterAction = ref<any>({})
const isDev = ref(false)

onMounted(() => {
  const ztools = (window as any).ztools

  if (!ztools) {
    isDev.value = true
    route.value = 'snippets'
    return
  }

  ztools.setExpendHeight(600)

  ztools.onPluginEnter((action: any) => {
    route.value = action.code
    enterAction.value = action
  })

  ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Snippets v-if="route === 'snippets'" :enter-action="enterAction" />
  <div v-else-if="!route && isDev" class="dev-hint">
    <p>开发模式：请在 ZTools 中使用插件，或直接查看组件</p>
  </div>
</template>

<style scoped>
.dev-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #666;
  font-size: 14px;
}
</style>
