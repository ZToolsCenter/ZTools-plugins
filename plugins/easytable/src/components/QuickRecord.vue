<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FieldDef, FieldValue, Row, TableSchema } from '../types/table'
import { defaultValue, initialFieldDefault } from '../domain/fieldTypes'
import { hasOptions } from '../types/table'
import { generateId } from '../utils/id'

const props = defineProps<{
  tables: TableSchema[]
  quickTableId: string
  prefillText?: string
}>()

const emit = defineEmits<{
  (e: 'change-table', id: string): void
  (e: 'save', row: Row): void
}>()

const tableId = ref(props.quickTableId || props.tables[0]?.id || '')
const form = reactive<Record<string, FieldValue>>({})

const table = computed(
  () => props.tables.find((t) => t.id === tableId.value) ?? props.tables[0] ?? null
)

function fill() {
  const t = table.value
  Object.keys(form).forEach((k) => delete form[k])
  if (!t) return
  for (const f of t.fields) {
    form[f.id] = initialFieldDefault(f)
  }
  if (props.prefillText) {
    const target = t.fields.find((f) => f.type === 'text')
    if (target) form[target.id] = props.prefillText
  }
}

watch(
  () => [tableId.value, props.prefillText],
  () => {
    fill()
  },
  { immediate: true }
)

watch(
  () => props.quickTableId,
  (id) => {
    if (id && props.tables.some((t) => t.id === id)) tableId.value = id
  }
)

function onTableChange(id: string) {
  tableId.value = id
  emit('change-table', id)
  fill()
}

function multiValue(f: FieldDef): string[] {
  const v = form[f.id]
  return Array.isArray(v) ? v : []
}

function addOption(f: FieldDef, raw: string | number | undefined) {
  if (!hasOptions(f)) return
  const s = String(raw ?? '')
  if (!s || f.options.includes(s)) return
  f.options.push(s)
}

function save() {
  const t = table.value
  if (!t) {
    ElMessage.warning('请先选择表格')
    return
  }
  const now = Date.now()
  const values: Record<string, FieldValue> = {}
  for (const f of t.fields) values[f.id] = form[f.id] ?? defaultValue(f.type)
  emit('save', {
    id: generateId('row'),
    tableId: t.id,
    values,
    createdAt: now,
    updatedAt: now
  })
  fill()
}

function cancel() {
  fill()
  try {
    ;(window as any).ztools?.hideMainWindow?.()
  } catch {
    // ignore
  }
}
</script>

<template>
  <div class="quick">
    <div class="quick-head">
      <span class="title">记一笔</span>
      <el-select
        :model-value="tableId"
        placeholder="选择表格"
        size="small"
        style="width: 160px"
        @update:model-value="(v: string | number) => onTableChange(String(v))"
      >
        <el-option v-for="t in tables" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>
    </div>

    <el-empty v-if="!table" description="还没有表格，请先在主界面新建" />

    <el-form
      v-else
      label-width="88px"
      label-position="left"
      class="quick-form"
      @submit.prevent="save"
    >
      <el-form-item v-for="f in table.fields" :key="f.id" :label="f.name">
        <el-input
          v-if="f.type === 'text' || f.type === 'url'"
          v-model="(form[f.id] as string)"
          :placeholder="f.type === 'url' ? 'https://...' : ''"
          clearable
        />
        <el-input
          v-else-if="f.type === 'longtext'"
          v-model="(form[f.id] as string)"
          type="textarea"
          :rows="3"
        />
        <!-- 列表 / 多选：标签输入 -->
        <el-select
          v-else-if="f.type === 'list' || f.type === 'multi_select'"
          :model-value="multiValue(f)"
          multiple
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入"
          style="width: 100%"
          @update:model-value="
            (v: Array<string | number>) => {
              form[f.id] = v.map(String)
              v.forEach((x) => addOption(f, x))
            }
          "
        >
          <el-option
            v-for="item in f.type === 'multi_select' ? f.options : multiValue(f)"
            :key="item"
            :label="item"
            :value="item"
          />
        </el-select>
        <el-select
          v-else-if="f.type === 'select'"
          v-model="(form[f.id] as string)"
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入"
          style="width: 100%"
          @change="(v: string | number) => addOption(f, v)"
        >
          <el-option v-for="opt in f.options" :key="opt" :label="opt" :value="opt" />
        </el-select>
        <el-input-number
          v-else-if="f.type === 'number'"
          :model-value="(form[f.id] as number | null)"
          controls-position="right"
          style="width: 100%"
          @update:model-value="(v: number | undefined) => { form[f.id] = v ?? null }"
        />
        <el-date-picker
          v-else-if="f.type === 'date'"
          :model-value="(form[f.id] as string | null)"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
          @update:model-value="(v: string | null) => { form[f.id] = v || null }"
        />
        <el-switch
          v-else-if="f.type === 'checkbox'"
          :model-value="Boolean(form[f.id])"
          @update:model-value="(v: string | number | boolean) => { form[f.id] = Boolean(v) }"
        />
      </el-form-item>
    </el-form>

    <div v-if="table" class="quick-foot">
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </div>
  </div>
</template>

<style scoped>
.quick {
  height: 100%;
  min-height: 320px;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}
.quick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.quick-form {
  flex: 1;
  overflow: auto;
}
.quick-foot {
  padding-top: 8px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
