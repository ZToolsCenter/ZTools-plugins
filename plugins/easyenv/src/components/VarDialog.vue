<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  appendPickedPath,
  kindExplain,
  KIND_OPTIONS,
  pickPath,
  validateVarName
} from '../api'

const props = defineProps<{
  modelValue: boolean
  mode: 'add' | 'edit'
  scopeLabel: string
  initName?: string
  initValue?: string
  initKind?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: { name: string; value: string; kind: string }): void
}>()

const name = ref('')
const value = ref('')
const kind = ref('String')

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

// 打开时按传入值重置表单
watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    name.value = props.initName || ''
    value.value = props.initValue || ''
    kind.value = props.initKind || 'String'
  }
)

// 值里出现 %VAR% 时提示用户可能该选「可展开文本」，否则引用会被当普通字符
const hasRef = computed(() => /%[^%]+%/.test(value.value))
const suggestExpand = computed(() => hasRef.value && kind.value !== 'ExpandString')

// *_HOME 这类变量只接受单个目录：写分号后，被塞进 PATH 时会被拆成两条（前段还失效）
const multiPathHome = computed(
  () => /_HOME$/i.test(name.value.trim()) && value.value.includes(';')
)

const kindHelp = computed(() => kindExplain(kind.value, value.value))

// 选择文件 / 文件夹：选中后并进现有值，也可以不点直接手写
function browse(type: 'file' | 'folder') {
  const p = pickPath(type, type === 'folder' ? '选择文件夹' : '选择文件')
  if (!p) return
  value.value = appendPickedPath(value.value, p)
}

function submit() {
  const err = validateVarName(name.value)
  if (err) {
    ElMessage.warning(err)
    return
  }
  emit('save', { name: name.value.trim(), value: value.value, kind: kind.value })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="mode === 'add' ? '新建变量（' + scopeLabel + '）' : '编辑变量（' + scopeLabel + '）'"
    width="90%"
    top="10vh"
  >
    <el-form label-width="76px" label-position="left">
      <el-form-item label="变量名">
        <el-input
          v-model="name"
          :disabled="mode === 'edit'"
          placeholder="如 JAVA_HOME"
          maxlength="255"
        />
        <div v-if="mode === 'edit'" class="tip">变量名不可修改，需要改名请新建后删除旧的</div>
      </el-form-item>

      <el-form-item label="值">
        <el-input
          v-model="value"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="可以直接手写，也可以用下面的按钮选文件 / 文件夹"
        />
        <div class="value-actions">
          <el-button size="small" @click="browse('file')">选择文件</el-button>
          <el-button size="small" @click="browse('folder')">选择文件夹</el-button>
          <span class="value-hint">选中后追加到末尾（分号分隔）</span>
        </div>
        <div v-if="suggestExpand" class="tip">
          值里含有 %引用%，建议类型改为「可展开文本」，否则引用不会被替换
        </div>
        <div v-if="multiPathHome" class="warn-box">
          名称以 _HOME 结尾的变量只接受一个目录。写分号后，像 <code>%JAVA_HOME%\bin</code>
          这样的引用被塞进 PATH 时会被拆成两条，前段变成无效路径（典型的「配了 jdk8 却跑 jdk17」）。
          需要切换版本请改这一个值，不要塞多个。
        </div>
      </el-form-item>

      <el-form-item label="类型">
        <el-select v-model="kind" style="width: 100%">
          <el-option v-for="o in KIND_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <div class="kind-help">{{ kindHelp }}</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="submit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.value-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.value-hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.kind-help {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}
.warn-box {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
}
.warn-box code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11.5px;
}
</style>
