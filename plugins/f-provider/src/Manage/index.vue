<script setup lang="ts">
import { ref, computed, markRaw, watch, onMounted, nextTick } from 'vue'
import SettingLayout from '../components/SettingLayout.vue'
import type { NavItem } from '../components/SettingLayout.vue'
import Settings from '../views/Settings.vue'
import Recognize from '../views/Recognize.vue'
import Translate from '../views/Translate.vue'
import HistoryView from '../components/HistoryView.vue'
import { useNativeEngine } from '../composables/useNativeEngine'
import { useLatexEngine } from '../composables/useLatexEngine'
import { useHistory } from '../composables/useHistory'

/**
 * 管理主入口（唯一 feature，跨平台）：底部悬浮栏式布局。
 * 根据 onPluginEnter 入参（enterAction.type）自动切换 tab 并预填内容：
 *   - img / files：切到「OCR 识别」并自动用该图片跑对应模式识别
 *       - latex-recognize feature → 公式模式
 *       - 其它 → 文字模式
 *   - over（带文本 payload）：切到「翻译」并自动预填文本、触发翻译
 *   - text / 其它：保持「设置」tab
 *
 * 底部三个主按钮：
 *   - 设置：OCR 引擎 + 翻译服务（卡片式）
 *   - OCR 识别：文字识别 / 公式识别在同一页内顶部切换（不再分子项）
 *   - 翻译：单 provider 翻译器
 */

const props = defineProps<{
  /** 来自 onPluginEnter 的进入动作（每进入一次产生新引用触发 watch）。 */
  enterAction?: { code?: string; type?: string; payload?: any } | null
}>()

const { nativeVersion, checkNative } = useNativeEngine()
const { latexVersion, checkLatex } = useLatexEngine()
const { loadHistory, pushHistory } = useHistory()

/**
 * 接收子组件（Recognize / Translate）上抛的历史记录条目，
 * 补全 id / ts 后写入历史记录单例（同步至 dbStorage）。
 * 集中在 Manage 处理，子组件不直接依赖 dbStorage。
 */
function onHistory(item: HistoryEmitItem) {
  pushHistory(item)
}

/**
 * 识别并翻译联动：Recognize 文字识别成功后上抛识别文字，
 * 切到「翻译」tab 并预填原文、重建 Translate 实例触发一次翻译
 * （:key 含 enterSeq，重建后 initialText watcher 立即 run，即使文本相同也重跑）。
 */
function onOcrToTranslate(text: string) {
  if (!text) return
  initialText.value = text
  // 清空 ocrText：自动联动走重建实例 + initialText watch 预填，
  // 不再让下方 watch(activeKey) 二次 applyText（避免新实例就绪前后重复翻译）。
  ocrText.value = ''
  activeKey.value = 'translate'
  enterSeq.value++
}

/**
 * Recognize 文字识别成功后同步当前识别文本：供用户手动切到「翻译」tab 时带入。
 * 与 onOcrToTranslate（translateAfterOcr 自动联动、重建实例）不同：
 * 此处仅暂存文本，不切 tab、不重建，等用户手动切到翻译 tab 时由
 * watch(activeKey) 调用 Translate 实例的 applyText 预填（保留已有翻译结果）。
 */
const ocrText = ref('')
function onOcrTextResult(text: string) {
  ocrText.value = text
}

/**
 * Translate 组件实例引用：用于手动切 tab 时调用其 applyText 预填 OCR 文本。
 * .vue 的模块声明丢失 defineExpose 类型，故用本地接口约束可见方法。
 */
interface TranslateExposed {
  applyText: (text: string) => void
}
const translateRef = ref<TranslateExposed | null>(null)

const activeKey = ref('settings')

// 识别页当前模式（由 Recognize 上报）：公式模式下底部悬浮栏左对齐，
// 避免遮挡右下角的三个复制按钮。
const recognizeMode = ref<'text' | 'formula'>('text')

const dockAlign = computed<'center' | 'left'>(() =>
  activeKey.value === 'recognize' && recognizeMode.value === 'formula'
    ? 'left'
    : 'center'
)

function onRecognizeModeChange(mode: 'text' | 'formula') {
  recognizeMode.value = mode
}

// 传给「识别」/「翻译」的预填值。每次进入重置，配合 :key 重建组件，
// 保证「新建 tab、不复用上次状态」的语义。
const initialImage = ref('')
const initialText = ref('')
/** 识别页初始模式：latex-recognize / screen-latex 入口为 formula，其它为 text */
const initialMode = ref<'text' | 'formula'>('text')
/**
 * 进入即自动截屏（screen-ocr / screen-latex feature）。
 * 仅这两个截图入口置 true，交由 Recognize 在 onMounted / 引擎就绪后自动截图；
 * 截图结果留在主窗口内展示，不再弹独立窗口。
 */
