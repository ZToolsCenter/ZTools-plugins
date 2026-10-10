<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Calcu from './Calcu/index.vue'

interface PluginEnterAction {
  code: string
  inputState?: {
    pastedText?: string
  }
}

const enterAction = ref<PluginEnterAction>({
  code: ''
})

onMounted(() => {
  // 监听插件进入事件并同步入口参数
  window.ztools.onPluginEnter((action) => {
    enterAction.value = {
      code: action.code,
      inputState:
        action.payload && typeof action.payload === 'object' && 'inputState' in action.payload
          ? (action.payload as PluginEnterAction).inputState
          : undefined
    }
  })

  // 监听插件退出事件并清空入口参数
  window.ztools.onPluginOut(() => {
    enterAction.value = {
      code: ''
    }
  })
})
</script>

<template>
  <Calcu :enter-action="enterAction" />
</template>
