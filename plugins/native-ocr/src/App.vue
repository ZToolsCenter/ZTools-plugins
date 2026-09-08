<template>
  <main class="ocr-shell">
    <div class="engine-selector">
      <span class="engine-label">引擎</span>
      <div class="engine-tabs">
        <button
          v-for="tab in engineTabs"
          :key="tab.id"
          type="button"
          class="engine-tab"
          :class="{ active: engine === tab.id, pending: tab.pending }"
          :disabled="tab.disabled"
          :title="tab.title"
          @click="engine = tab.id"
        >{{ tab.label }}<span v-if="tab.badge" class="engine-tab-badge">{{ tab.badge }}</span></button>
      </div>
    </div>

    <section class="workbench">
      <section
        class="preview-pane"
        :class="{ dragging: isDragging }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
      >
        <div v-if="!previewSrc" class="empty-state">
          <div class="empty-icon">▧</div>
          <div class="empty-title">选择图片或截图</div>
          <div class="empty-subtitle">支持 png、jpg、webp、bmp、tiff</div>
        </div>
        <div v-else ref="stageRef" class="preview-stage" @wheel.prevent="onStageWheel" @dblclick="resetZoom">
          <div
            class="preview-transform"
            :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }"
          >
            <img class="preview-image" :src="previewSrc" alt="待识别图片" @pointerdown="beginPan">
            <div v-if="tableOverlayVisible" class="table-overlay interactive">
              <span
                v-for="(top, i) in tableRowLines"
                :key="`row-${i}`"
                class="overlay-line row-line"
                :style="{ top: `${top}%` }"
                title="拖动调整行分界 · 双击删除"
                @pointerdown.stop.prevent="beginSepDrag($event, 'row', i)"
                @dblclick.stop="removeSep('row', i)"
              ></span>
              <span
                v-for="(left, i) in tableColLines"
                :key="`col-${i}`"
                class="overlay-line col-line"
                :style="{ left: `${left}%` }"
                title="拖动调整列分界 · 双击删除"
                @pointerdown.stop.prevent="beginSepDrag($event, 'col', i)"
                @dblclick.stop="removeSep('col', i)"
              ></span>
            </div>
          </div>
        </div>
        <div v-if="batchActive" class="batch-panel">
          <div class="batch-head">
            <span class="batch-title">批量识别 · {{ batchItems.length }} 项</span>
            <span class="actions-spacer"></span>
            <button type="button" class="mini-button" :disabled="!batchMergedText" @click="copyBatchText">复制全部</button>
            <button type="button" class="mini-button" :disabled="!batchMergedText" @click="exportBatchTxt">导出 TXT</button>
            <button type="button" class="mini-button" :disabled="batchRunning" @click="closeBatch">关闭</button>
          </div>
          <ul class="batch-list">
            <li v-for="item in batchItems" :key="item.id" class="batch-item">
              <span class="batch-status" :class="item.status">{{ batchStatusLabel(item.status) }}</span>
              <span class="batch-name" :title="item.error || item.name">{{ item.name }}</span>
            </li>
          </ul>
        </div>
        <div v-if="runtimeOverlayVisible" class="runtime-mask">
          <span v-if="runtimeBusy" class="spinner"></span>
          <div class="runtime-title">{{ runtimeTitle }}</div>
          <div class="runtime-message">{{ runtimeMessage }}</div>
          <div v-if="runtimeProgressVisible" class="runtime-progress">
            <div class="runtime-progress-bar" :style="{ width: `${runtimeProgress.percent}%` }"></div>
          </div>
          <div v-if="runtimeProgressVisible" class="runtime-progress-text">{{ runtimeProgressText }}</div>
          <button
            v-if="runtimeCanDownload"
            type="button"
            class="runtime-download-button"
            @click="startRuntimeDownload"
          >
            {{ runtimeButtonText }}
          </button>
        </div>
        <div v-if="engine === 'rapidocr' && !onnxReady" class="runtime-mask">
          <span v-if="onnxDownloading" class="spinner"></span>
          <div class="runtime-title">{{ onnxDownloading ? '正在下载 ONNX OCR 引擎' : 'ONNX OCR 引擎未下载' }}</div>
          <div class="runtime-message">
            {{ onnxMessage || '内置 PP-OCR v4 引擎（约 60MB，一次性下载），无需 Python，双端通用，支持表格识别' }}
          </div>
          <button
            v-if="!onnxDownloading"
            type="button"
            class="runtime-download-button"
            @click="startOnnxDownload"
          >下载 ONNX OCR 引擎</button>
        </div>
        <div v-if="loading" class="busy-mask">
          <span class="spinner"></span>
          <span>{{ loadingMessage }}</span>
          <span v-if="isFirstRunLoading && engine === 'wechat'" class="loading-note">首次使用需要初始化 OCR 模型</span>
        </div>
      </section>

      <section class="result-pane">
        <div class="result-header">
          <div class="view-tabs">
            <button
              type="button"
              class="view-tab"
              :class="{ active: resultView === 'text' }"
              @click="setResultView('text')"
            >文本</button>
            <button
              type="button"
              class="view-tab"
              :class="{ active: resultView === 'table' }"
              :disabled="!tableAvailable"
              @click="setResultView('table')"
            >表格</button>
          </div>

          <label
            class="toggle table-toggle"
            :class="{ 'is-disabled': !tableCapable }"
            :title="tableCapable ? '' : '表格识别需系统 OCR 或 ONNX OCR 引擎'"
            @click="onTableModeToggle"
          >
            <input v-model="tableMode" type="checkbox" :disabled="!tableCapable">
            <span class="switch"></span>
            <span>识别为表格</span>
          </label>

          <div class="result-actions">
            <select v-model="translateTarget" class="lang-select" title="翻译目标语言">
              <option value="">自动目标语言</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="ru">Русский</option>
            </select>
            <button
              type="button"
              class="mini-button"
              :disabled="translating || (!rawResultText && !translatedText)"
              @click="toggleTranslate"
            >{{ translating ? '翻译中' : translationActive ? '原文' : '翻译' }}</button>
            <div class="history-wrap">
              <button
                type="button"
                class="mini-button"
                :class="{ active: historyOpen }"
                @click="historyOpen = !historyOpen"
              >
                <span>历史</span>
                <span v-if="history.length" class="history-badge">{{ history.length }}</span>
              </button>
              <transition name="history">
                <div v-if="historyOpen" class="history-panel">
                  <div class="history-head">
                    <span class="history-title">识别历史</span>
                    <button
                      type="button"
                      class="mini-button danger"
                      :disabled="!history.length"
                      @click="clearHistory"
                    >清空历史</button>
                  </div>
                  <div v-if="!history.length" class="history-empty">暂无识别历史</div>
                  <ul v-else class="history-list">
                    <li
                      v-for="item in history"
                      :key="item.id"
                      class="history-item"
                      @click="applyHistoryItem(item)"
                    >
                      <div class="history-item-main">
                        <div class="history-item-meta">
                          <span class="history-engine">{{ engineLabel(item.engine) }}</span>
                          <span class="history-time">{{ formatHistoryTime(item.ts) }}</span>
                        </div>
                        <div class="history-item-text">{{ item.text }}</div>
                      </div>
                      <button
                        type="button"
                        class="history-delete"
                        title="删除"
                        @click.stop="deleteHistoryItem(item.id)"
                      >×</button>
                    </li>
                  </ul>
                </div>
              </transition>
            </div>
          </div>
        </div>

        <textarea
          v-if="resultView === 'text'"
          v-model="displayText"
          :readonly="translationActive"
          :class="{ 'translation-view': translationActive }"
          spellcheck="false"
          :placeholder="translationActive ? '翻译结果' : '识别结果会显示在这里'"
        ></textarea>

        <div v-else class="table-view">
          <div v-if="tableAvailable" class="table-actions">
            <div class="table-actions-row">
              <button type="button" class="mini-button" @click="copyTable">复制表格</button>
              <button type="button" class="mini-button" @click="exportCsv">导出 CSV</button>
              <button type="button" class="mini-button" @click="exportXlsx">导出 Excel</button>
              <span v-if="tableDims" class="table-dims">{{ tableDims }}</span>
              <span class="actions-spacer"></span>
              <button type="button" class="mini-button" title="在最大空隙处插入一条行分界线" @click="addSep('row')">+ 行线</button>
              <button type="button" class="mini-button" title="在最大空隙处插入一条列分界线" @click="addSep('col')">+ 列线</button>
              <button v-if="manualSepsActive" type="button" class="mini-button" title="恢复自动聚类结果" @click="resetSeps">重置</button>
            </div>
            <div class="table-actions-row cluster-row">
              <span class="cluster-slider-label">阈值</span>
              <input
                v-model.number="clusterFactor"
                class="cluster-range"
                type="range"
                min="0.2"
                max="1.5"
                step="0.05"
                title="拖动调整行列聚类阈值，实时重算表格（会覆盖手动分隔线）"
              >
              <span class="cluster-slider-value">{{ clusterFactor.toFixed(2) }}×</span>
            </div>
          </div>
          <div v-if="tableAvailable" class="table-scroll">
            <table class="table-preview-table">
              <tbody>
                <tr v-for="(row, r) in tableGrid.grid" :key="`trow-${r}`">
                  <td
                    v-for="(cell, c) in row"
                    :key="`tcell-${r}-${c}`"
                    :class="{ filled: cell, low: tableGrid.lowCells.has(`${r}-${c}`) }"
                  ><div
                    class="cell-edit"
                    contenteditable="true"
                    spellcheck="false"
                    @blur="onCellEdit($event, r, c)"
                  >{{ cell }}</div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="table-empty">暂无表格数据，请使用系统 OCR 或 ONNX OCR 引擎并开启「识别为表格」后重新识别</div>
        </div>
      </section>
    </section>

    <footer class="toolbar">
      <div class="left-actions">
        <button type="button" class="tool-button" :disabled="loading || !readyToRecognize" @click="selectImage">
          <span class="icon">▧</span>
          <span>选择图片</span>
        </button>
        <button type="button" class="tool-button" :disabled="loading || !readyToRecognize" @click="captureScreen">
          <span class="icon">⌗</span>
          <span>屏幕截图</span>
        </button>
      </div>

      <label class="toggle">
        <input v-model="stripNewlines" type="checkbox">
        <span class="switch"></span>
        <span>智能断行</span>
      </label>

      <div class="right-actions">
        <button type="button" class="tool-button" :disabled="loading || !hasContent" @click="clearAll">
          <span class="icon">×</span>
          <span>清空</span>
        </button>
        <button type="button" class="copy-button" :disabled="loading || !displayText" @click="copyResult">
          <span class="copy-icon">⧉</span>
          <span>复制结果</span>
        </button>
        <button type="button" class="copy-button" :disabled="loading || !displayText" @click="copyAndClose">
          <span class="copy-icon">⧉</span>
          <span>复制并关闭</span>
        </button>
      </div>
    </footer>

    <input ref="fileInput" class="file-input" type="file" multiple accept="image/*,application/pdf" @change="onFileSelected">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as XLSX from 'xlsx'
