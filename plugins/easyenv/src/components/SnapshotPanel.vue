<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fmtTime, isPathVar, kindLabel, splitPath, type EnvVar, type Snapshot } from '../api'

const props = defineProps<{
  modelValue: boolean
  isAdmin: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'restored'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const snapshots = ref<Snapshot[]>([])
const busy = ref('')

// 查看某份快照的内容
const viewing = ref<Snapshot | null>(null)
const viewTab = ref<'user' | 'machine'>('user')
const viewKeyword = ref('')

function load() {
  if (typeof window.services?.listSnapshots !== 'function') return
  const r = window.services.listSnapshots()
  snapshots.value = r.snapshots || []
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      viewing.value = null
      viewKeyword.value = ''
      viewTab.value = 'user'
      load()
    }
  }
)

const viewRows = computed<EnvVar[]>(() => {
  const s = viewing.value
  if (!s) return []
  const list = (viewTab.value === 'user' ? s.user : s.machine) || []
  const kw = viewKeyword.value.trim().toUpperCase()
  if (!kw) return list
  return list.filter(
    (v) => v.name.toUpperCase().includes(kw) || String(v.value).toUpperCase().includes(kw)
  )
})

// 单项快照（只记被改动的变量）
const isDiff = computed(() => !!viewing.value && Array.isArray(viewing.value.changes))

const diffRows = computed(() => {
  const s = viewing.value
  if (!s || !Array.isArray(s.changes)) return []
  const kw = viewKeyword.value.trim().toUpperCase()
  if (!kw) return s.changes
  return s.changes.filter(
    (c) =>
      c.name.toUpperCase().includes(kw) ||
      String(c.before).toUpperCase().includes(kw) ||
      String(c.after).toUpperCase().includes(kw)
  )
})

function scopeText(s: 'user' | 'machine'): string {
  return s === 'machine' ? '系统' : '用户'
}

function metaText(s: Snapshot): string {
  if (Array.isArray(s.changes)) {
    return `${s.reason} · ${s.changes.length} 项变更`
  }
  return `${s.reason} · 用户 ${(s.user || []).length} 项 / 系统 ${(s.machine || []).length} 项`
}

function openView(s: Snapshot) {
  viewing.value = s
  viewKeyword.value = ''
  viewTab.value = (s.user || []).length ? 'user' : 'machine'
}

async function createSnapshot() {
  busy.value = 'create'
  const r = await window.services.takeSnapshot('手动快照')
  busy.value = ''
  if (r.ok) {
    ElMessage.success('快照已创建')
    load()
  } else {
    ElMessage.error('创建快照失败：' + (r.error || '未知错误'))
  }
}

