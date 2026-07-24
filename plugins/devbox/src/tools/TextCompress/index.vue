<script lang="ts" setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Warning } from '@element-plus/icons-vue'

const inputText = ref('')
const compressed = ref('')
const removeComments = ref(false)
const keepQuotedSpaces = ref(true)
const lineWidth = ref<number | null>(null)
const snapshotInput = ref('')

const stats = computed(() => {
  if (!compressed.value) return null
  const origLen = snapshotInput.value.length
  const compLen = compressed.value.length
  const origLines = snapshotInput.value.split(/\r?\n/).length
  const resultLines = compressed.value.split('\n').length
  return {
    origLen, compLen, origLines, resultLines,
    savedPct: origLen > 0 ? Math.round((1 - compLen / origLen) * 100) : 0,
  }
})

const PLACEHOLDER_PREFIX = '\x00__ZQUOTED'
const PLACEHOLDER_SUFFIX = '\x00'

function protectQuotedContent(text: string): { result: string; store: string[] } {
  const store: string[] = []
  const P = PLACEHOLDER_PREFIX
  const S = PLACEHOLDER_SUFFIX
  let result = text.replace(/"(?:\\.|[^"\\])*"/g, (m) => { store.push(m); return P + (store.length - 1) + S })
  result = result.replace(/'(?:\\.|[^'\\])*'/g, (m) => { store.push(m); return P + (store.length - 1) + S })
  result = result.replace(/`(?:\\.|[^`\\])*`/g, (m) => { store.push(m); return P + (store.length - 1) + S })
  return { result, store }
}

function restoreQuotedContent(text: string, store: string[]): string {
  const re = new RegExp('\x00__ZQUOTED(\\d+)\x00', 'g')
  return text.replace(re, (_, idx) => store[+idx])
}

function wordWrap(text: string, maxLen: number): string {
  if (maxLen <= 0) return text
  const lines: string[] = []
  while (text.length > maxLen) {
    let breakPoint = text.lastIndexOf(' ', maxLen - 1)
    if (breakPoint === -1) {
      breakPoint = text.indexOf(' ', maxLen)
    }
    if (breakPoint === -1) {
      break
    }
    lines.push(text.slice(0, breakPoint))
    text = text.slice(breakPoint + 1).trimStart()
  }
  if (text) lines.push(text)
  return lines.join('\n')
}

function compress() {
  let text = inputText.value
  if (!text.trim()) {
    compressed.value = ''
    return
  }
  snapshotInput.value = text

  let quoteStore: string[] = []
  if (keepQuotedSpaces.value) {
    const protected_ = protectQuotedContent(text)
    text = protected_.result
    quoteStore = protected_.store
  }

  if (removeComments.value) {
    text = text.replace(/\/\*[\s\S]*?\*\//g, '')
    text = text.replace(/(\/\/|--)[^\n]*/g, '')
  }

  let singleLine = text.replace(/\s+/g, ' ').trim()

  if (keepQuotedSpaces.value && quoteStore.length) {
    singleLine = restoreQuotedContent(singleLine, quoteStore)
  }

  const width = lineWidth.value
  compressed.value = (width && width > 0) ? wordWrap(singleLine, width) : singleLine
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function clearAll() {
  inputText.value = ''
  compressed.value = ''
  snapshotInput.value = ''
}

if ((window as any).ztools?.onPluginEnter) {
  (window as any).ztools.onPluginEnter(() => {
    try { (window as any).ztools.setExpendHeight(600) } catch (_) {}
  })
}
</script>

<template>
  <div class="compress-tool">
    <h2>压缩文本</h2>
    <p class="desc">将多行文本中的空白符（换行、制表符、多余空格）压缩为单个空格</p>

    <div class="input-section">
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="10"
        :autosize="{ minRows: 6, maxRows: 16 }"
        placeholder="在此粘贴多行文本，如 SQL 语句、日志片段等..."
        resize="vertical"
        clearable
      />
    </div>

    <div class="toolbar">
      <div class="toolbar-left">
        <div class="option-row">
          <el-checkbox v-model="keepQuotedSpaces" size="small">保留引号内空格</el-checkbox>
          <span class="option-hint">"hello world" 中的空格不会被压缩</span>
        </div>
        <div class="option-row">
          <el-checkbox v-model="removeComments" size="small">移除代码注释</el-checkbox>
          <el-tooltip placement="top" :show-after="300" content="使用简单正则匹配，无法识别字符串字面量。如 const url = 'http://example.com' 中的 // 可能被误删">
            <el-icon class="warning-icon"><Warning /></el-icon>
          </el-tooltip>
          <span class="option-hint">//、--、/* */</span>
        </div>
        <div class="option-row">
          <span class="lw-label">每行最多</span>
          <el-input-number v-model="lineWidth" :min="1" :max="99999" :step="100" placeholder="不限" size="small" controls-position="right" style="width:110px" />
          <span class="lw-label">字符（在空格处折行）</span>
        </div>
      </div>
      <div class="toolbar-right">
        <el-button size="small" @click="clearAll" :disabled="!inputText && !compressed">清空</el-button>
        <el-button type="primary" size="small" @click="compress" :disabled="!inputText.trim()">压缩</el-button>
      </div>
    </div>

    <div v-if="stats" class="stats-bar">
      <span class="stat">原始：<strong>{{ stats.origLen }}</strong> 字符 · <strong>{{ stats.origLines }}</strong> 行</span>
      <span class="stat">压缩后：<strong>{{ stats.compLen }}</strong> 字符 · <strong>{{ stats.resultLines }}</strong> 行</span>
      <span class="stat saved">节省 {{ stats.savedPct }}%</span>
    </div>

    <div v-if="compressed" class="result-section">
      <div class="result-header">
        <span class="result-label">压缩结果</span>
        <el-button size="small" type="primary" plain @click="copyText(compressed)">复制</el-button>
      </div>
      <div class="result-box">{{ compressed }}</div>
    </div>
  </div>
</template>

<style scoped>
.compress-tool { padding: 12px; max-width: 720px; margin: 0 auto; font-size: 13px; }
h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.desc { color: #909399; margin: 0 0 16px; font-size: 13px; }
.input-section { margin-bottom: 12px; }
.input-section :deep(.el-textarea__inner) { font-family: 'Consolas','Courier New',monospace; font-size: 13px; line-height: 1.5; }
.toolbar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 8px; flex-wrap: wrap; }
.toolbar-left { display: flex; flex-direction: column; gap: 6px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.option-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.option-hint { font-size: 11px; color: #909399; white-space: nowrap; user-select: none; }
.warning-icon { font-size: 13px; color: #e6a23c; cursor: help; }
.lw-label { font-size: 12px; color: #909399; white-space: nowrap; }
.stats-bar { display: flex; gap: 16px; padding: 8px 12px; background: var(--bg-card, #f5f7fa); border-radius: 6px; margin-bottom: 12px; font-size: 12px; color: #606266; flex-wrap: wrap; }
.stat strong { color: #333; }
.saved { color: #67c23a; }
.result-section { background: var(--bg-card, #f5f7ff); border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px; padding: 12px; }
.result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.result-label { font-size: 13px; font-weight: 500; color: #606266; }
.result-box { font-family: 'Consolas','Courier New',monospace; font-size: 13px; line-height: 1.6; word-break: break-all; white-space: pre-wrap; padding: 10px 12px; background: var(--bg-main, #fff); border: 1px solid var(--border-color, #dcdfe6); border-radius: 6px; max-height: 400px; overflow-y: auto; color: var(--text-primary, #333); }

@media (prefers-color-scheme: dark) {
  .stats-bar { background: #2c2c2c; color: #aaa; }
  .stat strong { color: #ddd; }
  .result-section { background: #2c2c2c; border-color: #444; }
  .result-box { background: #1e1e1e; border-color: #444; color: #ddd; }
  .result-label { color: #aaa; }
  .lw-label { color: #8a8a8a; }
  .option-hint { color: #8a8a8a; }
  h2 { color: #e0e0e0; }
  .desc { color: #8a8a8a; }
}
</style>