<script lang="ts" setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const htmlCode = ref('')
const iframeRef = ref<HTMLIFrameElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

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
      <el-button size="small" @click="refreshPreview">刷新预览</el-button>
      <el-button size="small" @click="downloadHtml">导出 HTML</el-button>
      <el-button size="small" @click="clearAll">清空</el-button>
    </div>

    <div class="editor-section">
      <div class="section-label">HTML 代码</div>
      <textarea
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
