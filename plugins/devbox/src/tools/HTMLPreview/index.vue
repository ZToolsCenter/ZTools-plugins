<script lang="ts" setup>
import { ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const htmlCode = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const iframeRef = ref<HTMLIFrameElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

// ---------- 预览 ----------

function wrapHtml(raw: string): string {
  if (!raw.trim()) return ''
  // 如果已经是完整 HTML 文档，直接返回
  if (/<html[\s>]/i.test(raw) || /<!DOCTYPE/i.test(raw)) return raw
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body { margin: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }</style>
</head>
<body>
${raw}
</body>
</html>`
}

function updatePreview() {
  if (!iframeRef.value) return
  const src = wrapHtml(htmlCode.value)
  iframeRef.value.srcdoc = src
}

function debouncedUpdate() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(updatePreview, 300)
}

watch(htmlCode, debouncedUpdate)

// ---------- 片段插入 ----------

interface InsertResult {
  text: string
  /** 插入后光标相对插入起点的偏移 */
  caret: number
  /** 插入后需要选中的占位文本长度，0 表示不选中 */
  selLen: number
}

interface Snippet {
  label: string
  /** 有选中文本时是否将其包裹进片段（img 包进 src，其余包进内容） */
  wrapable: boolean
  build: (sel: string) => InsertResult
}

const snippets: Snippet[] = [
  {
    label: '图片',
    wrapable: true,
    build: (sel) =>
      sel
        ? { text: `<img src="${sel}">`, caret: sel.length + 10, selLen: 0 }
        : { text: '<img src="">', caret: 10, selLen: 0 }
  },
  {
    label: '链接',
    wrapable: true,
    build: (sel) =>
      sel
        ? { text: `<a href="">${sel}</a>`, caret: sel.length + 15, selLen: 0 }
        : { text: '<a href="">链接文字</a>', caret: 9, selLen: 4 }
  },
  {
    label: '段落',
    wrapable: true,
    build: (sel) =>
      sel
        ? { text: `<p>${sel}</p>`, caret: sel.length + 7, selLen: 0 }
        : { text: '<p>内容</p>', caret: 3, selLen: 2 }
  },
  {
    label: '容器',
    wrapable: true,
    build: (sel) =>
      sel
        ? { text: `<div>${sel}</div>`, caret: sel.length + 11, selLen: 0 }
        : { text: '<div>内容</div>', caret: 5, selLen: 2 }
  },
  {
    label: '列表',
    wrapable: false,
    build: () => ({ text: '<ul>\n  <li>项目一</li>\n  <li>项目二</li>\n</ul>', caret: 11, selLen: 3 })
  },
  {
    label: '表格',
    wrapable: false,
    build: () => ({
      text: '<table border="1">\n  <tr><th>表头</th><th>表头</th></tr>\n  <tr><td>内容</td><td>内容</td></tr>\n</table>',
      caret: 29,
      selLen: 2
    })
  }
]

/**
 * 在光标处插入文本；有选中内容时替换选中内容。
 * caret/selLen 用于插入后把光标（或选中占位符）放到正确的位置。
 */
function insertText(text: string, caret: number, selLen = 0) {
  const ta = textareaRef.value
  if (!ta) {
    // textarea 未挂载（理论不会发生），退化为追加
    htmlCode.value += text
    return
  }
  const start = ta.selectionStart ?? htmlCode.value.length
  const end = ta.selectionEnd ?? start
  htmlCode.value = htmlCode.value.slice(0, start) + text + htmlCode.value.slice(end)
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(start + caret, start + caret + selLen)
  })
}

function insertSnippet(snippet: Snippet) {
  const ta = textareaRef.value
  const sel = snippet.wrapable && ta ? htmlCode.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0) : ''
  const { text, caret, selLen } = snippet.build(sel)
  insertText(text, caret, selLen)
}

// ---------- 粘贴为图片标签 ----------

/** 从剪贴板内容推断图片 src；无法识别时返回 null */
function toImageSrc(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (/^data:image\//i.test(text)) return text
  if (/^data:/i.test(text)) return null // 非 image 的 data URI，不乱包
  if (/^https?:\/\//i.test(text)) return text
  if (/<svg[\s>]/i.test(text)) return 'data:image/svg+xml;utf8,' + encodeURIComponent(text)
  const cleaned = text.replace(/\s+/g, '')
  if (cleaned.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null
  const mime = sniffImageMime(cleaned)
  return mime ? `data:image/${mime};base64,${cleaned}` : null
}

/** 按魔数嗅探裸 Base64 对应的图片格式 */
function sniffImageMime(b64: string): string | null {
  let head: string
  try {
    head = atob(b64.slice(0, 24))
  } catch {
    return null
  }
  const bytes = Array.from(head, (c) => c.charCodeAt(0))
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && head.slice(8, 12) === 'WEBP') return 'webp'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp'
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'ico'
  return null
}

async function pasteAsImg() {
  try {
    const text = await navigator.clipboard.readText()
    const src = toImageSrc(text)
    if (!src) {
      ElMessage.warning({
        message: '无法识别为图片（支持 data:image 前缀 / 图片 URL / 裸 Base64 / SVG 源码）',
        duration: 1600
      })
      return
    }
    insertText(`<img src="${src}">`, src.length + 10, 0)
    ElMessage.success({ message: '已插入图片标签', duration: 800 })
  } catch {
    ElMessage.error({ message: '读取剪贴板失败', duration: 1000 })
  }
}

// ---------- 工具栏 ----------

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      htmlCode.value = text
      ElMessage.success({ message: '已粘贴', duration: 800 })
    }
  } catch {
    ElMessage.error({ message: '读取剪贴板失败', duration: 1000 })
  }
}

function clearAll() {
  htmlCode.value = ''
  if (iframeRef.value) iframeRef.value.srcdoc = ''
}

function downloadHtml() {
  if (!htmlCode.value.trim()) {
    ElMessage.warning({ message: '内容为空', duration: 800 })
    return
  }
  const content = wrapHtml(htmlCode.value)
  const services = (window as any).services
  if (services?.writeTextFile) {
    services.writeTextFile('preview.html', content)
      .then(() => ElMessage.success({ message: '已保存为 preview.html', duration: 800 }))
      .catch(() => fallbackDownload(content))
  } else {
    fallbackDownload(content)
  }
}

function fallbackDownload(content: string) {
  const blob = new Blob([content], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'preview.html'
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success({ message: '已下载', duration: 800 })
}

function refreshPreview() {
  updatePreview()
  ElMessage.success({ message: '已刷新', duration: 800 })
}

onMounted(() => updatePreview())

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="html-preview-tool">
    <h2>HTML 预览</h2>
    <p class="desc">粘贴或输入 HTML 代码，实时预览渲染效果</p>

    <div class="toolbar">
      <el-button size="small" type="primary" @click="pasteFromClipboard">从剪贴板粘贴</el-button>
      <el-button size="small" type="success" plain @click="pasteAsImg">粘贴为图片标签</el-button>
      <el-button size="small" @click="refreshPreview">刷新预览</el-button>
      <el-button size="small" @click="downloadHtml">导出 HTML</el-button>
      <el-button size="small" @click="clearAll">清空</el-button>
    </div>

    <div class="editor-section">
      <div class="section-label">HTML 代码</div>
      <div class="snippet-bar">
        <span class="snippet-label">插入片段</span>
        <!-- mousedown.prevent 保持 textarea 焦点与选中区，点击才不会打断光标位置 -->
        <el-button
          v-for="s in snippets"
          :key="s.label"
          class="snippet-btn"
          size="small"
          @mousedown.prevent
          @click="insertSnippet(s)"
        >{{ s.label }}</el-button>
      </div>
      <textarea
        ref="textareaRef"
        v-model="htmlCode"
        class="code-input"
        placeholder="在此粘贴或输入 HTML 代码..."
        spellcheck="false"
      ></textarea>
    </div>

    <div class="preview-section">
      <div class="section-label">预览</div>
      <div class="preview-wrapper">
        <iframe
          ref="iframeRef"
          class="preview-iframe"
          sandbox="allow-scripts allow-same-origin"
          referrerpolicy="no-referrer"
        ></iframe>
        <div v-if="!htmlCode.trim()" class="preview-placeholder">
          <span>预览区域</span>
          <span class="placeholder-hint">在上方输入 HTML 代码后将在此显示预览</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.html-preview-tool {
  padding: 12px;
  max-width: 600px;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 16px;
  font-size: 13px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 6px;
}

.snippet-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.snippet-label {
  font-size: 12px;
  color: #909399;
}

.snippet-btn.el-button {
  margin-left: 0;
}

.editor-section {
  margin-bottom: 12px;
}

.code-input {
  width: 100%;
  min-height: 160px;
  padding: 12px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  border: 1px solid var(--border-color, #dcdfe6);
  border-radius: 6px;
  background: var(--bg-card, #fff);
  color: var(--text-primary, #333);
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  tab-size: 2;
}

.code-input:focus {
  border-color: #667eea;
}

.code-input::placeholder {
  color: #c0c4cc;
}

.preview-section {
  margin-bottom: 12px;
}

.preview-wrapper {
  position: relative;
  border: 1px solid var(--border-color, #dcdfe6);
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
  min-height: 200px;
}

.preview-iframe {
  width: 100%;
  min-height: 300px;
  border: none;
  display: block;
  background: #fff;
}

.preview-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 14px;
  pointer-events: none;
  gap: 8px;
}

.placeholder-hint {
  font-size: 12px;
}

@media (prefers-color-scheme: dark) {
  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }

  .section-label {
    color: #b0b0b0;
  }

  .snippet-label {
    color: #777;
  }

  .code-input {
    background: #2c2c2c;
    border-color: #444;
    color: #ddd;
  }

  .code-input:focus {
    border-color: #8ba4f7;
  }

  .code-input::placeholder {
    color: #666;
  }

  .preview-wrapper {
    border-color: #444;
  }

  .preview-placeholder {
    color: #666;
  }
}
</style>
