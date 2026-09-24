<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FieldDef, FieldType, TableSchema } from '../types/table'
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
}>()

interface DraftField {
  id: string
  name: string
  type: FieldType
  optionsText: string
  isNew?: boolean
}

const draftName = ref('')
const fields = ref<DraftField[]>([])
const showCreatedAt = ref(true)
const showUpdatedAt = ref(true)

function toDraft(f: FieldDef): DraftField {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    optionsText: hasOptions(f) ? f.options.join(DEFAULT_MULTI_SEP) : ''
  }
}

function fromDraft(d: DraftField): FieldDef {
  const base = createField(d.name.trim() || '未命名', d.type)
  base.id = d.id
  if (d.type === 'select' || d.type === 'multi_select') {
    return {
      id: d.id,
      name: base.name,
      type: d.type,
      options: splitMultiValue(d.optionsText)
    }
  }
  return { id: d.id, name: base.name, type: d.type } as FieldDef
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
  }
  emit('save', {
    ...props.table,
    name: draftName.value.trim() || props.table.name,
    fields: nextFields,
    showCreatedAt: showCreatedAt.value,
    showUpdatedAt: showUpdatedAt.value,
    updatedAt: Date.now()
  })
  emit('update:visible', false)
}

const typeOptions = FIELD_TYPE_OPTIONS
const splitHint = `选项用 ${VALUE_SPLIT_LABEL} 分隔`
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
</style>
