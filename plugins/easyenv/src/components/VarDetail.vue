<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  chipText,
  kindExplain,
  kindLabel,
  kindRegName,
  openInExplorer,
  pathCandidate,
  pickPath,
  sameValue,
  splitPath
} from '../api'

const props = defineProps<{
  modelValue: boolean
  name: string
  kind: string
  value: string
  expanded: string
  scopeLabel: string
  isPath: boolean
  envMap?: Record<string, string>
  presets?: string[]
  pending?: 'set' | 'delete' | 'add'
  pendingValue?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'edit-path'): void
  (e: 'switch-value', v: string): void
  (e: 'presets-change', values: string[]): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

// 值一栏必须是当前生效值；待确认的候选值单列一行，避免误以为已经改好
const pendingText = computed(() => {
  if (props.pending === 'add') return '新增，尚未写入（点列表里的「确认」才生效）'
  if (props.pending === 'set') return '已改，尚未写入（点列表里的「确认」才生效）'
  if (props.pending === 'delete') return '已标记删除，尚未写入（点列表里的「确认」才生效）'
  return ''
})

const hasPendingValue = computed(
  () => (props.pending === 'set' || props.pending === 'add') && !!props.pendingValue
)

// 展开后与原始值不同才值得展示，否则是噪音
const showExpanded = computed(
  () => !props.isPath && !!props.expanded && props.expanded !== props.value && /%[^%]+%/.test(props.value)
)

// 多路径变量（PATH 类）用表格展示，逐条给出展开值与存在性
const pathRows = computed(() => {
  if (!props.isPath) return []
  const list = splitPath(props.value)
  const checked =
    typeof window.services?.checkPaths === 'function'
      ? window.services.checkPaths(list, props.envMap || {})
      : list.map((raw) => ({ raw, expanded: raw, exists: true }))
  return list.map((raw, i) => ({
    idx: i + 1,
    raw,
    expanded: checked[i] ? checked[i].expanded : raw,
    exists: checked[i] ? checked[i].exists : true
  }))
})

function copy(text: string, label: string) {
  if (!text) return
  window.ztools.copyText(text)
  ElMessage.success('已复制' + label)
}

function copyPathRow(row: { raw: string }) {
  copy(row.raw, '路径')
}

// 值本身就是一条路径时，提供「在资源管理器中打开」
const canOpen = computed(() => !!pathCandidate(props.value))

function openValue() {
  openInExplorer(props.value, props.envMap || {})
}

function openEntry(raw: string) {
  openInExplorer(raw, props.envMap || {})
}

// 缺失的路径整行加底色，配合圆点 + 加粗红字，避免和小号标签混淆
function pathRowClass({ row }: { row: { exists: boolean } }) {
  return row.exists ? '' : 'path-missing-row'
}

// ==================== 备选值（快速切换） ====================

const presetList = computed(() => props.presets || [])

// 芯片列表 = 原值（不在备选里时补上）+ 备选值，原值永远能被点回去
const chipList = computed(() => {
  const list = [...presetList.value]
  if (props.value && !list.some((p) => sameValue(p, props.value))) list.unshift(props.value)
  return list
})

// 有未确认的候选值时高亮它，否则高亮当前生效值
const activeChip = computed(() => props.pendingValue || props.value)

function inPresets(v: string): boolean {
  return presetList.value.some((p) => sameValue(p, v))
}

function isOriginalChip(v: string): boolean {
  return !!props.value && sameValue(v, props.value) && !inPresets(v)
}

// 候选值（原值 + 备选）是否超过一个——只有一个时列表里不会有「切换」
const hasDistinctCandidate = computed(() => {
  const list = [props.value, ...presetList.value].filter(Boolean)
  return list.some((v) => !sameValue(v, props.value)) && list.length > 1
})

function commitPresets(values: string[]) {
  const uniq: string[] = []
  for (const v of values) {
    const s = String(v || '').trim()
    if (s && !uniq.some((x) => sameValue(x, s))) uniq.push(s)
  }
  emit('presets-change', uniq)
}