import {
  buildGrid,
  clusterTable,
  extractCells,
  LOW_CONFIDENCE_THRESHOLD
} from './lib/tableModel.js'

const OCR_IMAGE_STORAGE_KEY = 'native_ocr_image'
const OCR_IMAGE_EVENT = 'native-ocr-image'
const OCR_CAPTURE_CODE = 'native-ocr-capture'
const HISTORY_KEY = 'native_ocr_history'
const HISTORY_LIMIT = 50
const HISTORY_TEXT_LIMIT = 5000

const fileInput = ref(null)
const previewSrc = ref('')
const rawResultText = ref('')
const loading = ref(false)
const loadingMessage = ref('识别中')
const isFirstRunLoading = ref(false)
const stripNewlines = ref(false)
const isDragging = ref(false)
const toastMessage = ref('')
const runtimeStatus = ref('checking')
const runtimeMessage = ref('正在检查 OCR 运行时')
const runtimeVersion = ref('')
const runtimeLatestVersion = ref('')
const runtimeProgress = ref({
  phase: '',
  percent: 0,
  downloaded: 0,
  total: 0
})
const engine = ref(localStorage.getItem('native_ocr_engine') || 'wechat')
const lastRecognizedSource = ref('')
const visionAvailable = ref(false)
const onnxReady = ref(false)
const onnxDownloading = ref(false)
const onnxMessage = ref('')
const lastResult = ref(null)
const resultView = ref('text')
const tableMode = ref(false)
const translatedText = ref('')
const translatedCells = ref({})
const translationActive = ref(false)
const translating = ref(false)
const translateTarget = ref(localStorage.getItem('native_ocr_translate_target') || '')
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const batchItems = ref([])
const batchRunning = ref(false)
let panState = null
let pdfjsPromise = null
const clusterFactor = ref(Number(localStorage.getItem('native_ocr_cluster_factor')) || 0.6)
const history = ref(loadHistory())
const historyOpen = ref(false)

let toastTimer = 0
let lastSource = ''
let hasRecognizedOnce = false
let pendingRecognition = null

