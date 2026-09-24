<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FieldDef, FieldValue, FieldType, TableSchema } from '../types/table'
import { FIELD_TYPE_LABELS, FIELD_TYPE_OPTIONS, createField } from '../domain/fieldTypes'
import { DEFAULT_MULTI_SEP, VALUE_SPLIT_LABEL, splitMultiValue } from '../domain/separators'
import { hasOptions } from '../types/table'

const props = defineProps<{
  visible: boolean
  table: TableSchema
  /** 当前表已有行数；为 0 时不提示类型变更 */
  rowCount?: number
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'save', schema: TableSchema): void
  (e: 'backfill', fieldIds: string[]): void
}>()

interface DraftField {
  id: string
  name: string
  type: FieldType
  optionsText: string
  /** 默认值编辑态：checkbox 用 'yes'/'no'/'none'，其余类型用文本输入 */
  defaultText: string
  /** 编辑前的默认值原值，判断是否改过 */
  defaultRaw?: FieldValue
  isNew?: boolean
}

const draftName = ref('')
const fields = ref<DraftField[]>([])
const showCreatedAt = ref(true)
const showUpdatedAt = ref(true)

function toDraft(f: FieldDef): DraftField {
  const raw = f.default
  let defaultText = ''
  if (raw !== undefined) {
    if (f.type === 'checkbox') defaultText = raw ? 'yes' : 'no'
    else if (Array.isArray(raw)) defaultText = raw.join(DEFAULT_MULTI_SEP)
    else if (raw != null) defaultText = String(raw)
  }
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    optionsText: hasOptions(f) ? f.options.join(DEFAULT_MULTI_SEP) : '',
    defaultText,
    defaultRaw: raw
  }
}

/** 草稿默认值 → 存储值；无输入返回 undefined（不设默认值） */
function parseDefault(d: DraftField): FieldValue | undefined {
  const t = d.defaultText
  if (t === '' && d.type !== 'checkbox') return undefined
  switch (d.type) {
    case 'checkbox':
      return t === 'yes' ? true : t === 'no' ? false : undefined
    case 'multi_select':
    case 'list':
      return t.trim() ? splitMultiValue(t) : undefined
    case 'number': {
      if (t === '') return undefined
      const n = Number(t.replace(/,/g, '').trim())
      return Number.isFinite(n) ? n : undefined
    }
    case 'date': {
      const s = t.trim()
      if (!s) return undefined
      // 非法日期串直接视为未设置，避免回填垃圾值
      return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s) ? s : undefined
    }
    default:
      return t
  }
}

function fromDraft(d: DraftField): FieldDef {
  const base = createField(d.name.trim() || '未命名', d.type)
  base.id = d.id
  const def = parseDefault(d)
  if (d.type === 'select' || d.type === 'multi_select') {
    return {
      id: d.id,
      name: base.name,
      type: d.type,
      options: splitMultiValue(d.optionsText),
      ...(def !== undefined ? { default: def } : {})
    }
  }
  return { id: d.id, name: base.name, type: d.type, ...(def !== undefined ? { default: def } : {}) } as FieldDef
}

watch(
  () => [props.visible, props.table],
  () => {
    if (!props.visible) return
    draftName.value = props.table.name
    fields.value = props.table.fields.map(toDraft)
    showCreatedAt.value = props.table.showCreatedAt !== false
    showUpdatedAt.value = props.table.showUpdatedAt !== false
  },
  { immediate: true, deep: true }
)

function addField() {
  fields.value.push({
    id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `字段${fields.value.length + 1}`,
    type: 'text',
    optionsText: '',
    defaultText: '',
    isNew: true
  })
}

function removeField(idx: number) {
  fields.value.splice(idx, 1)
}

function move(idx: number, delta: number) {
  const j = idx + delta
  if (j < 0 || j >= fields.value.length) return
  const tmp = fields.value[idx]
  fields.value[idx] = fields.value[j]
  fields.value[j] = tmp
}

const needOptions = computed(() =>
  fields.value.map((f) => f.type === 'select' || f.type === 'multi_select')
)
/** 该字段是否显示默认值输入（checkbox 用三态选择，其余用文本） */
const showDefault = computed(() =>
  fields.value.map((f) => f.type !== 'checkbox')
)
const isCheckbox = computed(() => fields.value.map((f) => f.type === 'checkbox'))

function onTypeChange(f: DraftField) {
  if (f.type === 'select' || f.type === 'multi_select') {
    if (!f.optionsText) f.optionsText = ''
  }
}

