<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FieldValue, Row, TableSchema } from '../types/table'
import { addFieldOptions } from '../domain/fieldTypes'
import { checkIncomingRows, type IncomingCheck } from '../domain/constraints'
import {
  autoColumnMap,
  mapRowValues,
  parseImportText
} from '../domain/codec/tableCodec'
import { generateId } from '../utils/id'
import { useStore } from '../composables/useStore'

const props = defineProps<{
  visible: boolean
  table: TableSchema
  multiSeparator: string
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const store = useStore()

const rawText = ref('')
const headers = ref<string[]>([])
const dataRows = ref<string[][]>([])
const columnMap = ref<Record<number, string | null>>({})
const parsed = ref(false)
const importing = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      rawText.value = ''
      headers.value = []
      dataRows.value = []
      columnMap.value = {}
      parsed.value = false
      importing.value = false
    }
  }
)

function parseNow() {
  const result = parseImportText(rawText.value)
  if (!result.headers.length) {
    ElMessage.warning('没有识别到表头，请粘贴带表头的表格文本')
    parsed.value = false
    return
  }
  headers.value = result.headers
  dataRows.value = result.dataRows
  columnMap.value = autoColumnMap(props.table.fields, result.headers)
  parsed.value = true
  ElMessage.success(`识别到 ${result.dataRows.length} 行、${result.headers.length} 列`)
}

const fieldOptions = computed(() =>
  props.table.fields.map((f) => ({ label: f.name, value: f.id }))
)

/** 每行映射后的字段值：预览和导入共用，避免重复跑 mapRowValues */
const incomingValues = computed<Array<Record<string, FieldValue>>>(() =>
  dataRows.value.map((cells) =>
    mapRowValues(props.table.fields, headers.value, cells, columnMap.value)
  )
)

/** 导入前的约束校验：必填缺失 / 与存量或本批次内重复 */
const check = computed<IncomingCheck | null>(() => {
  if (!parsed.value || !dataRows.value.length) return null
  return checkIncomingRows(props.table.fields, incomingValues.value, store.activeRows.value)
})

const badRowCount = computed(() => (check.value ? check.value.rowIssues.filter(Boolean).length : 0))

const previewRows = computed(() => {
  return incomingValues.value.slice(0, 5).map((values) =>
    props.table.fields.map((f) => {
      const v = values[f.id]
      if (Array.isArray(v)) return v.join(props.multiSeparator)
      if (v == null) return ''
      return String(v)
    })
  )
})

/** 预览里某行不合规的原因（悬停提示） */
function rowIssueText(index: number): string {
  const issues = check.value?.rowIssues[index]
  return issues ? issues.map((issue) => issue.message).join('；') : ''
}