const hasContent = computed(() => Boolean(previewSrc.value || rawResultText.value))
const runtimeReady = computed(() => runtimeStatus.value === 'ready')
const isMacPlatform = (window.nativeOcr?.getPlatform?.() || 'darwin') === 'darwin'
const wechatReady = computed(() => runtimeReady.value)
const wechatSupported = computed(() => runtimeStatus.value !== 'unsupported')
// 引擎页签排序：Windows 上 ONNX OCR（识别率最优）排第一；
// macOS 保持 macOS Vision → ONNX OCR → 微信 OCR。
const engineTabs = computed(() => {
  const onnxTab = {
    id: 'rapidocr',
    label: 'ONNX OCR',
    pending: !onnxReady.value,
    disabled: false,
    badge: onnxReady.value ? '' : '未下载',
    title: onnxReady.value ? '内置 ONNX 引擎（PP-OCR v4），支持表格识别' : '点击下载内置 ONNX 引擎（无需 Python）'
  }
  const visionTab = isMacPlatform
    ? {
        id: 'vision', label: 'macOS Vision', pending: false,
        disabled: !visionAvailable.value, badge: '',
        title: visionAvailable.value ? '' : '需要 macOS 及 swift 命令'
      }
    : {
        id: 'vision', label: 'Windows OCR', pending: false,
        disabled: !visionAvailable.value, badge: '',
        title: visionAvailable.value ? '' : '需要 Windows 10 及 PowerShell'
      }
  if (!isMacPlatform) {
    return [onnxTab, visionTab]
  }
  const wechatTab = {
    id: 'wechat', label: '微信 OCR',
    pending: !runtimeReady.value, disabled: false,
    badge: wechatReady.value ? '' : '未装',
    title: runtimeReady.value ? '调用微信自带离线 OCR' : '需要下载微信 OCR 运行时'
  }
  return [visionTab, onnxTab, wechatTab]
})
const readyToRecognize = computed(() => {
  if (engine.value === 'vision') return visionAvailable.value
  if (engine.value === 'rapidocr') return onnxReady.value
  return wechatReady.value
})
const runtimeBusy = computed(() => ['checking', 'downloading', 'extracting'].includes(runtimeStatus.value))
const runtimeCanDownload = computed(() => ['missing', 'outdated', 'error'].includes(runtimeStatus.value))
const runtimeOverlayVisible = computed(() => engine.value === 'wechat' && isMacPlatform && !runtimeReady.value)
const runtimeProgressVisible = computed(() => ['downloading', 'extracting'].includes(runtimeStatus.value))
const tableCapable = computed(() => {
  if (engine.value === 'vision') return visionAvailable.value
  if (engine.value === 'rapidocr') return onnxReady.value
  return false
})

const stageRef = ref(null)
const manualRowSeps = ref(null)
const manualColSeps = ref(null)
const cellEdits = ref({})
let sepDragState = null

const autoClusters = computed(() => {
  if (!tableMode.value || !tableCapable.value) return null
  const lines = (lastResult.value && lastResult.value.lines) || []
  if (!Array.isArray(lines) || !lines.some((line) => line && line.box)) return null
  return clusterTable(lines, clusterFactor.value)
})

function sepsFromCenters(clusters, key) {
  const seps = []
  for (let i = 0; i < clusters.length - 1; i += 1) {
    seps.push((clusters[i][key] + clusters[i + 1][key]) / 2)
  }
  return seps.sort((a, b) => a - b)
}

const rowSeps = computed(() => {
  if (Array.isArray(manualRowSeps.value)) return [...manualRowSeps.value].sort((a, b) => a - b)
  const clusters = autoClusters.value && autoClusters.value.rowClusters
  return clusters ? sepsFromCenters(clusters, 'cy') : []
})

const colSeps = computed(() => {
  if (Array.isArray(manualColSeps.value)) return [...manualColSeps.value].sort((a, b) => a - b)
  const clusters = autoClusters.value && autoClusters.value.colClusters
  return clusters ? sepsFromCenters(clusters, 'cx') : []
})

const manualSepsActive = computed(() => Array.isArray(manualRowSeps.value) || Array.isArray(manualColSeps.value))

const tableGrid = computed(() => {
  if (!tableMode.value || !tableCapable.value) return null
  const lines = (lastResult.value && lastResult.value.lines) || []
  if (!Array.isArray(lines) || !lines.some((line) => line && line.box)) return null
  const cells = extractCells(lines)
  if (!cells.length) return null
  const overrides = translationActive.value && Object.keys(translatedCells.value).length
    ? translatedCells.value
    : cellEdits.value
  return buildGrid(cells, rowSeps.value, colSeps.value, overrides)
})

const tableAvailable = computed(() => Boolean(tableGrid.value))
const tableDims = computed(() => {
  const grid = tableGrid.value && tableGrid.value.grid
  if (!grid || !grid.length) return ''
  return `${grid.length} 行 × ${grid[0].length} 列`
})
const tableRowLines = computed(() => rowSeps.value.map((y) => Math.round((1 - y) * 1000) / 10))
const tableColLines = computed(() => colSeps.value.map((x) => Math.round(x * 1000) / 10))
const tableOverlayVisible = computed(() => tableAvailable.value && resultView.value === 'table')
const runtimeTitle = computed(() => {
  if (runtimeStatus.value === 'checking') return '检查 OCR 运行时'
  if (runtimeStatus.value === 'downloading') return '下载 OCR 运行时'
  if (runtimeStatus.value === 'extracting') return '安装 OCR 运行时'
  if (runtimeStatus.value === 'outdated') return '更新 OCR 运行时'
  if (runtimeStatus.value === 'error') return 'OCR 运行时不可用'
  return '下载 OCR 运行时'
})
const runtimeButtonText = computed(() => runtimeStatus.value === 'outdated' ? '下载更新' : '下载 OCR 运行时')
const runtimeProgressText = computed(() => {
  const percent = Math.max(0, Math.min(100, runtimeProgress.value.percent || 0))
  if (runtimeStatus.value === 'extracting') return `正在解包 ${percent}%`
  const total = runtimeProgress.value.total
  const downloaded = runtimeProgress.value.downloaded
  if (total) return `${formatBytes(downloaded)} / ${formatBytes(total)} · ${percent}%`
  return percent ? `${percent}%` : '正在下载'
})

function stripLineBreaks(text) {
  return String(text || '').replace(/\s*\r?\n\s*/g, '')
}

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/

function joinGap(head, tail) {
  const lastChar = head.slice(-1)
  const firstChar = tail.slice(0, 1)
  if (CJK_CHAR_RE.test(lastChar) || CJK_CHAR_RE.test(firstChar)) return ''
  if (/[-–—/\\((（]$/.test(head) || /^[).，、。！？;；]/.test(tail)) return ''
  if (/[A-Za-z0-9]$/.test(head) && /^[A-Za-z0-9(]/.test(tail)) return ' '
  return ''
}

function smartJoin(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const paragraphs = []
  let buffer = ''
  for (const line of lines) {
    if (!buffer) {
      buffer = line
    } else {
      buffer += joinGap(buffer, line) + line
    }
    if (/[。！？!?…；;]$/.test(line)) {
      paragraphs.push(buffer)
      buffer = ''
    }
  }
  if (buffer) paragraphs.push(buffer)
  return paragraphs.join('\n')
}

const displayText = computed({
  get() {
    if (translationActive.value) return translatedText.value
    return stripNewlines.value ? smartJoin(rawResultText.value) : rawResultText.value
  },
  set(value) {
    if (translationActive.value) return
    rawResultText.value = stripNewlines.value ? stripLineBreaks(value) : value
  }
})

function showToast(message) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 1800)
}

