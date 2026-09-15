<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ZButton, useToast, useColorScheme } from 'ztools-ui'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import OcrImageViewer from './OcrImageViewer.vue'
import { useSegmentIndicator } from '../composables/useSegmentIndicator'
import { useHistory } from '../composables/useHistory'

const { historyList, removeHistory } = useHistory()
const { success } = useToast()

// 响应式暗色标记：宿主切换主题时同步，用于避免 :global(html.dark) 在 scoped 下不生效。
const { isDark } = useColorScheme()

// ─── 子分类切换：OCR / 翻译 ──────────────────────────────────────────
type HistoryTab = 'ocr' | 'translate'
const historyMode = ref<HistoryTab>('ocr')

// 文字 / 公式两种 OCR 都归到「OCR」分类（缩略列表内部天然区分），「翻译」单独一类。
function matchesTab(item: HistoryItem, tab: HistoryTab): boolean {
  if (tab === 'ocr') return item.kind === 'ocr-text' || item.kind === 'ocr-formula'
  return item.kind === 'translate'
}

function switchTab(next: HistoryTab) {
  if (historyMode.value === next) return
  historyMode.value = next
  // 切换 tab 后自动选中第一条（若列表非空）
  const first = filteredList.value[0]
  activeId.value = first ? first.id : null
}

// 当前 tab 下的历史列表（historyList 本身是新→旧顺序，无需再 reverse）
const filteredList = computed(() =>
  historyList.value.filter((it) => matchesTab(it, historyMode.value))
)

const historyModeIndex = computed(() => (historyMode.value === 'ocr' ? 0 : 1))
const {
  containerRef: tabSwitchRef,
  setItemRef: setTabItemRef,
  pos: tabIndicator,
  noAnim: tabNoAnim
} = useSegmentIndicator(historyModeIndex)

// ─── 选中项 ─────────────────────────────────────────────────────────
const activeId = ref<string | null>(null)
const activeItem = computed(() =>
  historyList.value.find((it) => it.id === activeId.value) || null
)
/** 类型收敛后的当前 OCR 文字记录（仅 kind === 'ocr-text' 时有效）。 */
const activeOcrText = computed(
  () => (activeItem.value?.kind === 'ocr-text' ? activeItem.value : null) as
    | (HistoryItem & { kind: 'ocr-text'; payload: { kind: 'ocr-text'; imageSrc: string; lines: OcrLine[] } })
    | null
)
/** 类型收敛后的当前 OCR 公式记录。 */
const activeOcrFormula = computed(
  () => (activeItem.value?.kind === 'ocr-formula' ? activeItem.value : null) as
    | (HistoryItem & { kind: 'ocr-formula'; payload: { kind: 'ocr-formula'; imageSrc: string; latex: string } })
    | null
)
/** 类型收敛后的当前翻译记录。 */
const activeTranslate = computed(
  () => (activeItem.value?.kind === 'translate' ? activeItem.value : null) as
    | (HistoryItem & {
        kind: 'translate'
        payload: {
          kind: 'translate'
          source: string
          target: string
          from: string
          to: string
          provider: TranslateProviderName
        }
      })
    | null
)

// 自动选中第一条：挂载时、切换 tab 后若未选中则选第一条
watch(
  filteredList,
  (list) => {
    if (list.length && (!activeId.value || !list.some((it) => it.id === activeId.value))) {
      activeId.value = list[0].id
    } else if (list.length === 0) {
      activeId.value = null
    }
  },
  { immediate: true }
)

function selectRow(item: HistoryItem) {
  if (item.id !== activeId.value) activeId.value = item.id
}

// ─── 翻译缩略图：原文首字 + 背景色 ──────────────────────────────────
const TRANSLATE_COLORS = ['#1976d2', '#43a047', '#fb8c00', '#8e24aa']

function translateAvatarColor(source: string): string {
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  }
  return TRANSLATE_COLORS[hash % TRANSLATE_COLORS.length]
}

function translateAvatarText(source: string): string {
  const ch = source.trim().charAt(0)
  return ch || 'T'
}

