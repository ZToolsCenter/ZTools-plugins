<template>
  <div class="app">
    <div class="toolbar">
      <n-space :size="8" align="center">
        <n-button size="small" @click="clear">清空</n-button>
        <n-button type="primary" size="small" @click="getClipboardContent">解析粘贴板</n-button>
        <n-tooltip trigger="hover" placement="right">
          <template #trigger>
            <n-icon style="cursor: pointer" @click="previewImage"><Icon icon="icon-park-outline:help" /></n-icon>
          </template>
          查看示例图
        </n-tooltip>
      </n-space>
      <n-image
        :src="excelToSqlImg"
        :preview-src="excelToSqlImg"
        ref="previewImageRef"
        style="position: fixed; top: -9999px; left: -9999px"
      />
    </div>

    <div class="dataArea" v-if="loading">
      <n-spin :description="'解析中...'" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center" />
    </div>

    <div class="dataArea" v-else-if="tableData && tableData.length">
      <div class="table-wrapper">
        <div class="table-container">
          <vxe-table
            ref="dataTableRef"
            border
            :data="currentPageData"
            size="mini"
            height="100%"
            :column-config="{ drag: true }"
            :seq-config="{ startIndex: (currentPage - 1) * pageSize }"
            @column-dragend="handleColumnDragend"
          >
            <vxe-column type="seq" title="#" width="50" fixed="left"></vxe-column>
            <vxe-column
              v-for="column in columns"
              :key="column.prop"
              :field="column.prop"
              :title="column.label"
            >
              <template #default="{ row }">
                {{ row[column.prop] }}
              </template>
            </vxe-column>
          </vxe-table>
        </div>
        <n-pagination
          size="small"
          :page="currentPage"
          :page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          show-size-picker
          :item-count="tableData.length"
          @update:page="currentPage = $event"
          @update:page-size="pageSize = $event; currentPage = 1"
        >
          <template #prefix="{ itemCount }">共 {{ itemCount }} 条</template>
        </n-pagination>
      </div>
    </div>

    <div class="dataArea" v-else>
      <n-upload
        class="excel-upload"
        :default-upload="false"
        :show-file-list="false"
        accept=".xlsx,.xls,.csv"
        @change="handleFileChange"
        directory-dnd
        style="height: 100%"
      >
        <n-upload-dragger style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center">
          <n-icon size="48" :depth="3"><Icon icon="icon-park-outline:upload-two" /></n-icon>
          <n-text style="font-size: 16px; margin-top: 8px">
            将文件拖到此处，或
            <n-gradient-text type="info" style="font-size: 20px;">
            点击上传
            </n-gradient-text>
          </n-text>
          <n-p depth="3" style="margin: 8px 0 0 0">
            支持 .xlsx、.xls、.csv 格式
          </n-p>
        </n-upload-dragger>
      </n-upload>
    </div>

    <div class="resultArea">
      <div class="resultAreaForm">
        <n-space :size="8" :wrap="true" align="center">
          <n-input v-model:value="formData.tableName" clearable placeholder="请输入表名" size="small" style="width: 150px" :disabled="!tableData" />
          <n-radio-group v-model:value="formData.sqlType" size="small">
            <n-radio-button value="insert">新增</n-radio-button>
            <n-radio-button value="update">修改</n-radio-button>
          </n-radio-group>
          <n-select
            v-if="formData.sqlType === 'update'"
            v-model:value="formData.primaryKey"
            multiple
            clearable
            size="small"
            :options="primaryKeyOptions"
            placeholder="选择主键"
            style="width: 150px"
          />
          <n-button size="small" :disabled="!tableData" @click="columnConfigVisible = true">字段配置</n-button>
          <n-button type="primary" size="small" :disabled="!tableData" @click="generateSql">生成SQL</n-button>
          <n-button v-if="sqlStr" type="success" size="small" @click="copyText">复制</n-button>
        </n-space>
      </div>

      <div class="resultBox">
        <CodeEditor ref="codeEditorRef" v-model="sqlStr" mode="sql" />
      </div>
    </div>

    <n-modal v-model:show="columnConfigVisible" title="字段配置" preset="card" style="width: 500px">
      <vxe-table :data="columnConfigTableData" border size="mini" height="400">
        <vxe-column field="columnName" title="字段名"></vxe-column>
        <vxe-column title="空字符串转NULL" align="center">
          <template #default="{ row }">
            <n-checkbox v-model:checked="row.emptyToNull" />
          </template>
        </vxe-column>
      </vxe-table>
      <template #footer>
        <n-button @click="columnConfigVisible = false">关闭</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { Icon } from '@iconify/vue'
import CodeEditor from '@/components/CodeEditor.vue'
import NotifyUtil from '@/utils/notifyUtil.js'
import excelToSqlImg from '@/assets/image/excel转sql.png'

let listSheetsFn = null
let batchAsyncFn = null
let wasmReady = false

