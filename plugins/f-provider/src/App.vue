<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GlobalFeedback from './components/GlobalFeedback.vue'
import Manage from './Manage/index.vue'
import CodeTranslate from './views/CodeTranslate.vue'
import ScreenOcr from './views/ScreenOcr.vue'

/**
 * 应用根：按 onPluginEnter 的 action.code 在三个 feature 间分流。
 *   - code === 'screen-ocr'：渲染全屏截图识别页（独立 feature，进入即自动截屏）
 *   - code === 'code-translate'：渲染全屏代码翻译候选列表（独立 feature）
 *   - 其它（含 manage）：渲染 Manage 容器，由其按 action.type 切 tab
 *
 * 每次进入产生新引用（enterAction），驱动下游 watch / 重建视图。
 */
const enterAction = ref<any>({})

/** 是否进入截图识别 feature。 */
const isScreenOcr = computed(() => enterAction.value?.code === 'screen-ocr')

/** 是否进入代码翻译 feature。 */
const isCodeTranslate = computed(() => enterAction.value?.code === 'code-translate')

/** 透传给 CodeTranslate 的初始文本（regex 入口选中的文本）。 */
const codeTranslateText = computed(() => {
  const a = enterAction.value
  return a && a.code === 'code-translate' && typeof a.payload === 'string' ? a.payload : ''
})

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    console.log(action)
    // 每次进入产生新引用，驱动下游 watch
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    // 隐藏/退出：保留 enterAction 以便恢复时仍有上下文
  })
})
</script>

<template>
  <!-- 全局反馈组件：ztools-ui 的 Toast / Confirm 需要 -->
  <GlobalFeedback />

  <!-- 截图识别 feature：进入即自动截屏→OCR。:key 保证每次进入重建实例、状态不残留 -->
  <ScreenOcr
    v-if="isScreenOcr"
    :key="'screen-ocr-' + (enterAction.code || '')"
  />
  <!-- 代码翻译 feature：全屏候选列表。:key 保证每次进入重建实例、状态不残留 -->
  <CodeTranslate
    v-else-if="isCodeTranslate"
    :key="'code-translate-' + (enterAction.code || '')"
    :initial-text="codeTranslateText"
  />
  <!-- 管理 feature：设置/识别/翻译/批量测试 -->
  <Manage v-else :enter-action="enterAction" />
</template>