/** 直接走 store.bulk：420 行也只 ~2 IPC，避免主线程卡半分钟 */
async function confirmImport() {
  if (importing.value) return
  if (!parsed.value || !dataRows.value.length) return
  const result = check.value
  const okIndexes = result?.okIndexes ?? []
  const skipped = dataRows.value.length - okIndexes.length
  if (!okIndexes.length) {
    ElMessage.warning('所有行都不符合字段约束，没有可导入的数据')
    return
  }
  if (skipped > 0) {
    try {
      await ElMessageBox.confirm(
        `共 ${dataRows.value.length} 行：符合约束 ${okIndexes.length} 行，另有 ${skipped} 行会被跳过（必填缺失 ${result!.requiredRows} 行、重复 ${result!.duplicateRows} 行）。继续导入这 ${okIndexes.length} 行？`,
        '约束校验',
        {
          type: 'warning',
          confirmButtonText: `导入 ${okIndexes.length} 行`,
          cancelButtonText: '取消'
        }
      )
    } catch {
      return
    }
  }
  importing.value = true
  const now = Date.now()
  const incoming: Row[] = okIndexes.map((rowIndex, i) => ({
    id: generateId('row'),
    tableId: props.table.id,
    values: incomingValues.value[rowIndex],
    createdAt: now + i,
    updatedAt: now + i
  }))
  const merged = [...store.activeRows.value, ...incoming]
  try {
    await store.replaceRows(props.table.id, merged)
    // 导入时把单选/多选新值收进字段选项，便于后续复用
    let schemaChanged = false
    const table = props.table
    for (const f of table.fields) {
      for (const row of incoming) {
        if (addFieldOptions(f, row.values[f.id])) schemaChanged = true
      }
    }
    if (schemaChanged) store.updateTableSchema({ ...table, fields: [...table.fields] })
    ElMessage.success(
      skipped > 0 ? `已导入 ${incoming.length} 行，跳过 ${skipped} 行` : `已导入 ${incoming.length} 行`
    )
    emit('update:visible', false)
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

async function pasteFromClipboard() {
  if (importing.value) return
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      rawText.value = text
      parseNow()
      return
    }
  } catch {
    // fall through
  }
  ElMessage.warning('无法读取剪贴板，请手动粘贴到文本框')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :close-on-click-modal="!importing"
    :close-on-press-escape="!importing"
    :show-close="!importing"
    title="导入 CSV / TSV"
    width="720px"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <p class="hint">
      粘贴从 Excel 复制的内容，或 CSV/TSV 文本（第一行为表头）。多值字段按「、 ， , |」拆分。
    </p>
    <div class="toolbar">
      <el-button size="small" :disabled="importing" @click="pasteFromClipboard">从剪贴板粘贴</el-button>
      <el-button size="small" type="primary" :disabled="importing || !rawText.trim()" @click="parseNow">
        解析
      </el-button>
    </div>
    <el-input
      v-model="rawText"
      type="textarea"
      :rows="8"
      :disabled="importing"
      placeholder="pm号	模块	标签	笔记链接&#10;#125189	成绩管理	v1、成绩录入	"
    />
    <template v-if="parsed">
      <h4 class="sec">列映射</h4>
      <div class="map-grid">
        <div v-for="(h, i) in headers" :key="i" class="map-item">
          <span class="src">{{ h || `列${i + 1}` }}</span>
          <span class="arrow">→</span>
          <el-select v-model="columnMap[i]" size="small" style="width: 140px" :disabled="importing">
            <el-option label="忽略" :value="null" />
            <el-option
              v-for="opt in fieldOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
      </div>
      <h4 class="sec">预览（前 {{ previewRows.length }} 行）</h4>
      <p v-if="check" class="check-tip" :class="{ ok: !badRowCount }">
        <template v-if="badRowCount">
          ⚠ {{ badRowCount }} 行不符合约束：必填缺失 {{ check.requiredRows }} 行、重复
          {{ check.duplicateRows }} 行（导入时跳过）
        </template>
        <template v-else>✓ {{ dataRows.length }} 行全部通过约束校验</template>
      </p>
      <div class="preview-wrap">
        <table class="preview">
          <thead>
            <tr>
              <th v-for="f in table.fields" :key="f.id">{{ f.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in previewRows"
              :key="i"
              :class="{ bad: check?.rowIssues[i] }"
              :title="rowIssueText(i)"
            >
              <td v-for="(c, j) in r" :key="j">{{ c }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <template #footer>
      <span class="count">共 {{ dataRows.length }} 行</span>
      <el-button :disabled="importing" @click="emit('update:visible', false)">取消</el-button>
      <el-button
        type="primary"
        :loading="importing"
        :disabled="!parsed || !dataRows.length || !check?.okIndexes.length"
        @click="confirmImport"
      >
        {{ importing ? '导入中…' : `导入 ${check?.okIndexes.length ?? dataRows.length} 行` }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.toolbar {
  margin-bottom: 8px;
  display: flex;
  gap: 8px;
}
.sec {
  margin: 14px 0 8px;
  font-size: 13px;
}
.map-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.map-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.src {
  width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arrow {
  color: var(--el-text-color-secondary);
}
.preview-wrap {
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  max-height: 180px;
}
.preview {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}
.preview th,
.preview td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 6px 8px;
  text-align: left;
  white-space: nowrap;
}
.preview tr.bad td {
  background: var(--el-color-danger-light-9);
}
.check-tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
.check-tip.ok {
  color: var(--el-color-success);
}
.count {
  float: left;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 32px;
}
</style>