async function ensureWasm() {
  if (wasmReady) return
  const mod = await import('xlsx-fire/sheetx.js')
  if (typeof mod.default === 'function') {
    try {
      const wasmUrl = (await import('xlsx-fire/sheetx_bg.wasm?url')).default
      await mod.default(wasmUrl)
    } catch {
      await mod.default()
    }
  }
  listSheetsFn = mod.list_sheets
  batchAsyncFn = mod.xlsx_batch_async
  wasmReady = true
}

const loading = ref(false)
const columns = ref(null)
const tableData = ref(null)
const currentPage = ref(1)
const pageSize = ref(100)
const sqlStr = ref(null)
const primaryKeyOptions = ref([])
const columnConfigVisible = ref(false)
const columnConfigTableData = ref([])
const codeEditorRef = ref(null)
const dataTableRef = ref(null)
const previewImageRef = ref(null)

const formData = reactive({
  tableName: '',
  sqlType: 'insert',
  primaryKey: []
})

const currentPageData = computed(() => {
  if (!tableData.value) return []
  const start = (currentPage.value - 1) * pageSize.value
  return tableData.value.slice(start, start + pageSize.value)
})

function previewImage() {
  previewImageRef.value?.click()
}

function handleFileChange({ file }) {
  parseFile(file.file)
}

async function parseFile(file) {
  const fileName = file.name.toLowerCase()
  if (fileName.endsWith('.csv')) {
    parseCsvFile(file)
    return
  }
  if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
    NotifyUtil.error('格式错误', '仅支持 .xlsx、.xls、.csv 格式文件')
    return
  }
  loading.value = true
  try {
    await ensureWasm()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { sheets } = listSheetsFn(bytes)
    if (!sheets || !sheets.length) {
      NotifyUtil.error('解析失败', '文件内容为空')
      return
    }
    const batchSize = 5000
    let start = 0
    let headerRow = null
    let headers = null
    let allRows = []
    while (true) {
      const res = await batchAsyncFn(bytes, sheets[0], start, batchSize)
      if (!res.rows || res.rows.length === 0) break
      if (start === 0) {
        headerRow = res.rows[0]
        headers = headerRow.map(col => ({ prop: String(col ?? '').trim(), label: String(col ?? '').trim() }))
        primaryKeyOptions.value = headerRow.map(col => ({ value: String(col ?? '').trim(), label: String(col ?? '').trim() }))
        columnConfigTableData.value = headers.map(h => ({ columnName: h.prop, emptyToNull: false }))
        columns.value = headers
        allRows = allRows.concat(res.rows.slice(1))
      } else {
        allRows = allRows.concat(res.rows)
      }
      if (res.rows.length < batchSize) break
      start += res.rows.length
    }
    tableData.value = Object.freeze(allRows
      .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
      .map(row => {
        const entry = {}
        headers.forEach((header, index) => {
          entry[header.prop] = row[index] !== undefined && row[index] !== null ? String(row[index]) : ''
        })
        return entry
      }))
    if (!tableData.value.length) {
      NotifyUtil.error('解析失败', '文件内容为空或仅有表头')
      return
    }
    currentPage.value = 1
    NotifyUtil.success('解析成功', `已解析 ${tableData.value.length} 条数据`)
  } catch (error) {
    console.error('解析文件失败:', error)
    NotifyUtil.error('解析失败', '文件内容格式不正确，请检查文件')
  } finally {
    loading.value = false
  }
}

function parseCsvFile(file) {
  loading.value = true
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const text = e.target.result
      columns.value = getHeaderJson(text)
      tableData.value = Object.freeze(getDataJson(text))
      if (!tableData.value || !tableData.value.length) {
        NotifyUtil.error('解析失败', '文件内容为空或仅有表头')
        return
      }
      NotifyUtil.success('解析成功', `已解析 ${tableData.value.length} 条数据`)
    } catch (err) {
      console.error('解析CSV失败:', err)
      NotifyUtil.error('解析失败', '文件内容格式不正确')
    } finally {
      loading.value = false
    }
  }
  reader.onerror = () => {
    NotifyUtil.error('读取失败', '文件读取失败')
    loading.value = false
  }
  reader.readAsText(file)
}

function parseClipboardText(text) {
  const rows = []
  let currentRow = []
  let currentCell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentCell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentCell += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === '\t') {
        currentRow.push(currentCell.trim())
        currentCell = ''
      } else if (char === '\r') {
        continue
      } else if (char === '\n') {
        currentRow.push(currentCell.trim())
        currentCell = ''
        if (currentRow.some(cell => cell !== '')) {
          rows.push(currentRow)
        }
        currentRow = []
      } else {
        currentCell += char
      }
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim())
    if (currentRow.some(cell => cell !== '')) {
      rows.push(currentRow)
    }
  }

  return rows
}

