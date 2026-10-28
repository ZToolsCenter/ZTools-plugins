<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dedupePath, joinPath, openInExplorer, pickPath, splitPath } from '../api'

interface PathEntry {
  raw: string
  expanded: string
  // null = 尚未校验（空行）
  exists: boolean | null
}

const props = defineProps<{
  modelValue: boolean
  value: string
  kind: string
  scopeLabel: string
  envMap: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: { value: string; kind: string }): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const entries = ref<PathEntry[]>([])
const dragIndex = ref(-1)
const checking = ref(false)
// 是否以 REG_EXPAND_SZ 保存：开启后值里的 %变量% 才会被展开
const expand = ref(true)

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    expand.value = props.kind === 'ExpandString'
    entries.value = splitPath(props.value).map((raw) => ({ raw, expanded: '', exists: null }))
    recheck()
  }
)

// 展开 + 存在性校验走 preload（%VAR% 展开需要注册表里的变量值）
function recheck() {
  if (typeof window.services?.checkPaths !== 'function') return
  checking.value = true
  const raws = entries.value.map((e) => e.raw)
  const results = window.services.checkPaths(raws, props.envMap) as {
    raw: string
    expanded: string
    exists: boolean
  }[]
  entries.value.forEach((e, i) => {
    const r = results[i]
    if (!r) return
    e.expanded = r.expanded
    e.exists = e.raw.trim() ? r.exists : null
  })
  checking.value = false
}

// 输入停止 400ms 后重校验，避免每敲一个字就跑一次文件检查
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => entries.value.map((e) => e.raw).join('\n'),
  () => {
    clearTimeout(timer)
    timer = setTimeout(recheck, 400)
  }
)

const badCount = computed(() => entries.value.filter((e) => e.exists === false).length)
const emptyCount = computed(() => entries.value.filter((e) => !e.raw.trim()).length)

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= entries.value.length) return
  const list = entries.value
  const tmp = list[i]
  list[i] = list[j]
  list[j] = tmp
}

function toTop(i: number) {
  if (i <= 0) return
  const [item] = entries.value.splice(i, 1)
  entries.value.unshift(item)
}

function remove(i: number) {
  entries.value.splice(i, 1)
}

function addRow() {
  entries.value.push({ raw: '', expanded: '', exists: null })
}

// 选文件夹直接追加一条，省得手打路径
function addFromFolder() {
  const p = pickPath('folder', '选择要加入 PATH 的文件夹')
  if (!p) return
  if (entries.value.some((e) => e.raw.trim().toUpperCase() === p.toUpperCase())) {
    ElMessage.info('该路径已在列表中')
    return
  }
  entries.value.push({ raw: p, expanded: '', exists: null })
  recheck()
}

function dedupe() {
  const before = entries.value.length
  const uniq = dedupePath(entries.value.map((e) => e.raw))
  entries.value = uniq.map((raw) => ({ raw, expanded: '', exists: null }))
  recheck()
  const removed = before - uniq.length
  ElMessage.success(removed ? `已移除 ${removed} 条重复路径` : '没有重复路径')
}

function onDragStart(i: number) {
  dragIndex.value = i
}

// 单条路径直接在资源管理器里打开，方便核对目录是否还在、装的是哪个版本
function openEntry(raw: string) {
  if (!raw.trim()) return
  openInExplorer(raw, props.envMap || {})
}

function onDrop(i: number) {
  const from = dragIndex.value
  dragIndex.value = -1
  if (from < 0 || from === i) return
  const list = entries.value
  const [item] = list.splice(from, 1)
  list.splice(i, 0, item)
  recheck()
}

async function submit() {
  const raws = entries.value.map((e) => e.raw)
  const bad = entries.value.filter((e) => e.exists === false).length
  if (bad > 0) {
    try {
      await ElMessageBox.confirm(
        `有 ${bad} 条路径在当前磁盘上不存在，保存后可能让相关命令失效。仍要保存吗？`,
        '存在无效路径',
        { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '返回检查' }
      )
    } catch (e) {
      return
    }
  }
  emit('save', { value: joinPath(raws), kind: expand.value ? 'ExpandString' : 'String' })
  visible.value = false
}