async function addPreset() {
  try {
    const r = (await ElMessageBox.prompt('输入一个备选值，之后可一键切换到它', '添加备选值', {
      inputValue: '',
      inputPlaceholder: 'D:\\devTools\\jdk\\jdk17',
      confirmButtonText: '添加',
      cancelButtonText: '取消'
    })) as { value?: string }
    const v = String((r && r.value) || '').trim()
    if (v) commitPresets([...presetList.value, v])
  } catch (e) {
    /* 取消 */
  }
}

function addPresetFromFolder() {
  const p = pickPath('folder', '选择作为备选值的目录')
  if (p) commitPresets([...presetList.value, p])
}

function removePreset(v: string) {
  commitPresets(presetList.value.filter((x) => !sameValue(x, v)))
}

function switchTo(v: string) {
  if (sameValue(v, activeChip.value)) {
    ElMessage.info('已经是这个值了')
    return
  }
  emit('switch-value', v)
}
</script>

<template>
  <el-dialog v-model="visible" title="变量详情" width="90%" top="10vh">
    <div class="detail">
      <div class="detail-row">
        <span class="detail-label">名称</span>
        <span class="detail-value mono clickable" title="点击复制变量名" @click="copy(name, '变量名')">
          {{ name || '(默认)' }}
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-label">作用域</span>
        <span class="detail-value">{{ scopeLabel }}</span>
      </div>

      <div class="detail-row">
        <span class="detail-label">类型</span>
        <span class="detail-value">
          <el-tooltip :content="kindExplain(kind, value)" placement="top" effect="light">
            <span class="kind-tip">
              {{ kindLabel(kind) }}
              <span class="reg-name">{{ kindRegName(kind) }}</span>
            </span>
          </el-tooltip>
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-label">值</span>
        <span class="detail-value hint">
          <template v-if="isPath">共 {{ pathRows.length }} 条路径（当前生效值），点行复制单条，点「打开」定位目录</template>
          <template v-else>当前生效值，点击下方内容即可复制</template>
        </span>
      </div>

      <!-- 多路径变量：表格展示 -->
      <el-table
        v-if="isPath"
        :data="pathRows"
        size="small"
        max-height="240"
        class="path-detail-table"
        :row-class-name="pathRowClass"
        @row-click="copyPathRow"
      >
        <el-table-column label="#" width="44" prop="idx" />
        <el-table-column label="路径" min-width="180">
          <template #default="{ row }">
            <div class="mono path-raw">{{ row.raw }}</div>
            <div v-if="row.expanded && row.expanded !== row.raw" class="path-exp">
              → {{ row.expanded }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="76" align="center">
          <template #default="{ row }">
            <span class="path-status" :class="row.exists ? 'ok' : 'bad'">
              <i class="dot"></i>{{ row.exists ? '存在' : '缺失' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="" width="56" align="center">
          <template #default="{ row }">
            <span @click.stop>
              <el-button size="small" text type="primary" @click="openEntry(row.raw)">
                打开
              </el-button>
            </span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 普通变量：整块可点击复制 -->
      <div
        v-else
        class="detail-block mono clickable"
        title="点击复制"
        @click="copy(value, '值')"
      >
        {{ value || '（空）' }}
      </div>

      <template v-if="showExpanded">
        <div class="detail-row">
          <span class="detail-label">实际生效</span>
          <span class="detail-value hint">展开 %引用% 后的值，点击可复制</span>
        </div>
        <div
          class="detail-block mono expanded clickable"
          title="点击复制"
          @click="copy(expanded, '生效值')"
        >
          {{ expanded }}
        </div>
      </template>

      <!-- 备选值：点一个就切过去 -->
      <div class="preset-head">
        <span class="detail-label">备选值</span>
        <div class="preset-ops">
          <el-button size="small" text type="primary" @click="addPreset">添加</el-button>
          <el-button size="small" text @click="addPresetFromFolder">选文件夹</el-button>
        </div>
      </div>
      <div class="preset-chips">
        <span
          v-for="v in chipList"
          :key="v"
          class="chip"
          :class="{ active: sameValue(v, activeChip) }"
          :title="v"
          @click="switchTo(v)"
        >
          <span v-if="isOriginalChip(v)" class="chip-badge">原值</span>
          <span class="chip-text">{{ chipText(v) }}</span>
          <i v-if="inPresets(v)" class="chip-x" title="移除该备选值" @click.stop="removePreset(v)">
            ✕
          </i>
        </span>
        <span v-if="!presetList.length" class="hint">
          还没有备选值。点「添加」写入另一个版本路径（如另一个 JDK），之后在列表或这里一键切换。
        </span>
        <span v-else-if="presetList.length === 1 && !hasDistinctCandidate" class="hint">
          只有原值这一个候选，列表里不会显示「切换」；再加一个不同的值才会出现。
        </span>
      </div>

      <div v-if="pendingText" class="pending-box">
        <div class="pending-line">{{ pendingText }}</div>
        <div v-if="hasPendingValue" class="pending-target">
          <span class="pending-label">待确认的新值</span>
          <span class="mono pending-val">{{ pendingValue }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="detail-footer">
        <el-button type="danger" plain @click="emit('delete')">删除</el-button>
        <div class="footer-right">
          <el-button v-if="canOpen" @click="openValue">打开目录</el-button>
          <el-button v-if="isPath" @click="emit('edit-path')">编辑路径</el-button>
          <el-button @click="visible = false">关闭</el-button>
          <el-button type="primary" @click="emit('edit')">编辑</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.detail-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 10px;
}
.detail-row:first-child {
  margin-top: 0;
}
.detail-label {
  flex-shrink: 0;
  width: 60px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.detail-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  word-break: break-all;
}
.kind-tip {
  cursor: help;
  border-bottom: 1px dashed var(--el-border-color);
}
.reg-name {
  margin-left: 6px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  font-family: Consolas, 'Courier New', monospace;
}
.detail-block {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-all;
  max-height: 180px;
  overflow: auto;
  user-select: text;
}
.detail-block.expanded {
  background: var(--el-color-primary-light-9);
}
.clickable {
  cursor: pointer;
}
.clickable:hover {
  background: var(--el-fill-color);
}
.hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.path-detail-table {
  margin-top: 4px;
}
.path-detail-table :deep(.el-table__row) {
  cursor: pointer;
}
.path-detail-table :deep(.path-missing-row) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}
.path-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
}
.path-status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.path-status.ok {
  color: var(--el-color-success);
}
.path-status.bad {
  color: var(--el-color-danger);
  font-weight: 600;
}
.path-raw {
  font-size: 12px;
  word-break: break-all;
}
.path-exp {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.pending-box {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}
.pending-line {
  font-size: 12px;
  color: var(--el-color-warning-dark-2);
}
.pending-target {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 4px;
}
.pending-label {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--el-color-warning-dark-2);
}
.pending-val {
  font-size: 12px;
  color: var(--el-text-color-regular);
  word-break: break-all;
  max-height: 4.2em;
  overflow: auto;
}
.preset-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.preset-ops {
  margin-left: auto;
  display: flex;
  align-items: center;
}
.preset-ops :deep(.el-button + .el-button) {
  margin-left: 0;
}
.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 260px;
  padding: 3px 8px;
  border-radius: 12px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.chip.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
  cursor: default;
}
.chip-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-badge {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-secondary);
  font-family: system-ui, sans-serif;
}
.chip.active .chip-badge {
  background: var(--el-color-primary-light-7);
  color: var(--el-color-primary);
}
.chip-x {
  font-style: normal;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  padding: 0 2px;
}
.chip-x:hover {
  color: var(--el-color-danger);
}
.mono {
  font-family: Consolas, 'Courier New', monospace;
}
.detail-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Element Plus 默认给相邻按钮加 12px 左边距，和 gap 叠加会错位 */
.detail-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
