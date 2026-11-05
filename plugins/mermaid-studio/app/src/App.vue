<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import mermaid from 'mermaid'
import { DEFAULT_DOC, TEMPLATES, TYPE_LABELS, detectType } from './lib/templates'
import {
  blobToBase64,
  buildPdf,
  clampScale,
  prepareSvg,
  rasterize,
  textToBase64
} from './lib/mermaid-export'
import type { ExportFormat, StudioSettings } from './env'

/** 主题选项 */
const THEMES = [
  { value: 'default', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'forest', label: '森林' },
  { value: 'neutral', label: '中性' }
] as const

/** 布局选项 */
const LAYOUTS = [
  { value: 'split', label: '并排' },
  { value: 'editor', label: '编辑' },
  { value: 'preview', label: '预览' }
] as const

/** 导出倍数选项 */
const SCALES = [1, 2, 3, 4] as const

/** 默认配置；宿主不可用时使用 */
const FALLBACK_SETTINGS: StudioSettings = {
  theme: 'default',
  layout: 'split',
  exportScale: 2,
  autoSave: true
}

const code = ref(DEFAULT_DOC)
const settings = ref<StudioSettings>({ ...FALLBACK_SETTINGS })
const statusText = ref('准备就绪')
const statusKind = ref<'idle' | 'busy' | 'ok' | 'error'>('idle')
const errorText = ref('')
const diagramSize = ref({ width: 0, height: 0 })
const zoom = ref(1)
const showTemplates = ref(false)
const showPdfPanel = ref(false)
const saveAs = ref(false)
const exportFormat = ref<ExportFormat | null>(null)
const toastText = ref('')
const linesRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLElement | null>(null)
const splitRatio = ref(0.46)

/** PDF 参数 */
const pdfPaper = ref<'a4' | 'a3' | 'letter' | 'auto'>('a4')
const pdfOrientation = ref<'portrait' | 'landscape' | 'auto'>('auto')
const pdfMargin = ref(12)

let renderTimer: number | undefined
let toastTimer: number | undefined
/** 递增的渲染序号，丢弃过期结果 */
let renderSeq = 0
/** 导出中标志：兼作并发锁与响应式禁用状态 */
const exportBusy = ref(false)
/** 首次渲染后是否还需要自适应缩放 */
let autoFitPending = true
/** 预览区尺寸监听器 */
let resizeObserver: ResizeObserver | null = null

/** 图表类型 */
const diagramType = computed(() => detectType(code.value))
/** 图表类型展示名 */
const diagramTypeLabel = computed(() => TYPE_LABELS[diagramType.value] || '未知')
/** 行号 */
const lineNumbers = computed(() => {
  const total = code.value.split('\n').length
  return Array.from({ length: total }, (_v, i) => i + 1).join('\n')
})
/** 分栏宽度：用 CSS 变量传递，避免内联覆盖 grid 定义 */
const splitStyle = computed(() => {
  if (settings.value.layout === 'split') {
    return { '--editor-width': `${Math.round(splitRatio.value * 100)}%` }
  }
  return {}
})
/** 预览缩放 */
const zoomStyle = computed(() => ({ transform: `scale(${zoom.value})` }))

/**
 * 更新状态提示。
 * @param kind 状态类型
 * @param text 提示文案
 */
function setStatus(kind: 'idle' | 'busy' | 'ok' | 'error', text: string): void {
  statusKind.value = kind
  statusText.value = text
}

/**
 * 显示短暂提示。
 * @param text 提示文案
 */
function toast(text: string): void {
  toastText.value = text
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastText.value = ''
  }, 2400)
}

/**
 * 读取宿主保存的配置；宿主不可用时退回默认值。
 * @returns 规范化配置
 */
function loadSettings(): StudioSettings {
  const bridge = window.mermaidStudio
  if (!bridge) return { ...FALLBACK_SETTINGS }
  try {
    return { ...FALLBACK_SETTINGS, ...bridge.readSettings() }
  } catch {
    return { ...FALLBACK_SETTINGS }
  }
}

