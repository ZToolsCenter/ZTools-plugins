<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import TableView from './components/TableView.vue'
import QuickRecord from './components/QuickRecord.vue'
import { useStore } from './composables/useStore'
import type { Row } from './types/table'

const store = useStore()
const { tables, meta, ensureBootstrapped, setQuickTableId, createRow, updateTableSchema, reloadRows } = store

const mode = ref<'main' | 'quick'>('main')
const tableRef = ref<InstanceType<typeof TableView> | null>(null)
const prefill = ref('')

ensureBootstrapped()

function onQuickChangeTable(id: string) {
  setQuickTableId(id)
}

function onQuickSave(row: Row) {
  // 单选/多选新选项写回 schema
  const t = tables.value.find((x) => x.id === row.tableId)
  if (t) {
    let changed = false
    for (const f of t.fields) {
      if (f.type !== 'select' && f.type !== 'multi_select') continue
      const v = row.values[f.id]
      const list = Array.isArray(v) ? v : v != null && v !== '' ? [String(v)] : []
      for (const opt of list) {
        if (opt && !f.options.includes(opt)) {
          f.options.push(opt)
          changed = true
        }
      }
    }
    if (changed) updateTableSchema({ ...t, fields: [...t.fields] })
  }
  createRow(row.tableId, row.values)
  ElMessage.success('已保存')
}

onMounted(() => {
  const ztools = (window as any).ztools
  if (!ztools) return
  ztools.onPluginEnter((action: { code?: string; payload?: unknown }) => {
    const code = action?.code ?? ''
    const text = typeof action?.payload === 'string' ? action.payload.trim() : ''
    prefill.value = text && text.length <= 40 ? text : ''
    if (code === 'new-row') {
      mode.value = 'quick'
      try {
        ztools.setExpendHeight?.(560)
      } catch {
        // ignore
      }
      return
    }
    mode.value = 'main'
    // 每次进主界面从存储重读，覆盖「记一笔」后进程被杀/缓存不一致
    ensureBootstrapped()
    reloadRows()
    try {
      ztools.setExpendHeight?.(620)
    } catch {
      // ignore
    }
    tableRef.value?.applyEnterAction(code, action?.payload)
  })
})
</script>

<template>
  <QuickRecord
    v-if="mode === 'quick'"
    :tables="tables"
    :quick-table-id="meta.quickTableId || tables[0]?.id || ''"
    :prefill-text="prefill"
    @change-table="onQuickChangeTable"
    @save="onQuickSave"
  />
  <TableView v-else ref="tableRef" />
</template>
