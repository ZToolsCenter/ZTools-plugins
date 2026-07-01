<script setup lang="ts">
import { ref, computed, markRaw, watch, onMounted } from 'vue'
import SettingLayout from '../components/SettingLayout.vue'
import type { NavItem } from '../components/SettingLayout.vue'
import Settings from '../views/Settings.vue'
import RecognizeTest from '../views/RecognizeTest.vue'
import Translate from '../views/Translate.vue'
import TranslateTest from '../views/TranslateTest.vue'
import { useNativeEngine } from '../composables/useNativeEngine'

/**
 * 管理主入口（唯一 feature，跨平台）：设置页式布局。
 * 根据 onPluginEnter 入参（enterAction.type）自动切换 tab 并预填内容：
 *   - img / files：切到「识别」并自动用该图片跑 OCR（展示原图预览）
 *   - regex（带文本 payload）：切到「翻译」并自动预填文本、触发翻译
 *   - text / 其它：保持「设置」tab
 *
 * 侧边栏导航：
 *   - 设置：OCR 引擎 + 翻译服务（卡片式）
 *   - OCR：识别（选图/拖拽/粘贴，画布绘图 + 透明文字层；Windows 下需要 native 引擎）
 *   - 翻译：单 provider 实用翻译器（原文/译文左右结构，可编辑原文，自动翻译）
 *   - 批量测试：四 provider 并发对比（保留供调试凭据）
 */

const props = defineProps<{
  /** 来自 onPluginEnter 的进入动作（每进入一次产生新引用触发 watch）。 */
  enterAction?: { code?: string; type?: string; payload?: any } | null
}>()

const { nativeVersion, checkNative } = useNativeEngine()

const activeKey = ref('settings')

// 传给「识别」/「翻译」的预填值。每次进入重置，配合 :key 重建组件，
// 保证「新建 tab、不复用上次状态」的语义。
const initialImage = ref('')
const initialText = ref('')
// 组件重建 key：每次进入递增，强制 <component> 卸载旧实例、挂载全新实例。
const enterSeq = ref(0)

const items = computed<NavItem[]>(() => [
  {
    key: 'settings',
    label: '设置',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="M10.825 22q-.675 0-1.162-.45t-.588-1.1L8.85 18.8q-.325-.125-.612-.3t-.563-.375l-1.55.65q-.625.275-1.25.05t-.975-.8l-1.175-2.05q-.35-.575-.2-1.225t.675-1.075l1.325-1Q4.5 12.5 4.5 12.337v-.675q0-.162.025-.337l-1.325-1Q2.675 9.9 2.525 9.25t.2-1.225L3.9 5.975q.35-.575.975-.8t1.25.05l1.55.65q.275-.2.575-.375t.6-.3l.225-1.65q.1-.65.588-1.1T10.825 2h2.35q.675 0 1.163.45t.587 1.1l.225 1.65q.325.125.613.3t.562.375l1.55-.65q.625-.275 1.25-.05t.975.8l1.175 2.05q.35.575.2 1.225t-.675 1.075l-1.325 1q.025.175.025.338v.674q0 .163-.05.338l1.325 1q.525.425.675 1.075t-.2 1.225l-1.2 2.05q-.35.575-.975.8t-1.25-.05l-1.5-.65q-.275.2-.575.375t-.6.3l-.225 1.65q-.1.65-.587 1.1t-1.163.45zm1.225-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5"/></svg>',
    component: markRaw(Settings)
  },
  {
    key: 'recognize',
    label: '识别',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE --><path fill="currentColor" d="M2 5v14h12v-2h-2c-1.11 0-2-.89-2-2V9c0-1.11.89-2 2-2h2V5m0 2v2h2V7m-2 2h-2v6h2m0 0v2h2v-2M5 7h2c1.11 0 2 .89 2 2v6c0 1.11-.89 2-2 2H5c-1.11 0-2-.89-2-2V9c0-1.11.89-2 2-2m12 0v10h2v-4h1v1h1v3h2v-3h-1v-2h1V8h-1V7M5 9v6h2V9m12 0h2v2h-2Z"/></svg>',
    component: markRaw(RecognizeTest)
  },
  {
    key: 'translate',
    label: '翻译',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="m12 22l-1-3H4q-.825 0-1.412-.587Q2 17.825 2 17V4q0-.825.588-1.413Q3.175 2 4 2h6l.875 3H20q.875 0 1.438.562Q22 6.125 22 7v13q0 .825-.562 1.413Q20.875 22 20 22Zm-4.85-7.4q1.725 0 2.838-1.112Q11.1 12.375 11.1 10.6q0-.2-.012-.363q-.013-.162-.063-.337h-3.95v1.55H9.3q-.2.7-.763 1.087q-.562.388-1.362.388q-.975 0-1.675-.7c-.7-.7-.7-1.725 0-2.45c.7-.7 1.05-.7 1.675-.7q.45 0 .85.162q.4.163.725.488L9.975 7.55Q9.45 7 8.713 6.7q-.738-.3-1.563-.3q-1.675 0-2.862 1.187Q3.1 8.775 3.1 10.5q0 1.725 1.188 2.912Q5.475 14.6 7.15 14.6Zm6.7.5l.55-.525q-.35-.425-.637-.825q-.288-.4-.563-.85Zm1.25-1.275q.7-.825 1.063-1.575q.362-.75.487-1.175h-3.975l.3 1.05h1q.2.375.475.813q.275.437.65.887ZM13 21h7q.45 0 .725-.288Q21 20.425 21 20V7q0-.45-.275-.725Q20.45 6 20 6h-8.825l1.175 4.05h1.975V9h1.025v1.05H19v1.025h-1.275q-.25.95-.75 1.85q-.5.9-1.175 1.675l2.725 2.675L17.8 18l-2.7-2.7l-.9.925L15 19Z"/></svg>',
    component: markRaw(Translate)
  },
  {
    key: 'translate-test',
    label: '批量测试',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="M5 21q-.425 0-.712-.288T4 20t.288-.712T5 19h6v-5.15l-4.8-5.05q-.35-.35-.525-.788T5.5 7.1q0-.5.175-.925T6.2 5.4q.35-.35.788-.525T7.9 4.7h8.2q.475 0 .913.175t.787.525q.35.35.525.788t.175.912q0 .475-.175.913t-.525.787L13 13.85V19h6q.425 0 .713.288T20 20t-.288.713T19 21zm0-13h14l1.3-1.4q.15-.15.213-.313t.062-.337t-.062-.337t-.213-.313q-.15-.15-.337-.225T18.5 5h-13q-.2 0-.387.075T4.775 5.3q-.15.15-.213.313t-.062.337t.063.338t.212.312z"/></svg>',
    component: markRaw(TranslateTest)
  }
])