/**
 * 保存配置到宿主。
 * @param patch 需要更新的字段
 */
function persistSettings(patch: Partial<StudioSettings>): void {
  const bridge = window.mermaidStudio
  if (!bridge) return
  try {
    settings.value = { ...settings.value, ...bridge.writeSettings(patch) }
  } catch {
    toast('配置保存失败')
  }
}

/** 应用 Mermaid 主题配置 */
function initializeMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: settings.value.theme,
    securityLevel: 'loose',
    flowchart: { htmlLabels: true, useMaxWidth: false, curve: 'basis' },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    fontFamily: '"Inter","Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
  })
}

/**
 * 渲染当前代码到预览区。
 * @param immediate 是否跳过去抖
 */
async function renderDiagram(immediate = false): Promise<void> {
  window.clearTimeout(renderTimer)
  const run = async (): Promise<void> => {
    const source = code.value.trim()
    const seq = ++renderSeq
    errorText.value = ''
    if (!source) {
      setStatus('idle', '等待输入')
      if (canvasRef.value) canvasRef.value.innerHTML = ''
      diagramSize.value = { width: 0, height: 0 }
      return
    }

    setStatus('busy', '渲染中…')
    const id = `mmd-${Date.now()}-${seq}`
    try {
      const { svg } = await mermaid.render(id, source)
      // 丢弃过期结果，避免旧内容覆盖新状态
      if (seq !== renderSeq || !canvasRef.value) return
      canvasRef.value.innerHTML = svg
      const node = canvasRef.value.querySelector('svg')
      if (node) {
        const vb = node.viewBox.baseVal
        node.style.maxWidth = 'none'
        node.style.height = 'auto'
        diagramSize.value = {
          width: Math.round(vb.width || node.clientWidth),
          height: Math.round(vb.height || node.clientHeight)
        }
        node.removeAttribute('height')
      }
      // 导出进行中时不覆盖导出状态文案
      if (!exportBusy.value) setStatus('ok', `渲染成功 · ${diagramTypeLabel.value}`)
      // 首次渲染后自动适配预览区
      if (autoFitPending) {
        autoFitPending = false
        await fitToView()
      }
    } catch (error) {
      if (seq !== renderSeq) return
      const message = (error as Error)?.message || '渲染失败'
      errorText.value = message
      if (!exportBusy.value) setStatus('error', '渲染失败')
      // 保留上一次成功的图，避免预览闪空
    }
  }

  if (immediate) {
    await run()
  } else {
    renderTimer = window.setTimeout(run, 280)
  }
}

/** 复位预览缩放 */
function fitZoom(): void {
  zoom.value = 1
}

/**
 * 根据预览区尺寸自动缩放，使图表完整可见。
 */
async function fitToView(): Promise<void> {
  await nextTick()
  const scroll = canvasRef.value?.parentElement
  if (!scroll || !diagramSize.value.width) {
    zoom.value = 1
    return
  }
  // 减去 .canvas-scroll 的左右/上下 padding（20px * 2）
  const availableW = scroll.clientWidth - 40
  const availableH = scroll.clientHeight - 40
  if (availableW <= 0 || availableH <= 0) return
  const ratio = Math.min(
    availableW / diagramSize.value.width,
    availableH / diagramSize.value.height,
    1.6
  )
  zoom.value = Math.max(0.2, Number(ratio.toFixed(2)))
}

/**
 * 获取当前预览区中的 SVG 元素。
 * @returns SVG 元素或 null
 */
function currentSvg(): SVGSVGElement | null {
  const node = canvasRef.value?.querySelector('svg')
  return node ? (node as unknown as SVGSVGElement) : null
}

/**
 * 执行导出。
 * @param format 目标格式
 */