function getClipboardContent() {
  loading.value = true
  navigator.clipboard.readText().then(text => {
    const rows = parseClipboardText(text)
    if (!rows.length) {
      NotifyUtil.error('解析失败', '剪贴板内容为空')
      loading.value = false
      return
    }

    const headerCells = rows[0]
    const headers = headerCells.map(col => ({ prop: col, label: col }))
    primaryKeyOptions.value = headerCells.map(col => ({ value: col, label: col }))
    columnConfigTableData.value = headers.map(h => ({ columnName: h.prop, emptyToNull: false }))
    columns.value = headers

    const dataRows = rows.slice(1)
    tableData.value = Object.freeze(dataRows.map(row => {
      const entry = {}
      headers.forEach((header, index) => {
        entry[header.prop] = row[index] !== undefined ? row[index] : ''
      })
      return entry
    }).filter(entry => Object.values(entry).some(val => val !== '' && val !== undefined && val !== null)))

    currentPage.value = 1
    NotifyUtil.success('解析成功', `已解析 ${tableData.value.length} 条数据`)
    loading.value = false
  }).catch(error => {
    console.error('解析剪贴板内容失败:', error)
    NotifyUtil.error('解析失败', '剪贴板内容格式不正确，请重新复制内容')
    loading.value = false
  })
}

function clear() {
  columns.value = null
  tableData.value = null
  currentPage.value = 1
  sqlStr.value = null
  formData.tableName = ''
  formData.primaryKey = []
  columnConfigTableData.value = []
}

function isEmptyToNull(columnName) {
  const config = columnConfigTableData.value.find(c => c.columnName === columnName)
  return config ? config.emptyToNull : false
}

function generateSql() {
  if (formData.sqlType === 'insert') {
    generateInsertSql()
  } else if (formData.sqlType === 'update') {
    if (!formData.primaryKey.length) {
      NotifyUtil.error('错误', '请选择主键')
      return
    }
    generateUpdateSql()
  }
}

function toSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function toSqlValue(value, emptyToNull = false) {
  if (emptyToNull && (value === '' || value === undefined || value === null)) return 'NULL'
  if (typeof value === 'string') return toSqlString(value)
  return value
}

function generateInsertSql() {
  let tableNameStr = formData.tableName || 'table_name'
  const cols = columns.value.map(c => c.prop)
  const batchSize = 500
  let sqlStatements = []
  for (let i = 0; i < tableData.value.length; i += batchSize) {
    const batch = tableData.value.slice(i, i + batchSize)
    const valuesList = batch.map(row => {
      const values = cols.map(column => {
        const value = row[column]
        return toSqlValue(value, isEmptyToNull(column))
      })
      return `(${values.join(', ')})`
    })
    sqlStatements.push(`INSERT INTO ${tableNameStr} (${cols.join(', ')}) VALUES\n${valuesList.join(',\n')};`)
  }
  sqlStr.value = sqlStatements.join('\n')
}

function generateUpdateSql() {
  let primaryKey = formData.primaryKey
  let sqlStatements = []
  for (const row of tableData.value) {
    let tableNameStr = formData.tableName || 'table_name'
    let sql = `UPDATE ${tableNameStr} SET `
    columns.value.forEach(col => {
      const key = col.prop
      if (!primaryKey.includes(key)) {
        sql += key + "=" + toSqlValue(row[key], isEmptyToNull(key)) + ", "
      }
    })
    sql = sql.slice(0, -2)
    sql += " WHERE "
    primaryKey.forEach(key => {
      sql += key + "=" + toSqlValue(row[key], isEmptyToNull(key)) + " AND "
    })
    sql = sql.slice(0, -4) + ";"
    sqlStatements.push(sql)
  }
  sqlStr.value = sqlStatements.join('\n')
}

function copyText() {
  if (!sqlStr.value) return
  codeEditorRef.value?.selectAll()
  navigator.clipboard.writeText(sqlStr.value)
  NotifyUtil.success('复制成功')
}

function handleColumnDragend() {
  const $table = dataTableRef.value
  if (!$table) return
  const { collectColumn } = $table.getTableColumn()
  const fieldNames = collectColumn
    .filter(col => col.field)
    .map(col => col.field)
  const reordered = []
  fieldNames.forEach(name => {
    const col = columns.value.find(c => c.prop === name)
    if (col) reordered.push(col)
  })
  if (reordered.length === columns.value.length) {
    columns.value.splice(0, columns.value.length, ...reordered)
  }
}
</script>

<style scoped>
.toolbar {
  flex-shrink: 0;
  margin-bottom: 10px;
}

.dataArea {
  flex-shrink: 0;
  height: 40%;
  min-height: 120px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.dataArea .table-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 10px;
}

.dataArea .table-container {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.resultArea {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.resultAreaForm {
  margin: 10px 0;
}

.resultBox {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.excel-upload :deep(.n-upload-trigger) {
  height: 100%;
}
</style>