function formatError(error) {
  return error && error.message ? error.message : String(error || '操作失败')
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function gridToTsv(grid) {
  return grid.map((row) => row.map((cell) => cell || '').join('\t')).join('\n')
}

function csvEscape(value) {
  const text = String(value == null ? '' : value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function gridToCsv(grid) {
  return grid.map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\n')
}

function isValidHistoryItem(item) {
  return Boolean(
    item
    && typeof item.id === 'string'
    && typeof item.text === 'string'
    && (item.engine === 'wechat' || item.engine === 'vision' || item.engine === 'rapidocr')
    && Number.isFinite(Number(item.ts))
  )
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidHistoryItem).slice(0, HISTORY_LIMIT)
  } catch (_) {
    return []
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch (_) {
    // Ignore storage failures.
  }
}

function pushHistory(text, engineName) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return
  const stored = trimmed.length > HISTORY_TEXT_LIMIT ? trimmed.slice(0, HISTORY_TEXT_LIMIT) : trimmed
  const latest = history.value[0]
  if (latest && latest.text === stored) return
  history.value.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    engine: engineName === 'vision' || engineName === 'rapidocr' ? engineName : 'wechat',
    text: stored,
    ts: Date.now()
  })
  if (history.value.length > HISTORY_LIMIT) {
    history.value = history.value.slice(0, HISTORY_LIMIT)
  }
  persistHistory()
}

function engineLabel(engineName) {
  if (engineName === 'vision') return '系统 OCR'
  if (engineName === 'rapidocr') return 'ONNX OCR'
  return '微信 OCR'
}

function formatHistoryTime(ts) {
  const date = new Date(Number(ts) || 0)
  if (!date.getTime()) return ''
  const pad = (value) => String(value).padStart(2, '0')
  const today = new Date()
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function clearHistory() {
  history.value = []
  persistHistory()
}

function deleteHistoryItem(id) {
  history.value = history.value.filter((item) => item.id !== id)
  persistHistory()
}

function applyHistoryItem(item) {
  if (!item || typeof item.text !== 'string') return
  rawResultText.value = item.text
  lastResult.value = null
  translationActive.value = false
  translatedText.value = ''
  translatedCells.value = {}
  resultView.value = 'text'
  historyOpen.value = false
  showToast('已回填历史记录')
}

async function toggleTranslate() {
  if (translationActive.value) {
    translationActive.value = false
    return
  }
  if (!window.nativeOcr?.translateText) {
    showToast('当前环境不支持翻译')
    return
  }
  const toLang = translateTarget.value || (/[\u4e00-\u9fff]/.test(rawResultText.value) ? 'en' : 'zh')
  if (resultView.value === 'table' && tableGrid.value) {
    await translateTableView(toLang)
    return
  }
  const text = rawResultText.value
  if (!text) {
    showToast('没有可翻译的内容')
    return
  }
  translating.value = true
  try {
    const result = await window.nativeOcr.translateText(text, toLang)
    translatedText.value = result?.text || ''
    translationActive.value = true
    showToast(`已翻译为 ${toLang}`)
  } catch (error) {
    showToast(`翻译失败：${formatError(error)}`)
  } finally {
    translating.value = false
  }
}

async function translateTableView(toLang) {
  const grid = tableGrid.value.grid
  const keys = []
  const segments = []
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const text = String(grid[r][c] || '').trim()
      if (!text) continue
      keys.push(`${r}-${c}`)
      segments.push(text)
    }
  }
  if (!segments.length) {
    showToast('表格中没有可翻译的内容')
    return
  }
  translating.value = true
  try {
    const translated = await window.nativeOcr.translateSegments(segments, toLang)
    const map = {}
    keys.forEach((key, index) => { map[key] = String(translated[index] ?? '') })
    translatedCells.value = map
    translationActive.value = true
    showToast(`表格已翻译为 ${toLang}`)
  } catch (error) {
    showToast(`翻译失败：${formatError(error)}`)
  } finally {
    translating.value = false
  }
}

function onTableModeToggle() {
  if (!tableCapable.value) {
    showToast('表格识别需系统 OCR 或 ONNX OCR 引擎')
  }
}

function beginSepDrag(event, type, index) {
  if (!tableAvailable.value) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  if (!rect.height || !rect.width) return
  sepDragState = { type, index, rect }
  window.addEventListener('pointermove', onSepDragMove)
  window.addEventListener('pointerup', endSepDrag, { once: true })
  onSepDragMove(event)
}

function onSepDragMove(event) {
  if (!sepDragState) return
  const { type, index, rect } = sepDragState
  const margin = 0.008
  const seps = [...(type === 'row' ? rowSeps.value : colSeps.value)]
  if (index < 0 || index >= seps.length) return
  const raw = type === 'row'
    ? 1 - ((event.clientY - rect.top - panY.value) / zoom.value) / rect.height
    : ((event.clientX - rect.left - panX.value) / zoom.value) / rect.width
  const min = (index > 0 ? seps[index - 1] : 0) + margin
  const max = (index < seps.length - 1 ? seps[index + 1] : 1) - margin
  if (max <= min) return
  seps[index] = Math.min(max, Math.max(min, raw))
  if (type === 'row') manualRowSeps.value = seps
  else manualColSeps.value = seps
}

function endSepDrag() {
  sepDragState = null
  window.removeEventListener('pointermove', onSepDragMove)
}

function removeSep(type, index) {
  const seps = [...(type === 'row' ? rowSeps.value : colSeps.value)]
  if (index < 0 || index >= seps.length) return
  seps.splice(index, 1)
  if (type === 'row') manualRowSeps.value = seps
  else manualColSeps.value = seps
}

function addSep(type) {
  const seps = [...(type === 'row' ? rowSeps.value : colSeps.value)]
  const bounds = [0, ...seps, 1]
  let bestGap = -1
  let bestPos = 0.5
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const gap = bounds[i + 1] - bounds[i]
    if (gap > bestGap) {
      bestGap = gap
      bestPos = (bounds[i] + bounds[i + 1]) / 2
    }
  }
  if (bestGap <= 0.02) {
    showToast('没有可插入的空间')
    return
  }
  const next = [...seps, bestPos].sort((a, b) => a - b)
  if (type === 'row') manualRowSeps.value = next
  else manualColSeps.value = next
}

function resetSeps() {
  manualRowSeps.value = null
  manualColSeps.value = null
  cellEdits.value = {}
}

function onCellEdit(event, r, c) {
  const text = String(event.target.textContent || '').replace(/\n+$/g, '')
  cellEdits.value = { ...cellEdits.value, [`${r}-${c}`]: text }
}

// ---------------------------------------------------------------------------
// 图片缩放 / 平移
// ---------------------------------------------------------------------------

function onStageWheel(event) {
  if (!previewSrc.value) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const pointerX = event.clientX - rect.left
  const pointerY = event.clientY - rect.top
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.min(8, Math.max(1, zoom.value * factor))
  if (next === zoom.value) return
  const ratio = next / zoom.value
  panX.value = pointerX - (pointerX - panX.value) * ratio
  panY.value = pointerY - (pointerY - panY.value) * ratio
  zoom.value = next
  if (zoom.value === 1) {
    panX.value = 0
    panY.value = 0
  }
}