async function doExport(format: ExportFormat): Promise<void> {
  if (exportBusy.value) return
  const bridge = window.mermaidStudio
  if (!bridge) {
    toast('当前环境不支持保存文件')
    return
  }
  const svg = currentSvg()
  if (!svg) {
    toast('请先输入并渲染图表')
    return
  }

  exportBusy.value = true
  exportFormat.value = format
  setStatus('busy', `导出 ${format.toUpperCase()}…`)
  try {
    const background = settings.value.theme === 'dark' ? '#1e1e2e' : '#ffffff'
    const prepared = prepareSvg(svg, background)
    if (!prepared) throw new Error('无法读取图表尺寸')

    const stamp = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const baseName = `mermaid-${diagramType.value}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`

    let base64 = ''
    let fileName = baseName

    if (format === 'svg') {
      // SVG 面向外部编辑器，导出无 foreignObject 的版本
      base64 = textToBase64(prepared.flatSvg || prepared.svg)
      fileName = `${baseName}.svg`
    } else if (format === 'png') {
      const blob = await rasterize(prepared, settings.value.exportScale, background)
      base64 = await blobToBase64(blob)
      fileName = `${baseName}.png`
    } else {
      const blob = await rasterize(prepared, settings.value.exportScale, background)
      // 按实际生效的缩放比换算像素尺寸，避免超高图被限幅后 PDF 比例失真
      const actualScale = clampScale(prepared.width, prepared.height, settings.value.exportScale)
      const pdfBlob = await buildPdf(blob, {
        paper: pdfPaper.value,
        orientation: pdfOrientation.value,
        marginMm: pdfMargin.value,
        pixelWidth: Math.round(prepared.width * actualScale),
        pixelHeight: Math.round(prepared.height * actualScale)
      })
      base64 = await blobToBase64(pdfBlob)
      fileName = `${baseName}.pdf`
    }

    const result = await bridge.saveFile({
      format,
      base64,
      fileName,
      saveAs: saveAs.value
    })

    if (!result.saved) {
      setStatus('idle', '已取消导出')
      return
    }
    setStatus('ok', '导出完成')
    toast(`已保存：${result.filePath?.split(/[/\\]/).pop() || fileName}`)
    showPdfPanel.value = false
  } catch (error) {
    const message = (error as Error)?.message || '导出失败'
    setStatus('error', message)
    toast(message)
  } finally {
    exportBusy.value = false
    exportFormat.value = null
  }
}

/**
 * 插入模板。
 * @param templateCode 模板代码
 */
function applyTemplate(templateCode: string): void {
  code.value = templateCode
  showTemplates.value = false
  // 换图后按新尺寸重新适配
  autoFitPending = true
  renderDiagram(true)
}

/** 整理缩进：统一为 4 空格并去掉行尾空格 */
function formatCode(): void {
  const lines = code.value.split('\n').map((line) => {
    const trimmedRight = line.replace(/\s+$/, '')
    const leading = trimmedRight.match(/^[\t ]*/)?.[0] || ''
    const spaces = leading.replace(/\t/g, '    ').length
    return ' '.repeat(spaces) + trimmedRight.slice(leading.length)
  })
  code.value = lines.join('\n')
  toast('已整理缩进')
}

/** 复制代码到剪贴板 */
async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(code.value)
    toast('代码已复制')
  } catch {
    toast('复制失败，请手动选择')
  }
}

/**
 * 编辑器键盘处理：Tab 缩进、Enter 继承缩进、Ctrl+S 导出。
 * @param event 键盘事件
 */
function onEditorKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLTextAreaElement
  const { selectionStart, selectionEnd, value } = target

  if (event.key === 'Tab') {
    event.preventDefault()
    const indent = '    '
    if (event.shiftKey) {
      // 反缩进：删除行首最多 4 个空格
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
      const head = value.slice(lineStart, selectionStart)
      const removed = head.match(/ {1,4}$|^\t/)?.[0] || ''
      const cut = removed ? removed.length : 0
      if (!cut) return
      target.value = value.slice(0, selectionStart - cut) + value.slice(selectionStart)
      target.selectionStart = target.selectionEnd = selectionStart - cut
      code.value = target.value
      return
    }
    target.value = `${value.slice(0, selectionStart)}${indent}${value.slice(selectionEnd)}`
    target.selectionStart = target.selectionEnd = selectionStart + indent.length
    code.value = target.value
    return
  }

  if (event.key === 'Enter') {
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const currentLine = value.slice(lineStart, selectionStart)
    const indent = currentLine.match(/^[\t ]*/)?.[0] || ''
    // 行尾是 { 或 : 时自动多缩进一级
    const extra = /[{:]$/.test(currentLine.trim()) ? '    ' : ''
    event.preventDefault()
    const insert = `\n${indent}${extra}`
    target.value = `${value.slice(0, selectionStart)}${insert}${value.slice(selectionEnd)}`
    target.selectionStart = target.selectionEnd = selectionStart + insert.length
    code.value = target.value
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void doExport('png')
  }
}

/**
 * 编辑器滚动时同步行号。
 * @param event 滚动事件
 */
function onEditorScroll(event: Event): void {
  const target = event.target as HTMLTextAreaElement
  if (linesRef.value) linesRef.value.scrollTop = target.scrollTop
}

/**
 * 处理分栏拖拽。
 * @param event 鼠标事件
 */
function startDrag(event: MouseEvent): void {
  const container = (event.target as HTMLElement).parentElement
  if (!container) return
  const rect = container.getBoundingClientRect()
  const move = (e: MouseEvent): void => {
    const ratio = (e.clientX - rect.left) / rect.width
    splitRatio.value = Math.min(0.8, Math.max(0.2, ratio))
  }
  const up = (): void => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

/**
 * 预览区滚轮缩放（Ctrl/⌘ + 滚轮）。
 * @param event 滚轮事件
 */
function onCanvasWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const next = zoom.value + (event.deltaY > 0 ? -0.1 : 0.1)
  zoom.value = Math.min(3, Math.max(0.3, Number(next.toFixed(2))))
}

/**
 * 切换主题。
 * @param theme 目标主题
 */
function setTheme(theme: StudioSettings['theme']): void {
  settings.value.theme = theme
  initializeMermaid()
  persistSettings({ theme })
  void renderDiagram(true)
}

/**
 * 切换布局。
 * @param layout 目标布局
 */
function setLayout(layout: StudioSettings['layout']): void {
  settings.value.layout = layout
  persistSettings({ layout })
  void nextTick(fitZoom)
}

/**
 * 切换导出倍数。
 * @param value 倍数
 */
function setScale(value: string): void {
  const next = Number(value) as StudioSettings['exportScale']
  settings.value.exportScale = next
  persistSettings({ exportScale: next })
}

/** 切换自动保存 */
function toggleAutoSave(): void {
  settings.value.autoSave = !settings.value.autoSave
  persistSettings({ autoSave: settings.value.autoSave })
}

// 代码变化时防抖渲染
watch(code, () => {
  void renderDiagram()
})

onMounted(() => {
  settings.value = loadSettings()
  initializeMermaid()
  void renderDiagram(true)

  // 预览区尺寸变化（窗口缩放、布局切换）时重新适配
  const scroll = canvasRef.value?.parentElement
  if (scroll && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (!autoFitPending) void fitToView()
    })
    resizeObserver.observe(scroll)
  }

  // 宿主退出时清理计时器，避免后台继续渲染
  window.ztools?.onPluginOut?.(() => {
    window.clearTimeout(renderTimer)
    window.clearTimeout(toastTimer)
    renderSeq += 1
  })

  // over 指令：把选中文本作为初始代码
  window.ztools?.onPluginEnter?.((action) => {
    const payload = (action as { payload?: unknown })?.payload
    if (typeof payload === 'string' && payload.trim()) {
      code.value = payload
      void renderDiagram(true)
    }
  })
})