async function restore(s: Snapshot) {
  const target = Array.isArray(s.changes)
    ? `将把这 ${s.changes.length} 个变量恢复为「${fmtTime(s.ts)}」时的值，其它变量不受影响。`
    : `将把用户变量与系统变量整体恢复为「${fmtTime(s.ts)}」的状态。`
  try {
    await ElMessageBox.confirm(
      `${target}\n当前状态会先自动存一份快照，仍可再回滚回来。${
        props.isAdmin ? '' : '\n系统变量恢复会触发一次 UAC 提权确认。'
      }`,
      '回滚到该快照',
      { type: 'warning', confirmButtonText: '确认回滚', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  busy.value = s.id
  try {
    const r = await window.services.restoreSnapshot(s.id)
    if (r.ok) {
      ElMessage.success(
        `已回滚：用户变量 ${r.userChanges || 0} 项、系统变量 ${r.machineChanges || 0} 项`
      )
      viewing.value = null
      emit('restored')
      load()
    } else {
      ElMessage.error('回滚失败：' + (r.error || '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('回滚失败：' + (e?.message || e))
  } finally {
    busy.value = ''
  }
}

function exportOne(s: Snapshot) {
  const r = window.services.exportSnapshot(s.id)
  if (r.ok) {
    ElMessage.success('已导出到：' + r.path)
  } else {
    ElMessage.error('导出失败：' + (r.error || '未知错误'))
  }
}

async function remove(s: Snapshot) {
  try {
    await ElMessageBox.confirm(`删除 ${fmtTime(s.ts)} 的快照？此操作不可撤销。`, '删除快照', {
      type: 'warning'
    })
  } catch (e) {
    return
  }
  window.services.deleteSnapshot(s.id)
  if (viewing.value && viewing.value.id === s.id) viewing.value = null
  load()
}

function importOne() {
  const r = window.services.importSnapshot()
  if (r.ok) {
    ElMessage.success('已导入快照')
    load()
  } else if (r.error !== '已取消') {
    ElMessage.error('导入失败：' + (r.error || '未知错误'))
  }
}

// 列表里的值只做摘要，完整值在详情看
function valueBrief(v: EnvVar): string {
  const val = String(v.value || '')
  if (isPathVar(v.name)) return `${splitPath(val).length} 条路径`
  return val || '（空）'
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="viewing ? '快照内容 · ' + fmtTime(viewing.ts) : '环境变量快照'"
    width="90%"
    top="8vh"
  >
    <!-- ========== 列表视图 ========== -->
    <template v-if="!viewing">
      <div class="snap-toolbar">
        <el-button size="small" type="primary" :loading="busy === 'create'" @click="createSnapshot">
          立即快照
        </el-button>
        <el-button size="small" @click="importOne">导入快照</el-button>
        <span class="tip snap-tip">每次应用修改前自动快照，最多保留 20 份</span>
      </div>

      <div class="snap-list">
        <div v-for="s in snapshots" :key="s.id" class="snap-row" @click="openView(s)">
          <div class="snap-main">
            <div class="snap-time">{{ fmtTime(s.ts) }}</div>
            <div class="snap-meta">{{ metaText(s) }}</div>
          </div>
          <span class="snap-ops" @click.stop>
            <el-button size="small" text type="primary" :disabled="!!busy" @click="openView(s)">
              查看
            </el-button>
            <el-button size="small" text :loading="busy === s.id" :disabled="!!busy && busy !== s.id" @click="restore(s)">
              {{ busy === s.id ? '回滚中…' : '回滚' }}
            </el-button>
            <el-button size="small" text :disabled="!!busy" @click="exportOne(s)">导出</el-button>
            <el-button size="small" text type="danger" :disabled="!!busy" @click="remove(s)">
              删除
            </el-button>
          </span>
        </div>
        <div v-if="!snapshots.length" class="snap-empty">还没有快照</div>
      </div>
    </template>

    <!-- ========== 内容视图 ========== -->
    <template v-else>
      <div class="view-head">
        <el-button size="small" @click="viewing = null">← 返回列表</el-button>
        <span class="view-reason">{{ viewing.reason }}</span>
        <el-input
          v-model="viewKeyword"
          size="small"
          placeholder="搜索变量"
          clearable
          class="view-search"
        />
        <el-button size="small" @click="exportOne(viewing)">导出</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="busy === viewing.id"
          @click="restore(viewing)"
        >
          {{ busy === viewing.id ? '回滚中…' : '回滚到此快照' }}
        </el-button>
      </div>

      <!-- 单项快照：只展示这次改了哪几个变量 -->
      <el-table v-if="isDiff" :data="diffRows" size="small" max-height="360" empty-text="没有匹配的变量">
        <el-table-column label="作用域" width="72">
          <template #default="{ row }">
            <span class="snap-kind">{{ scopeText(row.scope) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="变量名" min-width="130">
          <template #default="{ row }">
            <span class="mono snap-name">{{ row.name || '(默认)' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="改前" min-width="150">
          <template #default="{ row }">
            <el-tooltip :content="row.existed ? row.before || '（空）' : '（原本不存在）'" placement="top" :show-after="400">
              <span class="mono snap-val before">
                {{ row.existed ? row.before || '（空）' : '（原本不存在）' }}
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="改后" min-width="150">
          <template #default="{ row }">
            <el-tooltip :content="row.after || '（已删除）'" placement="top" :show-after="400">
              <span class="mono snap-val after">{{ row.after || '（已删除）' }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <template v-else>
        <el-tabs v-model="viewTab">
          <el-tab-pane :label="'用户变量 (' + (viewing.user || []).length + ')'" name="user" />
          <el-tab-pane
            :label="'系统变量 (' + (viewing.machine || []).length + ')'"
            name="machine"
          />
        </el-tabs>

        <el-table :data="viewRows" size="small" max-height="360" empty-text="没有匹配的变量">
          <el-table-column label="变量名" min-width="150">
            <template #default="{ row }">
              <span class="mono snap-name">{{ row.name || '(默认)' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="112">
            <template #default="{ row }">
              <span class="snap-kind">{{ kindLabel(row.kind) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="值" min-width="200">
            <template #default="{ row }">
              <el-tooltip :content="row.value || '（空）'" placement="top" :show-after="400">
                <span class="mono snap-val">{{ valueBrief(row) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <div class="tip view-tip">
        {{ isDiff ? '这条快照只记录了被改动的那几项，回滚不会动其它变量' : '整份快照保存的是当时的原始值，可导出 JSON 长期存档' }}
      </div>
    </template>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.snap-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.snap-tip {
  margin-top: 0;
  margin-left: auto;
  font-size: 11px;
}
.snap-list {
  max-height: 55vh;
  overflow: auto;
}
.snap-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
}
.snap-row:hover {
  background: var(--el-fill-color-light);
}
.snap-main {
  flex: 1;
  min-width: 0;
}
.snap-time {
  font-size: 13px;
  font-weight: 600;
}
.snap-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  word-break: break-all;
}
.snap-ops {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}
.snap-ops :deep(.el-button + .el-button) {
  margin-left: 2px;
}
.snap-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: 24px;
}

.view-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.view-reason {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.view-search {
  width: 150px;
}
.mono {
  font-family: Consolas, 'Courier New', monospace;
}
.snap-name {
  font-size: 12.5px;
  word-break: break-all;
}
.snap-kind {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.snap-val {
  font-size: 12px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snap-val.before {
  color: var(--el-color-danger);
}
.snap-val.after {
  color: var(--el-color-success);
}
.view-tip {
  margin-top: 6px;
}
</style>
