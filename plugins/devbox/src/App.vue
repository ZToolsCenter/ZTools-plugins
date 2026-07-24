<script setup lang="ts">
import { onMounted, ref, nextTick, shallowRef } from 'vue'
import ToolboxLayout from './toolbox/ToolboxLayout.vue'
import { categories, toolMap, type Tool } from './toolbox/tools'

const route = ref('')
const activeToolCode = ref('identity')
const currentTool = shallowRef<Tool | null>(null)
const isDev = ref(false)

function setRoute(action?: any) {
  const code = action?.code
  const tool = toolMap.get(code)
  if (tool) {
    route.value = 'toolbox'
    activeToolCode.value = tool.code
    currentTool.value = tool
  } else {
    route.value = 'toolbox'
    const first = categories[0].tools[0]
    activeToolCode.value = first.code
    currentTool.value = first
  }
}

function onSelectTool(code: string) {
  const tool = toolMap.get(code)
  if (tool) {
    activeToolCode.value = tool.code
    currentTool.value = tool
  }
}

onMounted(async () => {
  const ztools = (window as any).ztools

  if (!ztools) {
    isDev.value = true
    setRoute()
    return
  }

  ztools.setExpendHeight(600)

  ztools.onPluginEnter((action: any) => {
    setRoute(action)
  })

  ztools.onPluginOut(() => {
    route.value = ''
  })

  await nextTick()
  setTimeout(() => {
    if (!route.value) {
      try {
        const action = ztools.getLaunchAction?.()
        setRoute(action)
      } catch (e) {
        setRoute()
      }
    }
  }, 100)
})
</script>

<template>
  <!-- 工具箱模式 -->
  <ToolboxLayout
    v-if="route === 'toolbox'"
    :active-code="activeToolCode"
    @select="onSelectTool"
  >
    <component
      v-if="currentTool"
      :is="currentTool.component"
      :key="currentTool.code"
    />
  </ToolboxLayout>

  <!-- 开发模式提示 -->
  <div v-else-if="!route && isDev" class="dev-hint">
    <p>开发模式：请在 ZTools 中使用插件</p>
    <p>或者访问 <a href="/?code=identity" @click.prevent="setRoute()">/?code=identity</a> 测试</p>
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
.dev-hint a {
  color: #667eea;
}
</style>