onBeforeUnmount(() => {
  window.clearTimeout(renderTimer)
  window.clearTimeout(toastTimer)
  renderSeq += 1
  resizeObserver?.disconnect()
})
</script>

<template>
  <div class="studio" :data-theme="settings.theme">
    <!-- 顶部工具栏 -->
    <header class="toolbar">
      <div class="brand">
        <span class="brand-dot" />
        <div class="brand-text">
          <strong>Mermaid 图表工作室</strong>
          <small>{{ diagramTypeLabel }}</small>
        </div>
      </div>

      <div class="toolbar-group">
        <button class="btn" type="button" @click="showTemplates = !showTemplates">模板</button>
        <button class="btn" type="button" @click="formatCode">整理</button>
        <button class="btn" type="button" @click="copyCode">复制</button>
      </div>

      <div class="segmented" role="group" aria-label="主题">
        <button
          v-for="theme in THEMES"
          :key="theme.value"
          type="button"
          class="segmented-item"
          :class="{ active: settings.theme === theme.value }"
          @click="setTheme(theme.value)"
        >
          {{ theme.label }}
        </button>
      </div>

      <div class="segmented" role="group" aria-label="布局">
        <button
          v-for="layout in LAYOUTS"
          :key="layout.value"
          type="button"
          class="segmented-item"
          :class="{ active: settings.layout === layout.value }"
          @click="setLayout(layout.value)"
        >
          {{ layout.label }}
        </button>
      </div>

      <div class="toolbar-group right">
        <select
          class="select"
          :value="settings.exportScale"
          aria-label="导出倍数"
          @change="setScale(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="scale in SCALES" :key="scale" :value="scale">{{ scale }}x</option>
        </select>
        <button
          class="btn primary"
          type="button"
          :disabled="exportBusy"
          @click="doExport('png')"
        >
          PNG
        </button>
        <button class="btn" type="button" :disabled="exportBusy" @click="doExport('svg')">
          SVG
        </button>
        <button class="btn" type="button" :disabled="exportBusy" @click="showPdfPanel = true">
          PDF
        </button>
        <label class="checkbox">
          <input v-model="saveAs" type="checkbox" />
          <span>选择位置</span>
        </label>
      </div>
    </header>

    <!-- 主区域 -->
    <main class="workspace" :class="`layout-${settings.layout}`" :style="splitStyle">
      <section v-if="settings.layout !== 'preview'" class="pane editor-pane">
        <div class="pane-head">
          <span class="tag">{{ diagramType }}</span>
          <span class="muted">{{ code.length }} 字符 · {{ code.split('\n').length }} 行</span>
          <label class="checkbox small">
            <input :checked="settings.autoSave" type="checkbox" @change="toggleAutoSave" />
            <span>自动保存本地</span>
          </label>
        </div>
        <div class="editor-wrap">
          <pre ref="linesRef" class="gutter" aria-hidden="true">{{ lineNumbers }}</pre>
          <textarea
            v-model="code"
            class="editor"
            spellcheck="false"
            placeholder="在此输入 Mermaid 代码，例如：flowchart TD&#10;  A[开始] --> B[结束]"
            @keydown="onEditorKeydown"
            @scroll="onEditorScroll"
          />
        </div>
      </section>

      <div v-if="settings.layout === 'split'" class="splitter" @mousedown.prevent="startDrag" />

      <section v-if="settings.layout !== 'editor'" class="pane preview-pane">
        <div class="pane-head">
          <span class="tag ghost">实时预览</span>
          <span v-if="diagramSize.width" class="muted">
            {{ diagramSize.width }} × {{ diagramSize.height }} px
          </span>
          <span class="spacer" />
          <button
            class="icon-btn"
            type="button"
            title="缩小"
            @click="zoom = Math.max(0.3, Number((zoom - 0.1).toFixed(2)))"
          >
            −
          </button>
          <span class="zoom">{{ Math.round(zoom * 100) }}%</span>
          <button
            class="icon-btn"
            type="button"
            title="放大"
            @click="zoom = Math.min(3, Number((zoom + 0.1).toFixed(2)))"
          >
            +
          </button>
          <button class="icon-btn" type="button" title="复位" @click="fitZoom">复位</button>
        </div>
        <div class="canvas-scroll" @wheel="onCanvasWheel">
          <div ref="canvasRef" class="canvas" :style="zoomStyle" />
          <div v-if="errorText" class="error-card" role="alert">
            <strong>渲染失败</strong>
            <pre>{{ errorText }}</pre>
          </div>
        </div>
      </section>
    </main>

    <!-- 状态栏 -->
    <footer class="statusbar">
      <span class="status-dot" :class="`dot-${statusKind}`" />
      <span class="status-text">{{ statusText }}</span>
      <span class="spacer" />
      <span class="muted">Ctrl+S 导出 PNG · Ctrl+滚轮缩放</span>
    </footer>

    <!-- 模板面板 -->
    <div v-if="showTemplates" class="mask" @click.self="showTemplates = false">
      <div class="dialog template-dialog">
        <header class="dialog-head">
          <h2>选择模板</h2>
          <button class="icon-btn" type="button" @click="showTemplates = false">×</button>
        </header>
        <div class="template-grid">
          <button
            v-for="item in TEMPLATES"
            :key="item.id"
            class="template-card"
            type="button"
            @click="applyTemplate(item.code)"
          >
            <strong>{{ item.label }}</strong>
            <small>{{ item.type }}</small>
          </button>
        </div>
      </div>
    </div>

    <!-- PDF 面板 -->
    <div v-if="showPdfPanel" class="mask" @click.self="showPdfPanel = false">
      <div class="dialog pdf-dialog">
        <header class="dialog-head">
          <h2>导出 PDF</h2>
          <button class="icon-btn" type="button" @click="showPdfPanel = false">×</button>
        </header>
        <div class="field">
          <label>纸张</label>
          <select v-model="pdfPaper" class="select">
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="letter">Letter</option>
            <option value="auto">自适应内容</option>
          </select>
        </div>
        <div class="field">
          <label>方向</label>
          <select v-model="pdfOrientation" class="select">
            <option value="auto">自动</option>
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </div>
        <div class="field">
          <label>页边距</label>
          <div class="range-row">
            <input v-model.number="pdfMargin" type="range" min="0" max="40" step="1" />
            <span class="muted">{{ pdfMargin }} mm</span>
          </div>
        </div>
        <footer class="dialog-foot">
          <button class="btn" type="button" @click="showPdfPanel = false">取消</button>
          <button class="btn primary" type="button" :disabled="exportBusy" @click="doExport('pdf')">
            导出 PDF
          </button>
        </footer>
      </div>
    </div>

    <!-- 轻提示 -->
    <div v-if="toastText" class="toast">{{ toastText }}</div>
  </div>