function resetZoom() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

function beginPan(event) {
  if (zoom.value <= 1) return
  panState = {
    pointerX: event.clientX - panX.value,
    pointerY: event.clientY - panY.value
  }
  window.addEventListener('pointermove', onPanMove)
  window.addEventListener('pointerup', endPan, { once: true })
}

function onPanMove(event) {
  if (!panState) return
  panX.value = event.clientX - panState.pointerX
  panY.value = event.clientY - panState.pointerY
}

function endPan() {
  panState = null
  window.removeEventListener('pointermove', onPanMove)
}

// ---------------------------------------------------------------------------
// 全局快捷键
// ---------------------------------------------------------------------------

function onGlobalKeydown(event) {
  const meta = event.metaKey || event.ctrlKey
  if (meta && event.key === 'Enter') {
    if (displayText.value) {
      event.preventDefault()
      copyAndClose()
    }
    return
  }
  if (meta && (event.key === 'c' || event.key === 'C')) {
    if (String(window.getSelection?.() || '')) return
    if (displayText.value) {
      event.preventDefault()
      copyTextValue(displayText.value)
    }
    return
  }
  if (event.key === 'Escape') {
    const active = document.activeElement
    if (active && (active.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(active.tagName))) {
      active.blur?.()
      return
    }
    closePluginWindow()
  }
}

watch(tableMode, (val) => {
  if (val) {
    if (tableAvailable.value) resultView.value = 'table'
  } else {
    resultView.value = 'text'
  }
})

watch(clusterFactor, (val) => {
  localStorage.setItem('native_ocr_cluster_factor', String(val))
  manualRowSeps.value = null
  manualColSeps.value = null
  cellEdits.value = {}
})

watch(lastResult, () => {
  manualRowSeps.value = null
  manualColSeps.value = null
  cellEdits.value = {}
  translationActive.value = false
  translatedText.value = ''
})

watch([manualRowSeps, manualColSeps], () => {
  cellEdits.value = {}
})

function setResultView(view) {
  if (view === 'table' && !tableAvailable.value) {
    showToast('暂无表格数据')
    return
  }
  resultView.value = view
}

async function copyTextValue(text) {
  const value = String(text || '')
  if (!value) {
    showToast('没有可复制的内容')
    return false
  }
  try {
    if (window.ztools?.copyText) {
      window.ztools.copyText(value)
    } else if (window.nativeOcr?.copyText) {
      window.nativeOcr.copyText(value)
    } else {
      await navigator.clipboard.writeText(value)
    }
    showToast('已复制')
    return true
  } catch (_) {
    showToast('复制失败')
    return false
  }
}

async function copyResult() {
  const text = displayText.value
  if (!text) {
    showToast('没有可复制的结果')
    return
  }
  await copyTextValue(text)
}

function closePluginWindow() {
  try {
    if (window.ztools?.hidePlugin) {
      window.ztools.hidePlugin()
      return true
    }
    if (window.ztools?.outPlugin) {
      window.ztools.outPlugin()
      return true
    }
  } catch (_) {
    // Fall through to the failure toast below.
  }
  showToast('当前环境不支持关闭插件')
  return false
}

async function copyAndClose() {
  const text = displayText.value
  if (!text) {
    showToast('没有可复制的结果')
    return
  }
  const copied = await copyTextValue(text)
  if (copied) closePluginWindow()
}

async function startOnnxDownload() {
  if (!window.nativeOcr?.installOnnxRuntime) {
    showToast('当前环境不支持下载 ONNX OCR 引擎')
    return
  }
  onnxDownloading.value = true
  onnxMessage.value = '正在获取引擎包'
  try {
    await window.nativeOcr.installOnnxRuntime((progress = {}) => {
      const percent = Number(progress.percent || 0)
      onnxMessage.value = `${progress.message || '下载中'} ${percent}%`
    })
    onnxReady.value = await window.nativeOcr.isOnnxOcrAvailable?.() || false
    if (onnxReady.value) {
      onnxMessage.value = ''
      showToast('ONNX OCR 引擎已就绪')
    } else {
      onnxMessage.value = '下载流程已结束，但引擎校验未通过，请重试'
      showToast('ONNX OCR 引擎下载未完成')
    }
  } catch (error) {
    onnxMessage.value = `下载失败：${formatError(error)}`
    showToast('ONNX OCR 引擎下载失败')
  } finally {
    onnxDownloading.value = false
  }
}

async function copyTable() {
  if (!tableGrid.value) {
    showToast('暂无表格可复制')
    return
  }
  await copyTextValue(gridToTsv(tableGrid.value.grid))
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function exportCsv() {
  if (!tableGrid.value) {
    showToast('暂无表格可导出')
    return
  }
  const csv = gridToCsv(tableGrid.value.grid)
  try {
    downloadBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' }), `native-ocr-table-${Date.now()}.csv`)
    showToast('已导出 CSV')
  } catch (_) {
    showToast('导出失败')
  }
}

function exportXlsx() {
  if (!tableGrid.value) {
    showToast('暂无表格可导出')
    return
  }
  try {
    const grid = tableGrid.value.grid
    const worksheet = XLSX.utils.aoa_to_sheet(grid)
    const colWidths = []
    const colCount = grid[0]?.length || 0
    for (let c = 0; c < colCount; c += 1) {
      let width = 8
      for (const row of grid) {
        width = Math.max(width, String(row[c] || '').length + 2)
      }
      colWidths.push({ wch: Math.min(60, width) })
    }
    worksheet['!cols'] = colWidths
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'OCR')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadBlob(new Blob([data], { type: 'application/octet-stream' }), `native-ocr-table-${Date.now()}.xlsx`)
    showToast('已导出 Excel')
  } catch (_) {
    showToast('导出失败')
  }
}

function applyRuntimeStatus(info) {
  runtimeVersion.value = info?.version || ''
  runtimeLatestVersion.value = info?.latestVersion || ''
  if (info?.ready) {
    runtimeStatus.value = 'ready'
    runtimeMessage.value = info.message || ''
    runtimeProgress.value = { phase: '', percent: 100, downloaded: 0, total: 0 }
    return true
  }
  runtimeStatus.value = info?.status || 'missing'
  runtimeMessage.value = info?.message || '需要下载 OCR 运行时后才能识别'
  runtimeProgress.value = { phase: '', percent: 0, downloaded: 0, total: 0 }
  return false
}

async function refreshRuntimeStatus() {
  if (!window.nativeOcr?.checkRuntime) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = '当前环境不支持 OCR 运行时检查'
    return false
  }
  runtimeStatus.value = 'checking'
  runtimeMessage.value = '正在检查 OCR 运行时'
  try {
    return applyRuntimeStatus(await window.nativeOcr.checkRuntime())
  } catch (error) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = formatError(error)
    return false
  }
}

