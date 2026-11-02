<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FieldConstraints, FieldDef, FieldValue, FieldType, Row, TableSchema } from '../types/table'
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPE_OPTIONS,
  backfillField,
  coerceFieldValue,
  coerceRowsToFields,
  collectFieldOptions,
  createField
} from '../domain/fieldTypes'
import { DEFAULT_MULTI_SEP, VALUE_SPLIT_LABEL, splitMultiValue } from '../domain/separators'
import { describeViolation, inspectConstraints } from '../domain/constraints'
import { canBeRequired, canBeUnique, hasOptions } from '../types/table'

const props = defineProps<{
  visible: boolean
  table: TableSchema
  /** 当前表已有行数；为 0 时不提示类型变更 */
  rowCount?: number
  /** 当前表的行数据：改类型时用它收集已有取值为选项 */
  rows?: Row[]
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'save', schema: TableSchema): void
  (e: 'backfill', fieldIds: string[]): void
  /** 字段类型变更后，请宿主按新类型转换已有行的值 */
  (e: 'coerce', fieldIds: string[]): void
}>()

interface DraftField {
  id: string
  name: string
  type: FieldType
  optionsText: string
  /** 默认值编辑态：checkbox 用 'yes'/'no'，其余类型用文本输入（空串表示未设置） */
  defaultText: string
  /** 必填：保存 / 新增时该字段不能为空 */
  required: boolean
  /** 唯一：同表内该字段的值不允许重复 */
  unique: boolean
  /** 上一次的类型，用于切换类型时迁移默认值（checkbox 的 yes/no 编码不能直接留给其他类型） */
  lastType: FieldType
}

const draftName = ref('')
const fields = ref<DraftField[]>([])
const showCreatedAt = ref(true)
const showUpdatedAt = ref(true)

/** 存储值 → 草稿默认值文本：checkbox 编码成 yes/no，多值用分隔符连接 */
function defaultToText(type: FieldType, value: FieldValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (type === 'checkbox') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.join(DEFAULT_MULTI_SEP)
  return String(value)
}