const preview = computed(() => joinPath(entries.value.map((e) => e.raw)))
// 值里含 %引用% 但类型是 REG_SZ 时，这些引用不会被展开，属于常见踩坑
const refWithStringKind = computed(
  () => !expand.value && entries.value.some((e) => /%[^%]+%/.test(e.raw))
)
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="'编辑 PATH（' + scopeLabel + '）'"
    width="90%"
    top="6vh"
    class="path-dialog"
  >
    <div class="path-toolbar">
      <el-button size="small" @click="addRow">添加一条</el-button>
      <el-button size="small" @click="addFromFolder">选择文件夹</el-button>
      <el-button size="small" @click="dedupe">去除重复</el-button>
      <el-button size="small" :loading="checking" @click="recheck">重新校验</el-button>
      <span class="path-stat">
        共 {{ entries.length }} 条<template v-if="badCount">，<span class="bad-text">{{ badCount }} 条不存在</span></template>
      </span>
    </div>

    <div class="path-list">
      <div
        v-for="(e, i) in entries"
        :key="i"
        class="path-row"
        :class="{ 'is-bad': e.exists === false }"
        @dragover.prevent
        @drop="onDrop(i)"
      >
        <span class="drag-handle" draggable="true" title="拖动排序" @dragstart="onDragStart(i)">⋮⋮</span>
        <div class="path-main">
          <el-input v-model="e.raw" size="small" placeholder="C:\path\to\bin" />
          <div v-if="e.expanded && e.expanded !== e.raw" class="path-expanded">
            展开后：{{ e.expanded }}
          </div>
        </div>
        <el-tag v-if="e.exists === false" type="danger" size="small" effect="dark">不存在</el-tag>
        <el-tag v-else-if="e.exists" type="success" size="small" effect="plain">有效</el-tag>
        <el-tag v-else type="info" size="small" effect="plain">空</el-tag>
        <div class="path-ops">
          <el-button
            size="small"
            text
            type="primary"
            :disabled="!e.raw.trim()"
            title="在资源管理器中打开"
            @click="openEntry(e.raw)"
          >
            打开
          </el-button>
          <el-button size="small" text :disabled="i === 0" title="置顶" @click="toTop(i)">⇧</el-button>
          <el-button size="small" text :disabled="i === 0" title="上移" @click="move(i, -1)">↑</el-button>
          <el-button
            size="small"
            text
            :disabled="i === entries.length - 1"
            title="下移"
            @click="move(i, 1)"
          >
            ↓
          </el-button>
          <el-button size="small" text type="danger" title="删除" @click="remove(i)">删</el-button>
        </div>
      </div>
      <div v-if="!entries.length" class="path-empty">PATH 为空，点击「添加一条」开始</div>
    </div>

    <div class="path-preview-label">保存后的值：</div>
    <div class="path-preview">{{ preview || '（空）' }}</div>

    <div class="path-kind">
      <el-checkbox v-model="expand" size="small">
        以 REG_EXPAND_SZ 保存（值里的 %变量% 会被展开）
      </el-checkbox>
      <div v-if="refWithStringKind" class="tip">
        当前含 %引用%，关闭该选项后它们会作为普通文本保存，不会被展开
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="emptyCount > 0" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.path-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.path-stat {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.bad-text {
  color: var(--el-color-danger);
}
.path-list {
  max-height: 46vh;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px;
}
.path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 4px;
}
.path-row:hover {
  background: var(--el-fill-color-light);
}
.path-row.is-bad {
  background: var(--el-color-danger-light-9);
}
.drag-handle {
  cursor: move;
  color: var(--el-text-color-placeholder);
  letter-spacing: -2px;
  user-select: none;
}
.path-main {
  flex: 1;
  min-width: 0;
}
.path-expanded {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  word-break: break-all;
}
.path-ops {
  display: flex;
  flex-shrink: 0;
}
.path-ops .el-button {
  padding: 4px 6px;
}
.path-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: 16px;
}
.path-preview-label {
  margin: 10px 0 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.path-kind {
  margin-top: 8px;
}
.path-preview {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 100px;
  overflow: auto;
  word-break: break-all;
}
</style>