async function startRuntimeDownload() {
  if (!window.nativeOcr?.installRuntime) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = '当前环境不支持 OCR 运行时下载'
    return
  }
  runtimeStatus.value = 'checking'
  runtimeMessage.value = '正在获取 OCR 运行时版本'
  runtimeProgress.value = { phase: 'metadata', percent: 0, downloaded: 0, total: 0 }
  try {
    const status = await window.nativeOcr.installRuntime((progress = {}) => {
      const phase = progress.phase || ''
      if (progress.version) runtimeLatestVersion.value = progress.version
      runtimeProgress.value = {
        phase,
        percent: Number(progress.percent || 0),
        downloaded: Number(progress.downloaded || 0),
        total: Number(progress.total || 0)
      }
      if (phase === 'download') {
        runtimeStatus.value = 'downloading'
        runtimeMessage.value = runtimeLatestVersion.value
          ? `正在下载 ${runtimeLatestVersion.value}`
          : '正在下载 OCR 运行时'
      } else if (phase === 'extract') {
        runtimeStatus.value = 'extracting'
        runtimeMessage.value = '正在解包 OCR 运行时'
      } else if (phase === 'done') {
        runtimeStatus.value = 'ready'
        runtimeMessage.value = ''
      }
    })
    applyRuntimeStatus(status)
    showToast('OCR 运行时已就绪')
    const pending = pendingRecognition
    pendingRecognition = null
    if (pending) await recognizeSource(pending.source, pending.preview)
  } catch (error) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = formatError(error)
  }
}

async function waitForUiPaint() {
  await nextTick()
  await new Promise((resolve) => {
    if (typeof window.requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve)
    })
  })
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function previewForSource(source) {
  if (typeof source === 'string' && source.startsWith('data:image/')) return source
  if (window.nativeOcr?.readImageDataUrl) {
    return window.nativeOcr.readImageDataUrl(source)
  }
  return ''
}

function recognizeWithEngine(source) {
  if (engine.value === 'vision') return window.nativeOcr.recognizeVision(source)
  if (engine.value === 'rapidocr') return window.nativeOcr.recognizeOnnxOcr(source)
  return window.nativeOcr.recognize(source)
}

async function recognizeSource(source, preview = '', force = false) {
  if (!source || loading.value) return
  if (engine.value === 'rapidocr' && !onnxReady.value) {
    showToast('请先下载 ONNX OCR 引擎')
    return
  }
  if (engine.value !== 'vision' && engine.value !== 'rapidocr' && !runtimeReady.value) {
    pendingRecognition = { source, preview }
    try {
      previewSrc.value = preview || await previewForSource(source)
    } catch (_) {
      // Keep the download prompt usable even if preview loading fails.
    }
    showToast('请先下载 OCR 运行时')
    return
  }
  if (!force && source === lastSource && rawResultText.value) return
  lastSource = source
  lastRecognizedSource.value = source
  loading.value = true
  isFirstRunLoading.value = !hasRecognizedOnce
  loadingMessage.value = isFirstRunLoading.value
    ? (engine.value === 'vision' ? '正在识别' : engine.value === 'rapidocr' ? '正在加载 ONNX OCR 模型' : '正在加载 OCR')
    : '识别中'
  rawResultText.value = ''
  lastResult.value = null
  let attemptedRecognition = false
  try {
    previewSrc.value = preview || await previewForSource(source)
    await waitForUiPaint()
    attemptedRecognition = true
    const result = await recognizeWithEngine(source)
    lastResult.value = result || null
    rawResultText.value = result?.text || ''
    if (rawResultText.value) {
      pushHistory(rawResultText.value, result?.engine)
      if (tableMode.value && tableAvailable.value) {
        resultView.value = 'table'
      }
    } else {
      showToast('未识别到文字')
    }
  } catch (error) {
    rawResultText.value = ''
    lastResult.value = null
    showToast(formatError(error))
  } finally {
    if (attemptedRecognition) hasRecognizedOnce = true
    loading.value = false
    isFirstRunLoading.value = false
  }
}

async function handleFile(file) {
  if (!file) return
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const filePath = window.ztools?.getPathForFile ? window.ztools.getPathForFile(file) : ''
    await recognizeSource(filePath || dataUrl, dataUrl)
  } catch (error) {
    showToast(formatError(error))
  }
}

async function selectImage() {
  try {
    if (window.ztools?.showOpenDialog) {
      const files = await Promise.resolve(window.ztools.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Images & PDF',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'pdf']
          }
        ]
      }))
      const picked = Array.isArray(files) ? files : files?.filePaths || []
      if (picked.length > 1) {
        const items = picked.map((filePath) => ({
          id: `batch-${Date.now()}-${batchSeq += 1}`,
          name: String(filePath).split(/[\\/]/).pop(),
          source: filePath,
          status: 'pending',
          text: '',
          error: ''
        }))
        batchItems.value = items
        runBatch()
        return
      }
      const filePath = picked[0] || files
      if (filePath) {
        recognizeSource(filePath)
        return
      }
    }
  } catch (error) {
    showToast(formatError(error))
  }
  fileInput.value?.click()
}

// ---------------------------------------------------------------------------
// 批量识别（多图 / PDF 多页）
// ---------------------------------------------------------------------------

let batchSeq = 0

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]).then(([lib, workerModule]) => {
      lib.GlobalWorkerOptions.workerSrc = workerModule.default
      return lib
    })
  }
  return pdfjsPromise
}

async function pdfToPageItems(file) {
  const lib = await loadPdfjs()
  const data = await file.arrayBuffer()
  const doc = await lib.getDocument({ data }).promise
  const items = []
  const baseName = file.name.replace(/\.pdf$/i, '')
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    items.push({
      id: `batch-${Date.now()}-${batchSeq += 1}`,
      name: `${baseName} · 第 ${pageNumber}/${doc.numPages} 页`,
      source: canvas.toDataURL('image/png'),
      status: 'pending',
      text: '',
      error: ''
    })
  }
  return items
}

async function fileToBatchItem(file) {
  let source = ''
  try {
    source = window.ztools?.getPathForFile ? window.ztools.getPathForFile(file) : ''
  } catch (_) {
    // Fall back to data URL below.
  }
  if (!source) source = await readFileAsDataUrl(file)
  return {
    id: `batch-${Date.now()}-${batchSeq += 1}`,
    name: file.name,
    source,
    status: 'pending',
    text: '',
    error: ''
  }
}

function batchStatusLabel(status) {
  return { pending: '等待', running: '识别中', done: '完成', failed: '失败' }[status] || status
}

const batchMergedText = computed(() => batchItems.value
  .filter((item) => item.status === 'done')
  .map((item) => `=== ${item.name} ===\n${item.text || '(未识别到文字)'}`)
  .join('\n\n'))

const batchActive = computed(() => batchItems.value.length > 0)

