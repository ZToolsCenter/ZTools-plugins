<script setup lang="ts">
import { ref, watch } from 'vue'
import { parseMarkdownTable, type TableData } from '../utils/md-table'

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
  const result = parseMarkdownTable(inputText.value)
  if (!result) {
    errorMsg.value = '未能识别有效的 Markdown 表格，请检查输入格式（需要包含 | 分隔的表格行）'
    tableData.value = null
    return
  }
  tableData.value = result
}

/** 将表格数据转为 TSV 文本（可直接粘贴到 Excel） */
function tableToTSV(data: TableData): string {
  const allRows = [data.headers, ...data.rows]
  return allRows.map((row) => row.join('\t')).join('\n')
}

async function copyTable() {
  if (!tableData.value) return
  const tsv = tableToTSV(tableData.value)
  try {
    await navigator.clipboard.writeText(tsv)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = tsv
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
  <div class="mte-root">
    <!-- 顶部导航 -->
    <div class="mte-nav">
      <span class="mte-nav-here">📝 → 📋 Markdown → 表格</span>
      <span class="mte-nav-link" @click="goTo('excel-to-md')">📋 → 📝 表格 → Markdown</span>
    </div>

    <div class="mte-input-area">
      <label class="mte-label">粘贴 Markdown 表格：</label>
      <textarea
        v-model="inputText"
        class="mte-textarea"
        placeholder="在此粘贴 Markdown 表格，例如：&#10;| 姓名 | 年龄 | 城市 |&#10;|------|------|------|&#10;| 张三 | 28 | 北京 |&#10;| 李四 | 35 | 上海 |"
        rows="8"
      ></textarea>
      <button class="mte-btn" :disabled="!inputText.trim()" @click="doParse">转换</button>
    </div>

    <div v-if="errorMsg" class="mte-error">{{ errorMsg }}</div>

    <div v-if="tableData" class="mte-result">
      <div class="mte-result-header">
        <span class="mte-result-title">转换结果</span>
        <button class="mte-copy-btn" @click="copyTable">
          {{ copySuccess ? '✅ 已复制' : '📋 复制全部' }}
        </button>
      </div>
      <div class="mte-table-wrap">
        <table class="mte-table">
          <thead>
            <tr>
              <th v-for="(header, i) in tableData.headers" :key="'h-' + i">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in tableData.rows" :key="'r-' + ri">
              <td v-for="(cell, ci) in row" :key="'c-' + ri + '-' + ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style>
.mte-root {
  padding: 0;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.mte-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-bottom: 1px solid #e0e0e0;
  font-size: 13px;
  flex-shrink: 0;
}

.mte-nav-here {
  font-weight: bold;
  color: var(--blue);
}

.mte-nav-link {
  color: #999;
  cursor: pointer;
  transition: color 0.15s;
}

.mte-nav-link:hover {
  color: var(--blue);
}

.mte-input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 20px 0 20px;
}

.mte-label {
  font-weight: bold;
  font-size: 14px;
}

.mte-textarea {
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #ccc;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
}

.mte-btn {
  align-self: flex-start;
  padding: 6px 24px;
  border-radius: 4px;
  font-size: 14px;
}

.mte-error {
  color: #e74c3c;
  margin: 12px 20px 0 20px;
  font-size: 13px;
}

.mte-result {
  margin: 20px 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mte-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.mte-result-title {
  font-weight: bold;
  font-size: 14px;
}

.mte-copy-btn {
  padding: 4px 16px;
  border-radius: 4px;
  font-size: 13px;
}

.mte-table-wrap {
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 6px;
}

.mte-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

.mte-table th,
.mte-table td {
  border: 1px solid #ddd;
  padding: 6px 12px;
  text-align: left;
  white-space: nowrap;
}

.mte-table th {
  background-color: #f0f0f0;
  font-weight: bold;
  position: sticky;
  top: 0;
}

.mte-table tr:nth-child(even) td {
  background-color: #fafafa;
}

@media (prefers-color-scheme: dark) {
  .mte-nav {
    border-bottom-color: #555;
  }
  .mte-nav-link { color: #aaa; }
  .mte-nav-link:hover { color: var(--blue); }
  .mte-textarea {
    background-color: #424242;
    color: #fff;
    border-color: #555;
  }
  .mte-table-wrap { border-color: #555; }
  .mte-table th { background-color: #555; }
  .mte-table td { border-color: #555; }
  .mte-table tr:nth-child(even) td { background-color: #4a4a4a; }
}
</style>
