<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { parseExcelPaste, type TableData } from '../utils/excel-paste'

const props = defineProps({
  enterAction: { type: Object, required: true }
})

const emit = defineEmits<{
  navigate: [code: string]
}>()

const inputText = ref('')
const tableData = ref<TableData | null>(null)
const errorMsg = ref('')
const copySuccess = ref(false)

const markdownText = computed(() => {
  if (!tableData.value) return ''
  const { headers, rows } = tableData.value
  const lines: string[] = []
  lines.push('| ' + headers.join(' | ') + ' |')
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |')
  for (const row of rows) {
    const cells = headers.map((_, i) => (i < row.length ? row[i] : ''))
    lines.push('| ' + cells.join(' | ') + ' |')
  }
  return lines.join('\n')
})

watch(
  () => props.enterAction,
  (action: any) => {
    if (action.type === 'over' && action.payload) {
      inputText.value = action.payload
      doParse()
    }
  },
  { immediate: true }
)

function doParse() {
  errorMsg.value = ''
  copySuccess.value = false
  const result = parseExcelPaste(inputText.value)
  if (!result) {
    errorMsg.value = '未能解析输入内容，请确保是从 Excel 复制的内容（Tab 分隔）'
    tableData.value = null
    return
  }
  tableData.value = result
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(markdownText.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = markdownText.value
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copySuccess.value = true
  setTimeout(() => { copySuccess.value = false }, 2000)
}

function goTo(to: string) {
  emit('navigate', to)
}
</script>

<template>
  <div class="etm-root">
    <!-- 顶部导航 -->
    <div class="etm-nav">
      <span class="etm-nav-link" @click="goTo('md-to-excel')">📝 → 📋 Markdown → 表格</span>
      <span class="etm-nav-here">📋 → 📝 表格 → Markdown</span>
    </div>

    <div class="etm-input-area">
      <label class="etm-label">粘贴 Excel 复制的内容：</label>
      <textarea
        v-model="inputText"
        class="etm-textarea"
        placeholder="在 Excel 中选中表格范围 Ctrl+C，然后在此粘贴"
        rows="8"
      ></textarea>
      <button class="etm-btn" :disabled="!inputText.trim()" @click="doParse">转换</button>
    </div>

    <div v-if="errorMsg" class="etm-error">{{ errorMsg }}</div>

    <div v-if="tableData" class="etm-result">
      <div class="etm-result-header">
        <span class="etm-result-title">Markdown 表格源码</span>
        <button class="etm-copy-btn" @click="copyToClipboard">
          {{ copySuccess ? '✅ 已复制' : '📋 复制' }}
        </button>
      </div>
      <pre class="etm-md-preview">{{ markdownText }}</pre>

      <div class="etm-result-header" style="margin-top:20px;">
        <span class="etm-result-title">渲染预览</span>
      </div>
      <div class="etm-table-wrap">
        <table class="etm-table">
          <thead>
            <tr>
              <th v-for="(header, i) in tableData.headers" :key="'h-' + i">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in tableData.rows" :key="'r-' + ri">
              <td v-for="(cell, ci) in tableData.headers.map((_, idx) => (idx < row.length ? row[idx] : ''))" :key="'c-' + ri + '-' + ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style>
.etm-root {
  padding: 0;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.etm-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-bottom: 1px solid #e0e0e0;
  font-size: 13px;
  flex-shrink: 0;
}

.etm-nav-here {
  font-weight: bold;
  color: var(--blue);
}

.etm-nav-link {
  color: #999;
  cursor: pointer;
  transition: color 0.15s;
}

.etm-nav-link:hover {
  color: var(--blue);
}

.etm-input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 20px 0 20px;
}

.etm-label {
  font-weight: bold;
  font-size: 14px;
}

.etm-textarea {
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #ccc;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
}

.etm-btn {
  align-self: flex-start;
  padding: 6px 24px;
  border-radius: 4px;
  font-size: 14px;
}

.etm-error {
  color: #e74c3c;
  margin: 12px 20px 0 20px;
  font-size: 13px;
}

.etm-result {
  margin: 20px 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.etm-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.etm-result-title {
  font-weight: bold;
  font-size: 14px;
}

.etm-copy-btn {
  padding: 4px 16px;
  border-radius: 4px;
  font-size: 13px;
}

.etm-md-preview {
  background-color: #fff;
  padding: 16px;
  border-radius: 6px;
  border: 1px solid #ddd;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  overflow: auto;
  margin: 0;
  max-height: 200px;
}

.etm-table-wrap {
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 6px;
}

.etm-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

.etm-table th,
.etm-table td {
  border: 1px solid #ddd;
  padding: 6px 12px;
  text-align: left;
  white-space: nowrap;
}

.etm-table th {
  background-color: #f0f0f0;
  font-weight: bold;
  position: sticky;
  top: 0;
}

.etm-table tr:nth-child(even) td {
  background-color: #fafafa;
}

@media (prefers-color-scheme: dark) {
  .etm-nav { border-bottom-color: #555; }
  .etm-nav-link { color: #aaa; }
  .etm-nav-link:hover { color: var(--blue); }
  .etm-textarea {
    background-color: #424242;
    color: #fff;
    border-color: #555;
  }
  .etm-md-preview {
    background-color: #424242;
    color: #fff;
    border-color: #555;
  }
  .etm-table-wrap { border-color: #555; }
  .etm-table th { background-color: #555; }
  .etm-table td { border-color: #555; }
  .etm-table tr:nth-child(even) td { background-color: #4a4a4a; }
}
</style>