async function save() {
  if (!fields.value.length) {
    ElMessage.warning('至少保留一个字段')
    return
  }
  const names = fields.value.map((f) => f.name.trim())
  if (names.some((n) => !n)) {
    ElMessage.warning('字段名不能为空')
    return
  }
  if (new Set(names).size !== names.length) {
    ElMessage.warning('字段名不能重复')
    return
  }
  const nextFields = fields.value.map(fromDraft)
  const backfillFieldIds: string[] = []
  const oldMap = new Map(props.table.fields.map((f) => [f.id, f]))
  // 仅当表内已有数据、且是已有字段改类型时才提示（新建表/空表直接改）
  if ((props.rowCount ?? 0) > 0) {
    for (const f of nextFields) {
      const old = oldMap.get(f.id)
      if (old && old.type !== f.type) {
        try {
          await ElMessageBox.confirm(
            `字段「${f.name}」类型从「${FIELD_TYPE_LABELS[old.type]}」改为「${FIELD_TYPE_LABELS[f.type]}」，已有数据将尽量转换，无法转换的会置空。继续？`,
            '类型变更',
            { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' }
          )
        } catch {
          return
        }
      }
    }
    // 新增字段且设置了非空默认值：询问是否把默认值回填到已有数据
    for (const f of nextFields) {
      const old = oldMap.get(f.id)
      if (old) continue
      const v = f.default
      if (v === undefined || v === null || (Array.isArray(v) && !v.length) || v === '') continue
      let backfill = false
      try {
        await ElMessageBox.confirm(
          `新字段「${f.name}」设置了默认值。要把该默认值回填到已有的 ${props.rowCount} 条记录吗？\n\n选择「不回填」则已有记录该字段保持为空（之后新增的记录会预填默认值）。`,
          '回填默认值',
          {
            type: 'info',
            confirmButtonText: '回填',
            cancelButtonText: '不回填',
            distinguishCancelAndClose: true,
            closeOnClickModal: false
          }
        )
        backfill = true
      } catch (action) {
        if (action === 'close') return // 右上角 × 视为放弃保存
        backfill = false // 「不回填」
      }
      if (backfill) backfillFieldIds.push(f.id)
    }
  }
  emit('save', {
    ...props.table,
    name: draftName.value.trim() || props.table.name,
    fields: nextFields,
    showCreatedAt: showCreatedAt.value,
    showUpdatedAt: showUpdatedAt.value,
    updatedAt: Date.now()
  })
  if (backfillFieldIds.length) emit('backfill', backfillFieldIds)
  emit('update:visible', false)
}

const typeOptions = FIELD_TYPE_OPTIONS
const splitHint = `选项用 ${VALUE_SPLIT_LABEL} 分隔`

function defaultPlaceholder(type: FieldType): string {
  switch (type) {
    case 'multi_select':
    case 'list':
      return `新行预填；多值用 ${VALUE_SPLIT_LABEL} 分隔`
    case 'number':
      return '新行预填数字'
    case 'date':
      return 'YYYY-MM-DD'
    case 'select':
      return '新行预填选项'
    default:
      return '新行预填内容'
  }
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="表设置"
    size="420px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-width="72px" label-position="left" @submit.prevent="save">
      <el-form-item label="表名">
        <el-input v-model="draftName" placeholder="表格名称" />
      </el-form-item>
      <el-form-item label="系统列">
        <div class="system-cols">
          <el-checkbox v-model="showCreatedAt">创建时间</el-checkbox>
          <el-checkbox v-model="showUpdatedAt">修改时间</el-checkbox>
        </div>
      </el-form-item>
      <div v-for="(f, idx) in fields" :key="f.id" class="field-row">
        <div class="field-main">
          <el-input v-model="f.name" placeholder="字段名" class="name-input" />
          <el-select v-model="f.type" class="type-select" @change="onTypeChange(f)">
            <el-option
              v-for="opt in typeOptions"
              :key="opt.type"
              :label="opt.label"
              :value="opt.type"
            />
          </el-select>
        </div>
        <div class="field-actions">
          <el-button link :disabled="idx === 0" @click="move(idx, -1)">上移</el-button>
          <el-button link :disabled="idx === fields.length - 1" @click="move(idx, 1)">下移</el-button>
          <el-button link type="danger" @click="removeField(idx)">删除</el-button>
        </div>
        <el-input
          v-if="needOptions[idx]"
          v-model="f.optionsText"
          :placeholder="splitHint"
          class="options-input"
          clearable
        />
        <div v-if="showDefault[idx]" class="default-row">
          <span class="default-label">默认值</span>
          <el-select
            v-if="isCheckbox[idx]"
            v-model="f.defaultText"
            placeholder="无"
            clearable
            size="small"
            class="default-input"
          >
            <el-option label="是（true）" value="yes" />
            <el-option label="否（false）" value="no" />
          </el-select>
          <el-input
            v-else
            v-model="f.defaultText"
            size="small"
            class="default-input"
            clearable
            :placeholder="defaultPlaceholder(f.type)"
          />
        </div>
      </div>
      <el-button plain style="width: 100%" @click="addField">+ 添加字段</el-button>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.system-cols {
  display: flex;
  gap: 12px;
}
.field-row {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
}
.field-main {
  display: flex;
  gap: 8px;
  align-items: center;
}
.name-input {
  flex: 1;
}
.type-select {
  width: 110px;
}
.field-actions {
  display: flex;
  gap: 0;
  margin-top: 4px;
}
.options-input {
  margin-top: 8px;
}
.default-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.default-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.default-input {
  flex: 1;
}
</style>