// ─── 时间格式化 MM-DD HH:mm ──────────────────────────────────────────
function formatTs(ts: number): string {
  const d = new Date(ts)
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const DD = String(d.getDate()).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${MM}-${DD} ${HH}:${mm}`
}

// ─── 缩略图全屏预览（OCR 记录） ──────────────────────────────────────
// 为当前选中项挂载一个 OcrImageViewer 实例，点击缩略图时调其 expose 的 openFullscreen。
const viewerRef = ref<InstanceType<typeof OcrImageViewer> | null>(null)

/**
 * 点击缩略图：
 *   - OCR 记录：触发 OcrImageViewer 的全屏预览能力（通过 ref 调 openFullscreen）。
 *   - 翻译记录：等同于点击行其它区域，选中并展示右侧详情（缩略图不可全屏）。
 */
function onThumbClick(item: HistoryItem) {
  // 翻译记录无全屏预览，缩小为「选中行」语义
  selectRow(item)
  // OCR 记录：等下一帧 viewer 挂载到位再触发全屏（若尚未挂载）
  if (item.kind === 'ocr-text' || item.kind === 'ocr-formula') {
    selectRow(item)
    // 若当前查看的不是这条，先选中，下一帧再开全屏
    if (activeItem.value?.id !== item.id) {
      activeId.value = item.id
      nextTick(() => viewerRef.value?.openFullscreen())
    } else {
      viewerRef.value?.openFullscreen()
    }
  }
}

// ─── 详情面板：OCR 文字明细行复制 ──────────────────────────────────
// OcrImageViewer 通过 @copy 事件把文字上抛给父，这里用 toast 提示。
function onViewerCopy(text: string) {
  window.ztools.copyText(text)
  success('已复制该行')
}

// ─── 详情面板：LaTeX 渲染（公式记录） ────────────────────────────────
const latexHtml = computed(() => {
  const item = activeOcrFormula.value
  if (!item) return ''
  const val = item.payload.latex
  if (!val) return ''
  try {
    return katex.renderToString(val, {
      displayMode: true,
      throwOnError: false,
      output: 'html'
    })
  } catch (e: any) {
    return '<span class="katex-error">渲染失败：' + (e?.message || String(e)) + '</span>'
  }
})

function copyLatex(kind: 'raw' | 'inline' | 'display') {
  const item = activeOcrFormula.value
  if (!item) return
  const latex = item.payload.latex
  if (!latex) return
  let text = latex
  if (kind === 'inline') text = '$' + latex + '$'
  else if (kind === 'display') text = '$$' + latex + '$$'
  window.ztools.copyText(text)
  success(
    kind === 'raw'
      ? '已复制 LaTeX 源码'
      : kind === 'inline'
        ? '已复制 $…$ 形式'
        : '已复制 $$…$$ 形式'
  )
}

// ─── 翻译详情：语言 label 映射（本地定义，避免循环引用 Translate.vue）───
const LANG_LABELS: Record<string, string> = {
  auto: '自动检测',
  'zh-CN': '中文（简体）',
  'zh-TW': '中文（繁體）',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  es: '西班牙语',
  ru: '俄语',
  de: '德语',
  it: '意大利语',
  th: '泰语',
  vi: '越南语',
  ar: '阿拉伯语'
}

const PROVIDER_LABELS: Record<TranslateProviderName, string> = {
  baidu: '百度翻译',
  google: '谷歌翻译',
  youdao: '有道翻译',
  microsoft: '微软翻译',
  'ai-translation': 'AI 翻译'
}

function langLabel(code: string): string {
  return LANG_LABELS[code] || code
}

// 类型守卫式读取：在模板内直接 item.payload.source 无法通过类型收窄，
// 用此 helper 在列表 v-for 中拿到翻译记录的原文以便生成首字缩略图。
function translateSourceOf(item: HistoryItem): string {
  if (item.kind === 'translate') {
    return (item as HistoryItem & { payload: { kind: 'translate'; source: string } }).payload.source
  }
  return ''
}

/**
 * 删除一条历史记录。
 * 阻止冒泡避免触发选中行；删除后若当前选中项被移除，由 watch 自动补选第一条。
 */
function removeItem(id: string, e: MouseEvent) {
  e.stopPropagation()
  removeHistory(id)
}
</script>

<template>
  <div class="history-view">
    <!-- 主体：左右结构 -->
    <div class="stage">
      <!-- 左：分类切换 + 缩略列表 -->
      <div class="pane pane-list">
        <!-- 顶部 OCR / 翻译 切换条 -->
        <div
          class="mode-switch"
          :class="{ dark: isDark }"
          role="tablist"
          aria-label="历史记录分类"
          ref="tabSwitchRef"
        >
          <span
            class="mode-indicator"
            :class="{ 'no-anim': tabNoAnim }"
            :style="{
              transform: `translateX(${tabIndicator.x}px)`,
              width: tabIndicator.w ? `${tabIndicator.w}px` : '0px'
            }"
          ></span>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: historyMode === 'ocr' }"
            :aria-selected="historyMode === 'ocr'"
            :ref="(el) => setTabItemRef(el, 0)"
            @click="switchTab('ocr')"
          >
            OCR
          </button>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: historyMode === 'translate' }"
            :aria-selected="historyMode === 'translate'"
            :ref="(el) => setTabItemRef(el, 1)"
            @click="switchTab('translate')"
          >
            翻译
          </button>
        </div>

        <!-- 缩略列表 -->
        <div class="list-scroll">
          <div
            v-for="item in filteredList"
            :key="item.id"
            class="row"
            :class="{ active: item.id === activeId }"
            @click="selectRow(item)"
          >
            <!-- 缩略图：固定大小容器，contain -->
            <div class="thumb" @click.stop="onThumbClick(item)">
              <img
                v-if="item.kind === 'ocr-text' || item.kind === 'ocr-formula'"
                :src="item.thumbnail"
                :alt="item.title"
                class="thumb-img"
              />
              <div
                v-else-if="item.kind === 'translate'"
                class="thumb-translate"
                :style="{
                  background: translateAvatarColor(translateSourceOf(item))
                }"
              >
                {{ translateAvatarText(translateSourceOf(item)) }}
              </div>
            </div>

            <!-- 右侧：标题 + 时间 -->
            <div class="row-info">
              <div class="row-title">{{ item.title }}</div>
              <div class="row-time">{{ formatTs(item.ts) }}</div>
            </div>

            <!-- 删除按钮：悬浮行时展示 -->
            <button
              type="button"
              class="row-remove"
              :title="'删除该记录'"
              @click="removeItem(item.id, $event)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <!-- 空态 -->
          <div v-if="filteredList.length === 0" class="list-empty">
            {{ historyMode === 'ocr' ? '暂无 OCR 历史记录' : '暂无翻译历史记录' }}
          </div>
        </div>
      </div>

      <!-- 右：详情面板 -->
      <div class="pane pane-detail">
        <!-- 未选中时的空态 -->
        <div v-if="!activeItem" class="result-empty placeholder">
          选择左侧记录查看详情
        </div>

        <!-- ocr-text：仅展示识别明细列表（不展示原图，缩略图点击仍可全屏预览） -->
        <OcrImageViewer
          v-else-if="activeOcrText"
          ref="viewerRef"
          :image-src="activeOcrText.payload.imageSrc"
          :lines="activeOcrText.payload.lines"
          :hide-result="false"
          :hide-image="true"
          empty-text=""
          class="ocr-image-viewer"
          @copy="onViewerCopy"
        />

        <!-- ocr-formula：上下结构，KaTeX 预览 + LaTeX 源码 -->
        <div v-else-if="activeOcrFormula" class="formula-layout" :class="{ dark: isDark }">
          <!-- 上半：渲染预览 -->
          <div class="result-section formula-half">
            <div class="section-title">渲染预览</div>
            <div class="katex-preview" v-html="latexHtml"></div>
          </div>
          <!-- 下半：LaTeX 源码（只读） -->
          <div class="result-section formula-half">
            <div class="section-title">LaTeX 源码</div>
            <textarea
              class="latex-source"
              :value="activeOcrFormula.payload.latex"
              readonly
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
            ></textarea>
          </div>
          <div class="copy-actions">
            <ZButton @click="copyLatex('raw')">复制源码</ZButton>
            <ZButton @click="copyLatex('inline')">复制 $…$</ZButton>
            <ZButton @click="copyLatex('display')">复制 $$…$$</ZButton>
          </div>
        </div>

        <!-- translate：上下结构，原文 + 译文 -->
        <div v-else-if="activeTranslate" class="translate-layout">
          <!-- 顶部小头：provider + 语言方向 -->
          <div class="translate-meta">
            <span class="meta-provider">{{
              PROVIDER_LABELS[activeTranslate.payload.provider]
            }}</span>
            <span class="meta-lang">
              {{ langLabel(activeTranslate.payload.from) }}
              <span class="meta-arrow">→</span>
              {{ langLabel(activeTranslate.payload.to) }}
            </span>
          </div>

          <!-- 上半：原文 -->
          <div class="result-section translate-half">
            <div class="section-title">原文</div>
            <div class="tr-output-text readonly">{{ activeTranslate.payload.source }}</div>
          </div>

          <!-- 下半：译文 -->
          <div class="result-section translate-half">
            <div class="section-title">译文</div>
            <div class="tr-output-text readonly">{{ activeTranslate.payload.target }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.history-view {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100%;
}

/* ── 主体左右结构 ── */
.stage {
  flex: 1;
  display: flex;
  gap: 14px;
  min-height: 0;
  padding: 14px;
}

/* 左：分类切换 + 缩略列表 */
.pane-list {
  flex: 0 0 280px;
  width: 280px;
  min-width: 0;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

/* 模式切换条（复用 Recognize.vue 的 .mode-switch 样式结构） */
.mode-switch {
  position: relative;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--sub-bar-bg, rgba(0, 0, 0, 0.05));
  border-radius: 9px;
  flex-shrink: 0;
}

.mode-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: 7px;
  background: var(--sub-item-active-bg, #fff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  pointer-events: none;
  z-index: 0;
  transition:
    transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.mode-indicator.no-anim {
  transition: none;
}

/* scoped 下 :global 失效，改用 .dark 类驱动暗色高亮（不刺眼） */
.mode-switch.dark .mode-indicator {
  background: var(--sub-item-active-bg, rgba(255, 255, 255, 0.08));
  box-shadow: none;
}

.mode-btn {
  flex: 1;
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  position: relative;
  z-index: 1;
  transition: color 0.15s;
  white-space: nowrap;
}

.mode-btn.active {
  color: var(--primary-color, #1976d2);
  font-weight: 600;
}

/* 列表滚动区 */
.list-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* 始终让滚动区域占据剩余高度，哪怕只有一两条 */
  min-height: 0;
}

/* 每一行：缩略图 + 标题 + 时间 */
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 0.12s,
    border-color 0.12s;
}

.row:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.row.active {
  background: var(--active-bg, color-mix(in srgb, var(--primary-color, #1976d2) 8%, transparent));
  border-color: color-mix(in srgb, var(--primary-color, #1976d2), transparent 55%);
}

/* 缩略图：固定大小容器，contain */
.thumb {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
  /* 鼠标在缩略图上提示可点开全屏（OCR 记录） */
  cursor: pointer;
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* 翻译缩略图：圆形首字 + 背景色 */
.thumb-translate {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  user-select: none;
}

.row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 删除按钮：默认隐藏，悬浮行时显示 */
.row-remove {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s,
    color 0.15s,
    background 0.15s;
  padding: 0;
}

.row:hover .row-remove {
  opacity: 1;
}

.row-remove:hover {
  color: #fff;
  background: var(--primary-color, #1976d2);
}

.row-title {
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-color, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-time {
  font-size: 11px;
  color: var(--text-secondary, #999);
}

/* 列表空态 */
.list-empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #999);
}

/* 右：详情面板 */
.pane-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ocr-image-viewer ::v-deep(.empty) {
  display: none;
}
.ocr-image-viewer ::v-deep(.result-tip) {
  display: none;
}
.ocr-image-viewer ::v-deep(.result) {
  border-top: none;
  padding-top: 0;
}
/* 空态 */
.result-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary, #999);
  font-size: 14px;
  text-align: center;
}

.result-empty.placeholder {
  opacity: 0.7;
}

/* 公式详情：上下结构 */
.formula-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.formula-half {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  flex-shrink: 0;
}

.katex-preview {
  flex: 1 1 0;
  min-height: 0;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色渲染预览 */
.formula-layout.dark .katex-preview {
  background: #2a2a2a;
  border-color: var(--border-color, #374151);
  color: var(--text-color, #f3f4f6);
}

.katex-error {
  color: #e53935;
  font-size: 13px;
}

.latex-source {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 12px;
  background: var(--code-bg, #f5f5f5);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  color: var(--text-color, #333);
  outline: none;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色 LaTeX 源码框 */
.formula-layout.dark .latex-source {
  background: var(--code-bg, #2a2a2a);
  color: var(--text-color, #f3f4f6);
  border-color: var(--border-color, #374151);
}

.copy-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
  margin-bottom: 28px;
}

/* 翻译详情：上下结构 */
.translate-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding-bottom: 28px;
}

.translate-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.meta-provider {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.meta-lang {
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.meta-arrow {
  margin: 0 4px;
}

.translate-half {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tr-output-text {
  flex: 1 1 0;
  min-height: 0;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 10px;
  background: var(--card-bg, transparent);
  overflow-y: auto;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
  box-sizing: border-box;
}

/* 让 OcrImageViewer 内的 viewer 填满详情面板 */
.pane-detail > :deep(.viewer) {
  width: 100%;
  height: 100%;
}
</style>
