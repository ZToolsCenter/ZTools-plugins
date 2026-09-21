<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GlobalFeedback from './components/GlobalFeedback.vue'
import SnapHub from './views/SnapHub.vue'
import ImageTranslate from './views/ImageTranslate.vue'
import TextTranslate from './views/TextTranslate.vue'
import Settings from './views/Settings.vue'

/**
 * 三个截图入口，统一走 SnapHub：
 *   1. snap-translate → 贴图（可贴上 OCR / 翻译，弹简洁框）
 *   2. snap-ocr-only → OCR，主窗直接出文字
 *   3. snap-ocr-translate → OCR翻译，主窗左右两栏
 * 另：image-translate / text-translate / settings
 */
const enterAction = ref<any>({})
const enterSeq = ref(0)

const code = computed(() => enterAction.value?.code ?? '')

const isSnapHub = computed(() =>
  ['snap-translate', 'snap-ocr-only', 'snap-ocr-translate'].includes(code.value)
)

const autoAction = computed<'ocr-only' | 'ocr-translate' | ''>(() => {
  if (code.value === 'snap-ocr-only') return 'ocr-only'
  if (code.value === 'snap-ocr-translate') return 'ocr-translate'
  return ''
})

const imageSource = computed(() => {
  const a = enterAction.value
  if (!a || a.code !== 'image-translate') return ''
  if (a.type === 'img' && typeof a.payload === 'string') return a.payload
  if (a.type === 'files' && Array.isArray(a.payload) && a.payload[0]?.path) {
    return a.payload[0].path as string
  }
  return ''
})

const initialText = computed(() => {
  const a = enterAction.value
  return a && a.code === 'text-translate' && typeof a.payload === 'string' ? a.payload : ''
})

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    enterAction.value = action
    enterSeq.value++
  })
})
</script>

<template>
  <GlobalFeedback />

  <SnapHub
    v-if="isSnapHub"
    :key="'hub-' + enterSeq + '-' + (autoAction || 'pick')"
    :auto-action="autoAction"
  />
  <ImageTranslate
    v-else-if="code === 'image-translate'"
    :key="'image-' + enterSeq"
    :image-source="imageSource"
  />
  <TextTranslate
    v-else-if="code === 'text-translate'"
    :key="'text-' + enterSeq"
    :initial-text="initialText"
  />
  <Settings v-else-if="code === 'settings'" :key="'settings-' + enterSeq" />
  <div v-else class="idle-hint">等待进入插件…</div>
</template>

<style scoped>
.idle-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--z-text-color-secondary, #909399);
  font-size: 14px;
}

</style>
