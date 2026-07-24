<script setup lang="ts">
import { onMounted, ref } from 'vue'
import OpenList from './OpenList/index.vue'

const route = ref('openlist')
const enterAction = ref<any>({ code: 'openlist' })
const hasZTools = typeof window !== 'undefined' && Boolean(window.ztools)

function resolveRoute(code?: string) {
  return ['openlist', 'OpenListUI'].includes(code || '') ? 'openlist' : code || 'openlist'
}

onMounted(() => {
  if (!hasZTools) return

  window.ztools.onPluginEnter((action) => {
    route.value = resolveRoute(action.code)
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = 'openlist'
  })
})
</script>

<template>
  <OpenList v-if="hasZTools && route === 'openlist'" :enter-action="enterAction" />
  <main v-else class="runtime-hint">
    <h1>OpenList</h1>
    <p>请在 ZTools 插件环境中运行，文件选择、上传和下载需要 preload 服务。</p>
  </main>
</template>

<style scoped>
.runtime-hint {
  display: grid;
  min-height: 100vh;
  place-content: center;
  padding: 24px;
  text-align: center;
}

.runtime-hint h1 {
  margin: 0 0 8px;
  color: #184a7d;
}

.runtime-hint p {
  margin: 0;
  color: #64748b;
}
</style>