const autoCapture = ref(false)
/**
 * 进入即识别完成并自动翻译（screen-ocr-translate / ocr-translate feature）。
 * 仅这两个「识别并翻译」入口置 true，由 Recognize 在文字识别成功后上抛 translate 事件，
 * 本容器接收后切到「翻译」tab 并预填识别文字、触发一次翻译。
 */
const autoTranslateAfterOcr = ref(false)
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
    label: 'OCR 识别',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE --><path fill="currentColor" d="M2 5v14h12v-2h-2c-1.11 0-2-.89-2-2V9c0-1.11.89-2 2-2h2V5m0 2v2h2V7m-2 2h-2v6h2m0 0v2h2v-2M5 7h2c1.11 0 2 .89 2 2v6c0 1.11-.89 2-2 2H5c-1.11 0-2-.89-2-2V9c0-1.11.89-2 2-2m12 0v10h2v-4h1v1h1v3h2v-3h-1v-2h1V8h-1V7M5 9v6h2V9m12 0h2v2h-2Z"/></svg>',
    component: markRaw(Recognize)
  },
  {
    key: 'translate',
    label: '翻译',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="m12 22l-1-3H4q-.825 0-1.412-.587Q2 17.825 2 17V4q0-.825.588-1.413Q3.175 2 4 2h6l.875 3H20q.875 0 1.438.562Q22 6.125 22 7v13q0 .825-.562 1.413Q20.875 22 20 22Zm-4.85-7.4q1.725 0 2.838-1.112Q11.1 12.375 11.1 10.6q0-.2-.012-.363q-.013-.162-.063-.337h-3.95v1.55H9.3q-.2.7-.763 1.087q-.562.388-1.362.388q-.975 0-1.675-.7c-.7-.7-.7-1.725 0-2.45c.7-.7 1.05-.7 1.675-.7q.45 0 .85.162q.4.163.725.488L9.975 7.55Q9.45 7 8.713 6.7q-.738-.3-1.563-.3q-1.675 0-2.862 1.187Q3.1 8.775 3.1 10.5q0 1.725 1.188 2.912Q5.475 14.6 7.15 14.6Zm6.7.5l.55-.525q-.35-.425-.637-.825q-.288-.4-.563-.85Zm1.25-1.275q.7-.825 1.063-1.575q.362-.75.487-1.175h-3.975l.3 1.05h1q.2.375.475.813q.275.437.65.887ZM13 21h7q.45 0 .725-.288Q21 20.425 21 20V7q0-.45-.275-.725Q20.45 6 20 6h-8.825l1.175 4.05h1.975V9h1.025v1.05H19v1.025h-1.275q-.25.95-.75 1.85q-.5.9-1.175 1.675l2.725 2.675L17.8 18l-2.7-2.7l-.9.925L15 19Z"/></svg>',
    component: markRaw(Translate)
  },
  {
    key: 'history',
    label: '历史记录',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.75 3.75L5.5 16L9 12H6a7 7 0 0 1 7-7a7 7 0 0 1 7 7a7 7 0 0 1-7 7c-1.93 0-3.68-.79-4.95-2.05l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18m2.5 11.25l-3.5-3.5V7h2v3.25l2.75 2.75z"/></svg>',
    component: markRaw(HistoryView)
  }
])

// 从 onPluginEnter 的 action 中提取图片源（img data URI 或 files 路径）。
function extractImage(action: any): string {
  if (!action) return ''
  if (action.type === 'img') return action.payload || ''
  if (action.type === 'files') return action.payload?.[0]?.path || ''
  return ''
}