function toDraft(f: FieldDef): DraftField {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    optionsText: hasOptions(f) ? f.options.join(DEFAULT_MULTI_SEP) : '',
    defaultText: defaultToText(f.type, f.default),
    required: f.required === true && canBeRequired(f),
    unique: f.unique === true && canBeUnique(f),
    lastType: f.type
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

/** 约束标记只写 true，没勾的字段不落库，保持 meta 精简 */
function constraintFlags(d: DraftField): FieldConstraints {
  const flags: FieldConstraints = {}
  if (d.required && requiredEnabled(d.type)) flags.required = true
  if (d.unique && uniqueEnabled(d.type)) flags.unique = true
  return flags
}

function fromDraft(d: DraftField): FieldDef {
  const base = createField(d.name.trim() || '未命名', d.type)
  base.id = d.id
  const def = parseDefault(d)
  const flags = constraintFlags(d)
  if (d.type === 'select' || d.type === 'multi_select') {
    return {
      id: d.id,
      name: base.name,
      type: d.type,
      options: splitMultiValue(d.optionsText),
      ...flags,
      ...(def !== undefined ? { default: def } : {})
    }
  }
  return {
    id: d.id,
    name: base.name,
    type: d.type,
    ...flags,
    ...(def !== undefined ? { default: def } : {})
  } as FieldDef
}

/** 该类型的字段能否勾选「必填 / 唯一」（是否、多选等类型语义不成立） */
function requiredEnabled(type: FieldType): boolean {
  return canBeRequired({ type })
}
function uniqueEnabled(type: FieldType): boolean {
  return canBeUnique({ type })
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
    required: false,
    unique: false,
    lastType: 'text'
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

/** 是否字段用「是 / 否 / 无」三态选择，其余类型用文本输入 */
const isCheckbox = computed(() => fields.value.map((f) => f.type === 'checkbox'))

/** 用草稿的 id + 新类型构造字段定义，供「按新类型收集已有取值」使用 */
function draftDef(d: DraftField): FieldDef {
  return { ...createField(d.name, d.type), id: d.id } as FieldDef
}

/**
 * 把已有行里出现过的取值合并进选项文本。
 * ask=true 时先弹确认（切换类型时用，让用户看清会加进哪些取值）；
 * 返回真正新增的选项个数。
 */
async function collectOptions(f: DraftField, ask: boolean): Promise<number> {
  const current = splitMultiValue(f.optionsText)
  const known = new Set(current)
  const missing = collectFieldOptions(props.rows ?? [], draftDef(f)).filter((v) => !known.has(v))
  if (!missing.length) return 0
  if (ask) {
    try {
      await ElMessageBox.confirm(
        `字段「${f.name.trim() || '未命名'}」在已有记录里有 ${missing.length} 个取值还没进选项：\n\n${missing.join('  ')}\n\n加入选项列表吗？（加入后下拉框里就能直接选到这些值）`,
        '收集已有取值',
        {
          type: 'info',
          confirmButtonText: '加入',
          cancelButtonText: '不加入',
          distinguishCancelAndClose: true
        }
      )
    } catch {
      return 0
    }
  }
  f.optionsText = [...current, ...missing].join(DEFAULT_MULTI_SEP)
  return missing.length
}

/**
 * 类型切换时把草稿里的默认值按新类型迁移，复用 coerceFieldValue 的转换语义，
 * 保证「表设置里的默认值」和「已有数据按新类型转换后的值」一致。
 * 主要解决 checkbox 的 yes/no 编码：直接留给文本等类型会变成字面量 'yes'/'no'。
 */
function migrateDefault(f: DraftField, from: FieldType) {
  const value = parseDefault({ ...f, type: from })
  f.defaultText = defaultToText(
    f.type,
    value === undefined ? undefined : coerceFieldValue(draftDef(f), value)
  )
}

/** 切换到单选/多选：把已有数据里的不同取值收进选项，省得逐条手抄 */
async function onTypeChange(f: DraftField) {
  if (f.lastType !== f.type) {
    migrateDefault(f, f.lastType)
    f.lastType = f.type
  }
  // 新类型不支持约束时把勾选清掉，避免落库出自相矛盾的字段定义
  if (!requiredEnabled(f.type)) f.required = false
  if (!uniqueEnabled(f.type)) f.unique = false
  if (f.type !== 'select' && f.type !== 'multi_select') return
  await collectOptions(f, true)
}

/** 手动补收：数据是后来才出现的（导入 / 别处写入）时用 */
async function onCollectOptions(f: DraftField) {
  const n = await collectOptions(f, false)
  if (n) ElMessage.success(`已收集 ${n} 个取值`)
  else ElMessage.info('已有数据里没有新的取值')
}

/**
 * 保存前检查存量数据是否满足新约束：只提示本次「新引入/加重」的违规，
 * 避免改个无关字段也反复弹窗。用户可选择仍然保存（约束只对之后的新增/修改生效）。
 */
async function checkExistingViolations(
  nextFields: FieldDef[],
  coerceFieldIds: string[],
  backfillFieldIds: string[]
): Promise<boolean> {
  if ((props.rowCount ?? 0) <= 0) return true
  // 用和宿主一致的数据迁移逻辑预演：改类型按新类型转换，回填默认值补进缺失字段
  let previewRows = props.rows ?? []
  if (coerceFieldIds.length) {
    previewRows = coerceRowsToFields(previewRows, nextFields, coerceFieldIds)?.rows ?? previewRows
  }
  for (const fieldId of backfillFieldIds) {
    const field = nextFields.find((f) => f.id === fieldId)
    if (field) previewRows = backfillField(previewRows, field)?.rows ?? previewRows
  }
  const before = new Map(
    inspectConstraints(props.table.fields, props.rows ?? []).map((v) => [
      `${v.fieldId}:${v.kind}`,
      v.count
    ])
  )
  const added = inspectConstraints(nextFields, previewRows).filter(
    (v) => v.count > (before.get(`${v.fieldId}:${v.kind}`) ?? 0)
  )
  if (!added.length) return true
  try {
    await ElMessageBox.confirm(
      `现有数据不满足新约束：\n\n${added.map(describeViolation).join('\n')}\n\n保存后约束只对之后的新增 / 修改生效，已有记录不会被自动清理。继续保存吗？`,
      '约束检查',
      {
        type: 'warning',
        confirmButtonText: '仍然保存',
        cancelButtonText: '取消',
        closeOnClickModal: false
      }
    )
    return true
  } catch {
    return false
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
  const coerceFieldIds: string[] = []
  const oldMap = new Map(props.table.fields.map((f) => [f.id, f]))
  // 仅当表内已有数据、且是已有字段改类型时才提示（新建表/空表直接改）
  if ((props.rowCount ?? 0) > 0) {
    for (const f of nextFields) {
      const old = oldMap.get(f.id)
      if (old && old.type !== f.type) {
        try {
          await ElMessageBox.confirm(
            `字段「${f.name}」类型从「${FIELD_TYPE_LABELS[old.type]}」改为「${FIELD_TYPE_LABELS[f.type]}」，已有数据会按新类型自动转换（文本转多选按「${VALUE_SPLIT_LABEL}」拆分，转数字/日期会重新解析），转换不了的置空。继续？`,
            '类型变更',
            { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' }
          )
        } catch {
          return
        }
        coerceFieldIds.push(f.id)
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
  if (!(await checkExistingViolations(nextFields, coerceFieldIds, backfillFieldIds))) return
  emit('save', {
    ...props.table,
    name: draftName.value.trim() || props.table.name,
    fields: nextFields,
    showCreatedAt: showCreatedAt.value,
    showUpdatedAt: showUpdatedAt.value,
    updatedAt: Date.now()
  })
  // 先按新类型转换已有数据，再回填新字段默认值（两者都整表写入，宿主会串行执行）
  if (coerceFieldIds.length) emit('coerce', coerceFieldIds)
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
        <div v-if="needOptions[idx]" class="options-row">
          <el-input v-model="f.optionsText" :placeholder="splitHint" clearable />
          <el-button link type="primary" class="collect-btn" @click="onCollectOptions(f)">
            从已有数据收集
          </el-button>
        </div>
        <div class="constraint-row">
          <span class="default-label">约束</span>
          <el-tooltip content="该字段不允许为空" placement="top">
            <el-checkbox v-model="f.required" :disabled="!requiredEnabled(f.type)" size="small">
              必填
            </el-checkbox>
          </el-tooltip>
          <el-tooltip
            content="同表内该字段的值不允许重复（忽略首尾空白与大小写，空值不算重复）"
            placement="top"
          >
            <el-checkbox v-model="f.unique" :disabled="!uniqueEnabled(f.type)" size="small">
              唯一
            </el-checkbox>
          </el-tooltip>
        </div>
        <div class="default-row">
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
.options-row {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.collect-btn {
  align-self: flex-end;
}
.default-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.constraint-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.constraint-row :deep(.el-checkbox) {
  margin-right: 0;
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