// 从 onPluginEnter 的 action 中提取图片源（img data URI 或 files 路径）。
function extractImage(action: any): string {
  if (!action) return ''
  if (action.type === 'img') return action.payload || ''
  if (action.type === 'files') return action.payload?.[0]?.path || ''
  return ''
}

// 根据进入动作切换 tab 并预填内容。
// 每次进入递增 enterSeq，配合 <component :key> 重建对应子页，确保状态不残留。
watch(
  () => props.enterAction,
  (action) => {
    if (!action) return
    initialImage.value = ''
    initialText.value = ''
    if (action.type === 'img' || action.type === 'files') {
      const img = extractImage(action)
      if (img) {
        activeKey.value = 'recognize'
        initialImage.value = img
        enterSeq.value++
        return
      }
    }
    if (action.type === 'regex' && typeof action.payload === 'string' && action.payload.trim()) {
      activeKey.value = 'translate'
      initialText.value = action.payload
      enterSeq.value++
      return
    }
    // text / 无 payload：保持默认 settings tab，但仍重建以清空可能的历史状态
    activeKey.value = 'settings'
    enterSeq.value++
  },
  { immediate: true }
)

onMounted(() => {
  // 读取 plugin.json 中的 native 版本号用于侧边栏展示
  checkNative()
})
</script>

<template>
  <SettingLayout
    v-model="activeKey"
    :items="items"
    :version="nativeVersion || undefined"
  >
    <!--
      :key 绑定为「activeKey + enterSeq」：切换 tab 或重新进入插件都会重建组件，
      保证进入时预填的 initialImage / initialText 被全新实例消费、状态不残留。
    -->
    <Settings v-if="activeKey === 'settings'" :key="'settings-' + enterSeq" />
    <RecognizeTest
      v-else-if="activeKey === 'recognize'"
      :key="'recognize-' + enterSeq"
      :initial-image="initialImage"
    />
    <Translate
      v-else-if="activeKey === 'translate'"
      :key="'translate-' + enterSeq"
      :initial-text="initialText"
    />
    <TranslateTest v-else :key="'translate-test-' + enterSeq" />
  </SettingLayout>
</template>