async function runBatch() {
  if (batchRunning.value) return
  batchRunning.value = true
  try {
    for (const item of batchItems.value) {
      if (item.status !== 'pending') continue
      item.status = 'running'
      try {
        const result = await recognizeWithEngine(item.source)
        item.text = result?.text || ''
        item.status = 'done'
      } catch (error) {
        item.status = 'failed'
        item.error = formatError(error)
      }
    }
    showToast('批量识别完成')
  } finally {
    batchRunning.value = false
  }
}

async function handleFiles(files) {
  const list = Array.from(files || []).filter(Boolean)
  if (!list.length) return
  const pdfs = list.filter((file) => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))
  const images = list.filter((file) => !pdfs.includes(file))
  if (list.length === 1 && !pdfs.length) {
    handleFile(list[0])
    return
  }
  try {
    const items = []
    for (const file of images) items.push(await fileToBatchItem(file))
    for (const pdf of pdfs) items.push(...await pdfToPageItems(pdf))
    if (!items.length) return
    batchItems.value = items
    runBatch()
  } catch (error) {
    showToast(`批量加载失败：${formatError(error)}`)
  }
}

function copyBatchText() {
  if (!batchMergedText.value) {
    showToast('暂无批量结果')
    return
  }
  copyTextValue(batchMergedText.value)
}

function onFileSelected(event) {
  handleFiles(event.target.files)
  event.target.value = ''
}

function onDrop(event) {
  isDragging.value = false
  handleFiles(event.dataTransfer?.files)
}

function captureScreen() {
  if (!window.ztools?.screenCapture) {
    showToast('当前环境不支持截图')
    return
  }
  window.ztools.screenCapture((image) => {
    if (image) recognizeSource(image, image)
  })
}

function clearAll() {
  previewSrc.value = ''
  rawResultText.value = ''
  lastResult.value = null
  lastSource = ''
  lastRecognizedSource.value = ''
  translatedText.value = ''
  translationActive.value = false
  cellEdits.value = {}
  translatedCells.value = {}
  resultView.value = 'text'
}

async function consumeAction(action) {
  if (action?.code === OCR_CAPTURE_CODE) {
    window.setTimeout(captureScreen, 50)
    return
  }
  const image = window.nativeOcr?.getImageFromAction?.(action)
  if (image) await recognizeSource(image)
}

async function consumePendingImage() {
  const pending = window.__NATIVE_OCR_PENDING_IMAGE__
  if (pending) {
    window.__NATIVE_OCR_PENDING_IMAGE__ = ''
    await recognizeSource(pending)
    return
  }
  try {
    const cached = window.ztools?.dbStorage?.getItem?.(OCR_IMAGE_STORAGE_KEY)
    if (cached) previewSrc.value = await previewForSource(cached)
  } catch (_) {
    // Ignore unavailable storage.
  }
}

function onOcrImageEvent(event) {
  const source = event.detail?.source || event.detail
  if (source) recognizeSource(source)
}

watch(engine, (value) => {
  try {
    localStorage.setItem('native_ocr_engine', value)
  } catch (_) {
    // Ignore storage failures.
  }
  lastSource = ''
  if (value === 'wechat') {
    tableMode.value = false
  }
  if (resultView.value === 'table' && !tableAvailable.value) {
    resultView.value = 'text'
  }
  // 切换引擎后自动用新引擎重新识别当前图片（新引擎未就绪时跳过，遮罩会引导下载）
  if (lastRecognizedSource.value && !loading.value && readyToRecognize.value) {
    recognizeSource(lastRecognizedSource.value, previewSrc.value, true)
  }
})

watch(tableAvailable, (available) => {
  if (!available && resultView.value === 'table') {
    resultView.value = 'text'
  }
})

watch(translateTarget, (val) => {
  try {
    localStorage.setItem('native_ocr_translate_target', String(val))
  } catch (_) {
    // Ignore storage failures.
  }
})

onMounted(async () => {
  window.addEventListener(OCR_IMAGE_EVENT, onOcrImageEvent)
  window.addEventListener('keydown', onGlobalKeydown)
  try {
    window.ztools?.onPluginEnter?.(consumeAction)
  } catch (_) {
    // Ignore host API failures.
  }
  try {
    visionAvailable.value = await window.nativeOcr?.isVisionAvailable?.() || false
  } catch (_) {
    // Ignore host API failures.
  }
  try {
    onnxReady.value = await window.nativeOcr?.isOnnxOcrAvailable?.() || false
  } catch (_) {
    // Ignore host API failures.
  }
  // 微信 OCR 仅支持 macOS；Windows 上历史遗留的 wechat 引擎回退到本机 OCR
  if (engine.value === 'wechat' && !isMacPlatform) {
    engine.value = 'vision'
  }
  if (engine.value === 'vision' && !visionAvailable.value) {
    engine.value = 'rapidocr'
  }
  await refreshRuntimeStatus()
  await consumePendingImage()
})

onBeforeUnmount(() => {
  window.removeEventListener(OCR_IMAGE_EVENT, onOcrImageEvent)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pointermove', onSepDragMove)
  window.removeEventListener('pointermove', onPanMove)
  window.clearTimeout(toastTimer)
})
</script>

<style scoped>
.ocr-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-primary);
}

.engine-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 8px 14px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.engine-label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
}

.engine-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-panel-muted);
}

.engine-tab {
  padding: 4px 12px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.engine-tab:hover:not(:disabled):not(.active) {
  background: var(--bg-hover);
}

.engine-tab.active {
  background: var(--primary-color);
  color: var(--text-white);
  box-shadow: 0 1px 4px var(--primary-shadow);
}

.engine-tab:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.engine-tab.pending {
  color: var(--text-tertiary);
}

.engine-tab-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-panel-muted);
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 600;
  vertical-align: 1px;
}

.engine-tab.active .engine-tab-badge {
  background: rgba(255, 255, 255, 0.25);
  color: var(--text-white);
}

.workbench {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(360px, 1fr);
  min-height: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}

.preview-pane {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: hidden;
  background: var(--bg-panel-muted);
  border-right: 1px solid var(--border-color);
}

.preview-pane.dragging {
  background: var(--bg-hover-light);
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

.empty-state {
  display: grid;
  gap: 6px;
  place-items: center;
  color: var(--text-secondary);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--text-secondary);
  font-size: 22px;
}

.empty-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--text-primary);
}

.empty-subtitle {
  font-size: 12px;
  color: var(--text-tertiary);
}

.preview-stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
  line-height: 0;
}

.preview-transform {
  position: relative;
  display: inline-block;
  transform-origin: 0 0;
}

.preview-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}

.preview-image:active {
  cursor: grabbing;
}

.batch-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  overflow: hidden;
  background: var(--bg-app);
  z-index: 5;
}

.batch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.batch-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}

.batch-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px 0;
  overflow: auto;
  list-style: none;
}

.batch-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 2px;
  font-size: 13px;
  border-bottom: 1px dashed var(--border-color);
}