</template>

<style scoped>
.studio {
  /* 语义化颜色，跟随宿主主题色 */
  --surface: #ffffff;
  --surface-2: #f6f7fb;
  --surface-3: #eef1f7;
  --border: #e2e6ef;
  --text: #1f2430;
  --text-muted: #6b7385;
  --primary: var(--plugin-primary-color, #6d5cff);
  --danger: #e5484d;
  --success: #2f9e63;

  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
}

.studio[data-theme='dark'] {
  --surface: #1e2130;
  --surface-2: #262a3b;
  --surface-3: #2f3448;
  --border: #3a4057;
  --text: #e7e9f2;
  --text-muted: #9aa1b8;
}

@media (prefers-color-scheme: dark) {
  .studio {
    --surface: #1e2130;
    --surface-2: #262a3b;
    --surface-3: #2f3448;
    --border: #3a4057;
    --text: #e7e9f2;
    --text-muted: #9aa1b8;
  }
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 6px;
}

.brand-dot {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: linear-gradient(135deg, #7c5cff, #38bdf8);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand-text strong {
  font-size: 13px;
}

.brand-text small {
  font-size: 11px;
  color: var(--text-muted);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-group.right {
  margin-left: auto;
}

.btn {
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn:hover:not(:disabled) {
  background: var(--surface-3);
}

.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.segmented-item {
  padding: 3px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.segmented-item.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
}

.select {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.checkbox.small {
  font-size: 11px;
}

/* 工作区 */
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  --editor-width: 46%;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  background: var(--surface-2);
  overflow: hidden;
}

.workspace.layout-split {
  grid-template-columns: var(--editor-width) 6px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.workspace.layout-editor,
.workspace.layout-preview {
  grid-template-columns: 1fr;
  grid-template-rows: minmax(0, 1fr);
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
  overflow: hidden;
}

.splitter {
  cursor: col-resize;
  background: var(--border);
}

.splitter:hover {
  background: var(--primary);
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  min-height: 32px;
}

.tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
  font-size: 11px;
}

.tag.ghost {
  background: var(--surface-3);
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
  font-size: 11px;
}

.spacer {
  margin-left: auto;
}

.icon-btn {
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--surface-3);
}

.zoom {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 36px;
  text-align: center;
}

/* 编辑器 */
.editor-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.gutter {
  margin: 0;
  padding: 10px 8px;
  background: var(--surface-2);
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  text-align: right;
  overflow: hidden;
  user-select: none;
}

.editor {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  background: var(--surface);
  color: var(--text);
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 4;
  white-space: pre;
  overflow: auto;
}

/* 预览 */
.canvas-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px;
  background-color: var(--surface-2);
  background-image: radial-gradient(var(--border) 1px, transparent 1px);
  background-size: 16px 16px;
}

.canvas {
  display: inline-block;
  transform-origin: top left;
  transition: transform 0.12s ease-out;
  will-change: transform;
  /* 给图表一个与它主题一致的底色，避免深色主题下透明背景影响对比度 */
  padding: 0;
  border-radius: 6px;
  background: transparent;
}

/* 深色 Mermaid 主题下，给预览底图铺一层深色，保证文字对比 */
.studio[data-theme='dark'] .canvas {
  background: #1e1e2e;
}

.studio[data-theme='dark'] .canvas :deep(svg) {
  background: #1e1e2e;
  border-radius: 6px;
}

.canvas :deep(svg) {
  display: block;
  max-width: none !important;
  height: auto;
}

.error-card {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  padding: 10px 12px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  color: var(--danger);
  font-size: 12px;
}

.error-card pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.5;
}

/* 状态栏 */
.statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}

.dot-busy {
  background: #e8a33d;
}

.dot-ok {
  background: var(--success);
}

.dot-error {
  background: var(--danger);
}

.status-text {
  color: var(--text);
}

/* 弹层 */
.mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 38%);
  z-index: 40;
}

.dialog {
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 18px 48px rgb(0 0 0 / 22%);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.dialog-head h2 {
  margin: 0;
  font-size: 14px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  overflow: auto;
}

.template-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.template-card:hover {
  border-color: var(--primary);
}

.template-card small {
  color: var(--text-muted);
  font-size: 11px;
}

.pdf-dialog {
  width: min(360px, calc(100vw - 48px));
}

.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.field > label {
  width: 60px;
  color: var(--text-muted);
  font-size: 12px;
}

.field .select {
  flex: 1;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.range-row input {
  flex: 1;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 42px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgb(28 32 44 / 92%);
  color: #fff;
  font-size: 12px;
  z-index: 60;
}

/* 窄窗口适配：仅在极窄窗口下改为上下排列 */
@media (max-width: 640px) {
  .workspace.layout-split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }

  .splitter {
    display: none;
  }

  .toolbar {
    gap: 6px;
  }
}
</style>