// 根据 onPluginEnter 进入的 action.code/type 切换 tab 并预填内容。
// 每次进入递增 enterSeq，配合 <component :key> 重建对应子页，确保状态不残留。
//   - screen-ocr：切到「识别」+ 文字模式 + 进入即自动截屏
//   - screen-latex：切到「识别」+ 公式模式 + 进入即自动截屏
//   - latex-recognize + img/files：切到「识别」并自动进入公式模式跑 LaTeX 识别
//   - 其它 code + img/files：切到「识别」并自动进入文字模式跑微信 OCR
//   - over（带文本 payload）：切到「翻译」并自动预填文本、触发翻译
//   - text / 其它：保持「设置」tab
watch(
  () => props.enterAction,
  (action) => {
    if (!action) return
    // 每次进入先重置预填值（含 autoCapture），避免上次状态残留
    initialImage.value = ''
    initialText.value = ''
    initialMode.value = 'text'
    autoCapture.value = false
    autoTranslateAfterOcr.value = false
    ocrText.value = ''
    // 截图识别 feature：进入「OCR 识别」并自动触发截屏，结果留主窗口内展示
    if (action.code === 'screen-ocr' || action.code === 'screen-latex') {
      initialMode.value = action.code === 'screen-latex' ? 'formula' : 'text'
      activeKey.value = 'recognize'
      autoCapture.value = true
      enterSeq.value++
      return
    }
    // 截图识别并翻译 feature：进入「OCR 识别」+ 文字模式 + 自动截屏 + 识别完成自动翻译
    if (action.code === 'screen-ocr-translate') {
      initialMode.value = 'text'
      activeKey.value = 'recognize'
      autoCapture.value = true
      autoTranslateAfterOcr.value = true
      enterSeq.value++
      return
    }
    if (action.type === 'img' || action.type === 'files') {
      const img = extractImage(action)
      if (img) {
        // 模式判定：latex-recognize → 公式；ocr-translate → 文字 + 识别后翻译；其它 → 文字
        if (action.code === 'ocr-translate') {
          initialMode.value = 'text'
          autoTranslateAfterOcr.value = true
        } else {
          initialMode.value = action.code === 'latex-recognize' ? 'formula' : 'text'
        }
        activeKey.value = 'recognize'
        initialImage.value = img
        enterSeq.value++
        return
      }
    }
    if (action.type === 'over' && typeof action.payload === 'string' && action.payload.trim()) {
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

/**
 * 用户手动切到「翻译」tab 时，若当前有 OCR 识别结果，带入翻译输入框。
 * 走 translateRef.applyText 而非重建实例：保留翻译 tab 已有的译文/渠道等状态，
 * 仅预填原文并触发一次翻译（applyText 内已 suppress 自动翻译避免重复）。
 * 自动联动场景（translateAfterOcr）已在 onOcrToTranslate 中清空 ocrText 并重建实例，
 * 此处不会二次触发。
 */
watch(activeKey, (key) => {
  if (key !== 'translate') return
  if (!ocrText.value) return
  // 下一 tick 确保 keep-alive 缓存实例已激活、translateRef 已绑定
  nextTick(() => {
    translateRef.value?.applyText(ocrText.value)
  })
})

onMounted(() => {
  // 读取 plugin.json 中的 native / nativeLatex 版本号用于侧边栏展示
  checkNative()
  checkLatex()
  // 载入历史记录到单例 ref（供 HistoryView 读取）
  loadHistory()
})
</script>

<template>
  <SettingLayout
    v-model="activeKey"
    :items="items"
    :version="nativeVersion || latexVersion || undefined"
    :dock-align="dockAlign"
  >
  <!--
    Recognize / Translate 用 <KeepAlive> 缓存实例：底部悬浮栏切 tab 不再卸载，
    切回时图片、识别结果、译文等用户数据完整保留。Settings 不过 keep-alive，
    切走即卸载（设置页无用户输入，重 check 引擎状态即可）。
    :key 仍绑 enterSeq：仅当 onPluginEnter 重新进入（enterSeq++)时 key 改变，
    keep-alive 内 key 变更会销毁旧实例、挂载全新实例，确保新一轮预填生效、状态不残留。
    切 tab 不改 enterSeq，故 key 不变，缓存命中。
  -->
  <Settings v-if="activeKey === 'settings'" :key="'settings-' + enterSeq" />
  <KeepAlive>
    <Recognize
      v-if="activeKey === 'recognize'"
      :key="'recognize-' + enterSeq"
      :initial-image="initialImage"
      :initial-mode="initialMode"
      :auto-capture="autoCapture"
      :translate-after-ocr="autoTranslateAfterOcr"
      @mode-change="onRecognizeModeChange"
      @history="onHistory"
      @translate="onOcrToTranslate"
      @text-result="onOcrTextResult"
    />
  </KeepAlive>
  <KeepAlive>
    <Translate
      v-if="activeKey === 'translate'"
      ref="translateRef"
      :key="'translate-' + enterSeq"
      :initial-text="initialText"
      @history="onHistory"
    />
  </KeepAlive>
  <KeepAlive>
    <HistoryView
      v-if="activeKey === 'history'"
      :key="'history-' + enterSeq"
    />
  </KeepAlive>
  </SettingLayout>
</template>