.batch-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.batch-status {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.batch-status.running {
  color: var(--primary-color);
}

.batch-status.done {
  color: #1a9c6b;
}

.batch-status.failed {
  color: #d64545;
}

.lang-select {
  max-width: 110px;
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 12px;
}

.table-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.overlay-line {
  position: absolute;
  background: var(--primary-color);
  opacity: 0.45;
}

.row-line {
  left: 0;
  right: 0;
  height: 1px;
}

.col-line {
  top: 0;
  bottom: 0;
  width: 1px;
}

.table-overlay.interactive .overlay-line {
  pointer-events: auto;
  opacity: 0.7;
  touch-action: none;
}

.table-overlay.interactive .row-line {
  cursor: row-resize;
}

.table-overlay.interactive .col-line {
  cursor: col-resize;
}

.table-overlay.interactive .overlay-line::after {
  content: '';
  position: absolute;
  inset: -6px;
}

.table-overlay.interactive .row-line::after {
  left: 0;
  right: 0;
}

.table-overlay.interactive .col-line::after {
  top: 0;
  bottom: 0;
}

.busy-mask {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 8px;
  place-content: center;
  background: var(--bg-overlay);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 650;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.runtime-mask {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 10px;
  place-content: center;
  justify-items: center;
  padding: 24px;
  background: var(--bg-overlay);
  color: var(--text-primary);
  text-align: center;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.runtime-title {
  font-size: 15px;
  font-weight: 750;
}

.runtime-message {
  max-width: min(420px, calc(100vw - 48px));
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.runtime-message .exe-path {
  display: inline-block;
  margin: 2px 0;
  padding: 2px 6px;
  max-width: 100%;
  border-radius: 4px;
  background: var(--switch-bg);
  color: var(--text-primary);
  font-size: 11px;
  word-break: break-all;
  user-select: all;
}

.runtime-progress {
  width: min(340px, calc(100vw - 56px));
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--switch-bg);
}

.runtime-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--primary-color);
  transition: width 0.18s ease;
}

.runtime-progress-text {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.4;
}

.runtime-download-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 7px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.runtime-download-button:hover {
  background: var(--primary-hover);
}

.runtime-download-button.ghost {
  background: transparent;
  color: var(--text-secondary);
  font-weight: 500;
  box-shadow: none;
  border: 1px solid var(--switch-bg);
}

.runtime-download-button.ghost:hover {
  background: var(--switch-bg);
  color: var(--text-primary);
}

.loading-note {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.spinner {
  width: 22px;
  height: 22px;
  margin: 0 auto;
  border: 2px solid var(--spinner-bg);
  border-top-color: var(--primary-color);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

.result-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 0;
  background: var(--bg-panel);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  min-height: 46px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.view-tabs {
  display: inline-flex;
  gap: 2px;
  flex: 0 0 auto;
  padding: 2px;
  border-radius: 7px;
  background: var(--bg-panel-muted);
}

.view-tab {
  padding: 3px 10px;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.view-tab:hover:not(:disabled):not(.active) {
  background: var(--bg-hover);
}

.view-tab.active {
  background: var(--primary-color);
  color: var(--text-white);
}

.view-tab:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.table-toggle {
  flex: 1 1 auto;
  justify-content: center;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.mini-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--bg-panel-muted);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.mini-button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mini-button.active {
  background: var(--primary-color);
  color: var(--text-white);
}

.mini-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.mini-button.danger:hover:not(:disabled) {
  background: rgba(224, 67, 67, 0.16);
  color: #e04343;
}

.history-wrap {
  position: relative;
}

.history-badge {
  display: inline-grid;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  place-items: center;
  border-radius: 999px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.history-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - 24px));
  max-height: min(420px, 60vh);
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-overlay);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
}

.history-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.history-empty {
  padding: 24px 12px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}

.history-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
}

.history-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
}

.history-item:hover {
  background: var(--bg-hover);
}

.history-item-main {
  flex: 1;
  min-width: 0;
}

.history-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.history-engine {
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 700;
}

.history-time {
  color: var(--text-tertiary);
  font-size: 11px;
}

.history-item-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.history-delete {
  display: inline-grid;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.history-delete:hover {
  background: var(--bg-hover);
  color: #e04343;
}

.history-enter-active,
.history-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.history-enter-from,
.history-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.result-pane textarea {
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 18px 20px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 1.6;
}

.result-pane textarea::placeholder {
  color: var(--text-tertiary);
}

.table-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.table-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.table-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.actions-spacer {
  flex: 1 1 auto;
}

.cluster-row {
  flex-wrap: nowrap;
}

.cluster-slider-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.cluster-range {
  flex: 1 1 auto;
  min-width: 140px;
  accent-color: var(--primary-color);
}

.cluster-slider-value {
  min-width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  font-size: 12px;
}

.table-dims {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  padding: 10px 14px;
  overflow: auto;
}

.table-preview-table {
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
}

.table-preview-table td {
  min-width: 48px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  color: var(--text-tertiary);
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}

.table-preview-table td.filled {
  color: var(--text-primary);
  font-weight: 500;
}

.table-preview-table td.low {
  background: rgba(255, 179, 0, 0.16);
}

.table-preview-table td.low::after {
  content: '±';
  float: right;
  color: #e6a23c;
  font-size: 11px;
  font-weight: 700;
}

.cell-edit {
  min-height: 1em;
  outline: none;
  cursor: text;
}

.table-preview-table td:focus-within {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
  background: var(--bg-hover);
}

.translation-view {
  color: var(--text-secondary);
  font-style: italic;
}

.table-empty {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}

.toolbar {
  flex: 0 0 54px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 8px 14px;
  background: var(--bg-surface);
}

.left-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.right-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.tool-button,
.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  white-space: nowrap;
  cursor: pointer;
}

.tool-button {
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 650;
}

.tool-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.copy-button {
  min-width: 104px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.copy-button:hover:not(:disabled) {
  background: var(--primary-hover);
}

.tool-button:disabled,
.copy-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.icon,
.copy-icon {
  display: inline-grid;
  width: 18px;
  place-items: center;
  font-size: 18px;
  line-height: 1;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.toggle.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--switch-bg);
  transition: background 0.16s ease;
}

.switch::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-white);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  content: "";
  transition: transform 0.16s ease;
}

.toggle input:checked + .switch {
  background: var(--primary-color);
}

.toggle input:checked + .switch::after {
  transform: translateX(16px);
}

.file-input {
  display: none;
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 66px;
  max-width: min(420px, calc(100vw - 36px));
  padding: 10px 14px;
  border-radius: 7px;
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .ocr-shell {
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .workbench {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 44vh) minmax(220px, 1fr);
  }

  .preview-pane {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .result-header {
    flex-wrap: wrap;
    gap: 8px;
  }

  .table-toggle {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .result-pane textarea {
    padding: 14px;
    font-size: 15px;
  }

  .toolbar {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .left-actions {
    justify-content: space-between;
    gap: 4px;
  }

  .right-actions {
    justify-content: space-between;
    gap: 8px;
  }

  .tool-button,
  .copy-button {
    min-height: 32px;
    padding: 0 8px;
    font-size: 13px;
  }

  .toggle {
    justify-content: center;
  }
}
</style>
