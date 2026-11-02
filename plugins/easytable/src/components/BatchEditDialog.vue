<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FieldDef, FieldValue, Row, TableSchema } from '../types/table'
import { hasOptions } from '../types/table'
import { FIELD_TYPE_LABELS, collectFieldOptions, defaultValue, isEmptyValue } from '../domain/fieldTypes'
import { DEFAULT_MULTI_SEP, splitMultiValue } from '../domain/separators'

const props = defineProps<{
  visible: boolean
  table: TableSchema
  /** 本次将被修改的行（作用范围已由父组件算好） */
  targets: Row[]
  /** 作用范围是否来自「已勾选」：用于区分「勾选 N 条」与「未勾选视为全部」 */
  fromSelection: boolean
  /** 当前表的全部行：单选/多选下拉要能选到已有数据里出现过的值 */
  rows?: Row[]
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'apply', fieldId: string, value: FieldValue): void
}>()

const fields = computed<FieldDef[]>(() => props.table.fields)
const fieldId = ref('')
const value = ref<FieldValue>('')

const field = computed<FieldDef | null>(
  () => fields.value.find((f) => f.id === fieldId.value) ?? null
)

/** 每次打开都从「第一个字段 + 该类型的空值」重新开始，不留上一次的输入 */
function reset() {
  const first = fields.value[0]
  fieldId.value = first?.id ?? ''
  value.value = first ? defaultValue(first.type) : ''
}

watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  },
  { immediate: true }
)

function onFieldChange(id: string | number) {
  fieldId.value = String(id)
  const f = fields.value.find((x) => x.id === fieldId.value)
  value.value = f ? defaultValue(f.type) : ''
}

const scopeText = computed(() =>
  props.fromSelection
    ? `已勾选 ${props.targets.length} 条记录，本次只改这些记录`
    : `未勾选记录，视为全部：本次改当前列表中的全部 ${props.targets.length} 条记录`
)

/** 单选/多选的候选项 = 已配置选项 ∪ 已有数据里出现过的值 */
const options = computed<string[]>(() => {
  const f = field.value
  if (!f || !hasOptions(f)) return []
  const merged = new Set(f.options)
  for (const v of collectFieldOptions(props.rows ?? [], f)) merged.add(v)
  return [...merged]
})

/** 文本 / 长文本 / 链接 / 单选取值（都是字符串） */
const stringValue = computed(() => (typeof value.value === 'string' ? value.value : ''))
const numberValue = computed(() => (typeof value.value === 'number' ? value.value : null))
const dateValue = computed(() =>
  typeof value.value === 'string' && value.value ? value.value : null
)
const boolValue = computed(() => Boolean(value.value))
const multiValue = computed<string[]>(() =>
  Array.isArray(value.value) ? value.value.map(String) : []
)
const listText = computed(() =>
  Array.isArray(value.value) ? value.value.join(DEFAULT_MULTI_SEP) : ''
)

function setString(v: string | number) {
  value.value = v == null ? '' : String(v)
}
function setNumber(v: number | undefined) {
  value.value = v ?? null
}
function setDate(v: string | null) {
  value.value = v || null
}
function setBool(v: string | number | boolean) {
  value.value = Boolean(v)
}
function setMulti(v: Array<string | number>) {
  value.value = v.map(String)
}
function setListText(v: string | number) {
  value.value = splitMultiValue(String(v))
}

function close() {
  emit('update:visible', false)
}

function submit() {
  if (!field.value) return
  emit('apply', field.value.id, value.value)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="批量修改"
    width="420px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
  >
    <p class="scope-tip">{{ scopeText }}</p>
    <el-form label-width="80px" label-position="left" @submit.prevent="submit">
      <el-form-item label="修改字段">
        <el-select
          :model-value="fieldId"
          placeholder="选择字段"
          style="width: 100%"
          @update:model-value="onFieldChange"
        >
          <el-option
            v-for="f in fields"
            :key="f.id"
            :label="
                f.name +
                '（' +
                FIELD_TYPE_LABELS[f.type] +
                (f.unique ? ' · 唯一' : '') +
                (f.required ? ' · 必填' : '') +
                '）'
              "
            :value="f.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="field" label="统一改为">
        <!-- 文本 / 链接 -->
        <el-input
          v-if="field.type === 'text' || field.type === 'url'"
          :model-value="stringValue"
          :placeholder="field.type === 'url' ? 'https://...' : '留空即清空'"
          clearable
          @update:model-value="setString"
        />
        <el-input
          v-else-if="field.type === 'longtext'"
          :model-value="stringValue"
          type="textarea"
          :rows="3"
          placeholder="留空即清空"
          @update:model-value="setString"
        />
        <!-- 列表 -->
        <div v-else-if="field.type === 'list'" class="list-editor">
          <el-input
            :model-value="listText"
            placeholder="用 、 ， , | 分隔，留空即清空"
            clearable
            @update:model-value="setListText"
          />
          <div v-if="multiValue.length" class="tag-row">
            <el-tag v-for="item in multiValue" :key="item" size="small">{{ item }}</el-tag>
          </div>
        </div>
        <!-- 单选 -->
        <el-select
          v-else-if="field.type === 'select'"
          :model-value="stringValue"
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入，留空即清空"
          style="width: 100%"
          @update:model-value="setString"
        >
          <el-option v-for="opt in options" :key="opt" :label="opt" :value="opt" />
        </el-select>
        <!-- 多选 -->
        <el-select
          v-else-if="field.type === 'multi_select'"
          :model-value="multiValue"
          multiple
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入后回车，留空即清空"
          style="width: 100%"
          @update:model-value="setMulti"
        >
          <el-option v-for="opt in options" :key="opt" :label="opt" :value="opt" />
        </el-select>
        <!-- 数字 -->
        <el-input-number
          v-else-if="field.type === 'number'"
          :model-value="numberValue"
          controls-position="right"
          style="width: 100%"
          @update:model-value="setNumber"
        />
        <!-- 日期 -->
        <el-date-picker
          v-else-if="field.type === 'date'"
          :model-value="dateValue"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
          @update:model-value="setDate"
        />
        <!-- 是否 -->
        <el-switch
          v-else-if="field.type === 'checkbox'"
          :model-value="boolValue"
          @update:model-value="setBool"
        />
      </el-form-item>
    </el-form>
    <p v-if="field?.required && isEmptyValue(value)" class="constraint-tip">
      该字段必填，留空无法保存
    </p>
    <p v-else-if="field?.unique && targets.length > 1 && !isEmptyValue(value)" class="constraint-tip">
      该字段唯一，不能给多条记录批量改成同一个非空值
    </p>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!field" @click="submit">应用修改</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.scope-tip {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.list-editor {
  width: 100%;
}
.constraint-tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-warning);
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
</style>