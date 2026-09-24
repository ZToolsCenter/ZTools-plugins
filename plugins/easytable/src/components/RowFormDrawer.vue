<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FieldDef, FieldValue, Row, TableSchema } from '../types/table'
import { defaultValue, initialFieldDefault } from '../domain/fieldTypes'
import { DEFAULT_MULTI_SEP, splitMultiValue } from '../domain/separators'
import { hasOptions } from '../types/table'

const props = defineProps<{
  visible: boolean
  table: TableSchema
  row: Row | null
  /** 新建时预填到第一个文本类字段（如启动参数里的 pm 号） */
  prefillText?: string
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'save', values: Record<string, FieldValue>, rowId: string | null): void
}>()

const form = reactive<Record<string, FieldValue>>({})
const rowId = ref<string | null>(null)

function fillFromRow() {
  rowId.value = props.row?.id ?? null
  const values: Record<string, FieldValue> = {}
  for (const f of props.table.fields) {
    values[f.id] =
      props.row?.values?.[f.id] ?? (props.row ? defaultValue(f.type) : initialFieldDefault(f))
  }
  if (!props.row && props.prefillText) {
    const target = props.table.fields.find((f) => f.type === 'text')
    if (target) values[target.id] = props.prefillText
  }
  // 保证 options 里能显示已选但不在列表中的值
  for (const f of props.table.fields) {
    if (!hasOptions(f)) continue
    const cur = values[f.id]
    const list = Array.isArray(cur) ? cur : cur != null && cur !== '' ? [String(cur)] : []
    for (const v of list) {
      if (v && !f.options.includes(v)) f.options.push(v)
    }
  }
  Object.keys(form).forEach((k) => delete form[k])
  Object.assign(form, values)
}

watch(
  () => [props.visible, props.row, props.table.id, props.prefillText],
  () => {
    if (props.visible) fillFromRow()
  },
  { immediate: true }
)

function listText(f: FieldDef): string {
  const v = form[f.id]
  return Array.isArray(v) ? v.join(DEFAULT_MULTI_SEP) : String(v ?? '')
}

function setListText(f: FieldDef, text: string) {
  form[f.id] = splitMultiValue(text)
}

const title = computed(() => (props.row ? '编辑记录' : '新增记录'))

function submit() {
  emit('save', { ...form }, rowId.value)
  emit('update:visible', false)
}

function cancel() {
  emit('update:visible', false)
}

function multiValue(f: FieldDef): string[] {
  const v = form[f.id]
  return Array.isArray(v) ? v : []
}

function toggleMulti(f: FieldDef, opt: string) {
  const cur = new Set(multiValue(f))
  if (cur.has(opt)) cur.delete(opt)
  else cur.add(opt)
  form[f.id] = [...cur]
}

function addOption(f: FieldDef, raw: string | number | undefined) {
  if (!hasOptions(f)) return
  const s = String(raw ?? '').trim()
  if (!s || f.options.includes(s)) return
  f.options.push(s)
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    :title="title"
    size="420px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-width="88px" label-position="left" @submit.prevent="submit">
      <el-form-item v-for="f in table.fields" :key="f.id" :label="f.name">
        <!-- 文本 / 链接 -->
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
          :rows="4"
        />
        <!-- 列表 -->
        <div v-else-if="f.type === 'list'" class="list-editor">
          <el-input
            :model-value="listText(f)"
            placeholder="用 、 ， , | 分隔"
            @update:model-value="(v: string | number) => setListText(f, String(v))"
          />
          <div class="tag-row">
            <el-tag v-for="(item, i) in multiValue(f)" :key="i" closable @close="toggleMulti(f, item)">
              {{ item }}
            </el-tag>
          </div>
        </div>
        <!-- 单选 -->
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
        <!-- 多选 -->
        <div v-else-if="f.type === 'multi_select'" class="list-editor">
          <el-select
            :model-value="multiValue(f)"
            multiple
            filterable
            allow-create
            default-first-option
            clearable
            placeholder="选择或输入后回车"
            style="width: 100%"
            @update:model-value="(v: Array<string | number>) => { form[f.id] = v.map(String); v.forEach(x => addOption(f, x)) }"
          >
            <el-option v-for="opt in f.options" :key="opt" :label="opt" :value="opt" />
          </el-select>
          <div class="tag-row">
            <el-tag
              v-for="item in multiValue(f)"
              :key="item"
              closable
              @close="toggleMulti(f, item)"
            >
              {{ item }}
            </el-tag>
          </div>
        </div>
        <!-- 数字 -->
        <el-input-number
          v-else-if="f.type === 'number'"
          :model-value="(form[f.id] as number | null)"
          controls-position="right"
          style="width: 100%"
          @update:model-value="(v: number | undefined) => { form[f.id] = v ?? null }"
        />
        <!-- 日期 -->
        <el-date-picker
          v-else-if="f.type === 'date'"
          :model-value="(form[f.id] as string | null)"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
          @update:model-value="(v: string | null) => { form[f.id] = v || null }"
        />
        <!-- 是否 -->
        <el-switch
          v-else-if="f.type === 'checkbox'"
          :model-value="Boolean(form[f.id])"
          @update:model-value="(v: string | number | boolean) => { form[f.id] = Boolean(v) }"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" @click="submit">保存</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.list-editor {
  width: 100%;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
</style>
