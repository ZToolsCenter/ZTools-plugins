<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DiffDialog from './components/DiffDialog.vue'
import PathEditor from './components/PathEditor.vue'
import SnapshotPanel from './components/SnapshotPanel.vue'
import VarDetail from './components/VarDetail.vue'
import VarDialog from './components/VarDialog.vue'
import {
  isPathVar,
  nextPreset,
  presetKey,
  sameValue,
  scopeLabel,
  splitPath,
  type DiffItem,
  type EnvOp,
  type EnvVar,
  type Scope,
  type SnapshotChange
} from './api'

interface Row {
  name: string
  key: string
  kind: string
  value: string
  pending?: 'set' | 'delete' | 'add'
  newValue?: string
  newKind?: string
}

const scope = ref<Scope>('user')
const envVars = reactive<Record<Scope, EnvVar[]>>({ user: [], machine: [] })
// 待应用操作：按作用域分桶，name(大写) → 操作
const pending = reactive<Record<Scope, Record<string, EnvOp>>>({ user: {}, machine: {} })

const keyword = ref('')
const admin = ref(false)
const loading = ref(false)
const applying = ref(false)
const loadError = ref('')
// 备选值：{ 'machine:JAVA_HOME': ['...jdk8', '...jdk17'] }
const presets = ref<Record<string, string[]>>({})

// ==================== 读取 ====================

function hasService(name: string): boolean {
  return !!window.services && typeof (window.services as any)[name] === 'function'
}

async function loadScope(s: Scope) {
  const r = await window.services.listEnv(s)
  if (r.ok) {
    envVars[s] = r.vars || []
    if (s === scope.value) loadError.value = ''
  } else {
    if (s === scope.value) loadError.value = r.error || '读取失败'
  }
}

async function reload() {
  if (!hasService('listEnv')) {
    loadError.value = '插件服务未加载，请完全退出并重启 ZTools 后重试'
    return
  }
  loading.value = true
  try {
    await Promise.all([loadScope('user'), loadScope('machine')])
    loadPresets()
  } finally {
    loading.value = false
  }
}

// ==================== 备选值 ====================

function loadPresets() {
  if (!hasService('listPresets')) return
  const r = window.services.listPresets()
  presets.value = r.presets || {}
}

function presetsOf(s: Scope, name: string): string[] {
  return presets.value[presetKey(s, name)] || []
}

function writePresets(next: Record<string, string[]>) {
  if (!hasService('savePresets')) {
    ElMessage.error('插件服务未更新，请重启 ZTools 后重试')
    return
  }
  // 递进 Node 层前转成纯对象，避免响应式 Proxy 写库失败
  const r = window.services.savePresets(JSON.parse(JSON.stringify(next)))
  if (r.ok) presets.value = r.presets || {}
  else ElMessage.error('保存备选值失败：' + (r.error || '未知错误'))
}

function onPresetsChange(name: string, values: string[]) {
  const key = presetKey(scope.value, name)
  const next = { ...presets.value }
  if (values.length) next[key] = values
  else delete next[key]
  writePresets(next)
}

// 写入成功后把「改前 / 改后」都补进备选值，否则切走之后旧值就再也没有了。
// 只对已经有备选值的变量生效，避免给每个随手编辑的变量都攒出一条历史
function maintainPresets(changes: SnapshotChange[]) {
  if (!changes.length) return
  const next: Record<string, string[]> = { ...presets.value }
  let dirty = false
  for (const c of changes) {
    const key = presetKey(c.scope, c.name)
    const cur = next[key]
    if (!cur || !cur.length) continue
    const list = [...cur]
    for (const v of [c.before, c.after]) {
      const val = String(v || '').trim()
      if (!val) continue
      if (!list.some((x) => sameValue(x, val))) {
        list.push(val)
        dirty = true
      }
    }
    next[key] = list
  }
  if (dirty) writePresets(next)
}

function onDetailSwitch(v: string) {
  const r = detailRow.value
  if (!r) return
  const origin = (envVars[scope.value] || []).find((x) => x.name.toUpperCase() === r.key)
  // 点回原值 = 取消待确认；详情保持打开，方便继续挑
  if (origin && sameValue(v, origin.value)) {
    delete pending[scope.value][r.key]
    return
  }
  // 详情里点备选值同样只进待确认队列，不立即写入
  pending[scope.value][r.key] = { op: 'set', name: r.name, value: v, kind: effKind(r) }
}

function onDetailPresets(values: string[]) {
  if (!detailRow.value) return
  onPresetsChange(detailRow.value.name, values)
}

// ==================== 切换备选值（行内循环，确认才生效） ====================

const applyingRow = ref('')

// 一个变量真正可切换的候选集合 = 当前生效值 + 备选值（去重）。
// 「切换」按钮只在这个集合 ≥2 时出现：只剩一个候选（哪怕还留着一条备选）时切换没有意义
function switchCandidates(name: string): string[] {
  const s = scope.value
  const origin = (envVars[s] || []).find((v) => v.name.toUpperCase() === name.toUpperCase())
  const list: string[] = []
  if (origin && origin.value) list.push(origin.value)
  for (const p of presetsOf(s, name)) {
    if (!list.some((x) => sameValue(x, p))) list.push(p)
  }
  return list
}

function canSwitch(name: string): boolean {
  return switchCandidates(name).length >= 2
}

// 点一次滚到下一个值，只改界面上的待确认值，写不写由「确认」决定
function cycleSwitch(row: Row) {
  const s = scope.value
  const cycle = switchCandidates(row.name)
  if (cycle.length < 2) {
    ElMessage.info('没有可切换的备选值，先在详情里添加')
    return
  }
  const origin = (envVars[s] || []).find((v) => v.name.toUpperCase() === row.key)
  const current = showValue(row)
  const next = nextPreset(cycle, current)
  if (!next) return
  if (sameValue(next, current)) {
    ElMessage.info('只有这一个值可切')
    return
  }
  // 转回原值等于取消这次待确认，不留无意义的变更
  if (origin && sameValue(next, origin.value)) {
    delete pending[s][row.key]
    return
  }
  pending[s][row.key] = { op: 'set', name: row.name, value: next, kind: effKind(row) }
}

// 只保存这一行，其它待应用改动不动
async function applyRow(row: Row) {
  const s = scope.value
  const op = pending[s][row.key]
  if (!op || op.op === 'delete') return
  const changes = buildChanges(s).filter((c) => c.name.toUpperCase() === row.key)
  if (!changes.length) {
    delete pending[s][row.key]
    ElMessage.info('值没有变化')
    return
  }
  applyingRow.value = row.key
  try {
    const snap = await window.services.takeSnapshot(`保存 ${row.name} 前自动快照`, changes)
    if (!snap.ok) {
      ElMessage.error('创建快照失败，已中止：' + (snap.error || '未知错误'))
      return
    }
    const r = await window.services.applyOps(s, [{ ...op }])
    if (!r.ok) {
      ElMessage.error('写入失败：' + (r.error || '未知错误'))
      return
    }
    // 切换前是备选值的话，旧值自动留在候选里，保证随时能切回去
    maintainPresets(changes)
    delete pending[s][row.key]
    await reload()
    ElMessage.success(`${row.name} 已保存为 ${op.value}，已广播刷新（已打开的终端需重开）`)
  } finally {
    applyingRow.value = ''
  }
}

async function checkAdmin() {
  if (!hasService('isAdmin')) return
  try {
    admin.value = await window.services.isAdmin()
  } catch (e) {
    admin.value = false
  }
}

// ==================== 行数据（原值 + 待应用操作合并） ====================

function buildRows(s: Scope): Row[] {
  const list = envVars[s] || []
  const ops = pending[s]
  const seen = new Set<string>()
  const out: Row[] = []
  for (const v of list) {
    const k = v.name.toUpperCase()
    seen.add(k)
    const op = ops[k]
    if (!op) {
      out.push({ name: v.name, key: k, kind: v.kind, value: v.value })
    } else if (op.op === 'delete') {
      out.push({ name: v.name, key: k, kind: v.kind, value: v.value, pending: 'delete' })
    } else {
      out.push({
        name: v.name,
        key: k,
        kind: v.kind,
        value: v.value,
        pending: 'set',
        newValue: op.value || '',
        newKind: op.kind || v.kind
      })
    }
  }
  for (const k of Object.keys(ops)) {
    if (seen.has(k)) continue
    const op = ops[k]
    if (op.op === 'set') {
      out.push({
        name: op.name,
        key: k,
        kind: op.kind || 'String',
        value: '',
        pending: 'add',
        newValue: op.value || '',
        newKind: op.kind || 'String'
      })
    }
  }
  return out
}

const rows = computed(() => {
  const kw = keyword.value.trim().toUpperCase()
  const list = buildRows(scope.value)
  if (!kw) return list
  return list.filter(
    (r) => r.name.toUpperCase().includes(kw) || showValue(r).toUpperCase().includes(kw)
  )
})

function showValue(r: Row): string {
  if (r.pending === 'set' || r.pending === 'add') return r.newValue || ''
  return r.value || ''
}

function effKind(r: Row): string {
  return r.newKind || r.kind
}

// PATH 校验用的变量表：系统在前、用户覆盖（与 Windows 的展开优先级一致）
const envMapForCheck = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const v of envVars.machine || []) map[v.name] = v.value
  for (const v of envVars.user || []) map[v.name] = v.value
  return map
})

// ==================== 变更统计 / Diff ====================

function buildDiff(s: Scope): DiffItem[] {
  const list = envVars[s] || []
  const ops = pending[s]
  const cur = new Map(list.map((v) => [v.name.toUpperCase(), v]))
  const items: DiffItem[] = []
  for (const k of Object.keys(ops)) {
    const op = ops[k]
    const old = cur.get(k)
    if (op.op === 'delete') {
      if (old) items.push({ name: old.name, state: 'delete', before: old.value })
    } else if (!old) {
      items.push({ name: op.name, state: 'add', after: op.value || '' })
    } else if (old.value !== (op.value || '') || (op.kind || old.kind) !== old.kind) {
      items.push({ name: old.name, state: 'update', before: old.value, after: op.value || '' })
    }
  }
  return items
}

const userDiff = computed(() => buildDiff('user'))
const machineDiff = computed(() => buildDiff('machine'))
const pendingTotal = computed(() => userDiff.value.length + machineDiff.value.length)

function pendingCount(s: Scope): number {
  return buildDiff(s).length
}

// ==================== 编辑操作 ====================

const varDialog = reactive({
  visible: false,
  mode: 'add' as 'add' | 'edit',
  initName: '',
  initValue: '',
  initKind: 'String'
})
const pathDialog = reactive({ visible: false, value: '', kind: 'ExpandString' })
const snapshotVisible = ref(false)
const diffVisible = ref(false)

// 行详情：只存 key，行数据实时从当前列表算，待确认值变化时详情能立即跟上
const detail = reactive({ visible: false, key: '' })

function openDetail(row: Row) {
  detail.key = row.key
  detail.visible = true
}

const detailRow = computed<Row | null>(
  () => buildRows(scope.value).find((r) => r.key === detail.key) || null
)

// 详情页展示的必须是「当前注册表里的值」，不能被待确认的候选值顶掉
const detailValue = computed(() => {
  const r = detailRow.value
  if (!r) return ''
  return r.pending === 'add' ? r.newValue || '' : r.value || ''
})

// 待确认的目标值（切换/编辑后的候选值），详情里单独一行提示
const detailPendingValue = computed(() => {
  const r = detailRow.value
  if (!r) return ''
  if (r.pending === 'set' || r.pending === 'add') return r.newValue || ''
  return ''
})

const detailExpanded = computed(() => {
  const v = detailValue.value
  if (!v || !/%[^%]+%/.test(v)) return ''
  if (!hasService('expandEnvValue')) return ''
  return window.services.expandEnvValue(v, envMapForCheck.value)
})

function detailEdit() {
  const r = detailRow.value
  detail.visible = false
  if (r) openEdit(r)
}

function detailPath() {
  const r = detailRow.value
  detail.visible = false
  if (r) openPath(r)
}

function detailDelete() {
  const r = detailRow.value
  detail.visible = false
  if (r) queueDelete(r)
}

function openAdd() {
  varDialog.mode = 'add'
  varDialog.initName = ''
  varDialog.initValue = ''
  varDialog.initKind = 'String'
  varDialog.visible = true
}

function openEdit(row: Row) {
  if (row.pending === 'delete') {
    ElMessage.info('该变量已标记为删除，先撤销再编辑')
    return
  }
  varDialog.mode = 'edit'
  varDialog.initName = row.name
  varDialog.initValue = showValue(row)
  varDialog.initKind = effKind(row)
  varDialog.visible = true
}

function openPath(row: Row) {
  if (row.pending === 'delete') {
    ElMessage.info('该变量已标记为删除，先撤销再编辑')
    return
  }
  pathDialog.value = showValue(row)
  pathDialog.kind =
    (pending[scope.value]['PATH'] && (pending[scope.value]['PATH'].kind as string)) ||
    effKind(row) ||
    'ExpandString'
  pathDialog.visible = true
}

function onVarSave(payload: { name: string; value: string; kind: string }) {
  const key = payload.name.toUpperCase()
  if (varDialog.mode === 'add') {
    const exists =
      (envVars[scope.value] || []).some((v) => v.name.toUpperCase() === key) ||
      !!pending[scope.value][key]
    if (exists) {
      ElMessage.warning('该变量名已存在，请直接编辑它')
      return
    }
  }
  pending[scope.value][key] = {
    op: 'set',
    name: payload.name,
    value: payload.value,
    kind: payload.kind
  }
  ElMessage.success('已加入待应用修改')
}

function onPathSave(payload: { value: string; kind: string }) {
  const origin = (envVars[scope.value] || []).find((v) => v.name.toUpperCase() === 'PATH')
  const name = origin ? origin.name : 'Path'
  // 类型由用户在 PATH 编辑器里显式选择；默认沿用原类型（REG_EXPAND_SZ 不能被降级成 REG_SZ）
  pending[scope.value]['PATH'] = { op: 'set', name, value: payload.value, kind: payload.kind }
  ElMessage.success('PATH 已加入待应用修改')
}

function queueDelete(row: Row) {
  if (row.pending === 'add') {
    delete pending[scope.value][row.key]
    ElMessage.info('已移除新增项')
    return
  }
  if (row.pending === 'delete') return
  ElMessageBox.confirm(
    `将删除${scopeLabel(scope.value)}「${row.name}」，应用后相关程序可能无法正常启动。`,
    '删除变量',
    { type: 'warning', confirmButtonText: '标记删除', cancelButtonText: '取消' }
  )
    .then(() => {
      pending[scope.value][row.key] = { op: 'delete', name: row.name }
    })
    .catch(() => {
      /* 取消 */
    })
}

function undo(row: Row) {
  delete pending[scope.value][row.key]
}

function discardAll() {
  ElMessageBox.confirm('放弃当前所有未应用的修改？', '放弃修改', { type: 'warning' })
    .then(() => {
      pending.user = {}
      pending.machine = {}
      ElMessage.info('已放弃所有未应用修改')
    })
    .catch(() => {
      /* 取消 */
    })
}

// ==================== 应用 ====================

// 把待应用操作翻译成「变更清单」，快照只记这些项，回滚也只影响这些项
function buildChanges(s: Scope): SnapshotChange[] {
  const list = envVars[s] || []
  const cur = new Map(list.map((v) => [v.name.toUpperCase(), v]))
  const out: SnapshotChange[] = []
  for (const k of Object.keys(pending[s])) {
    const op = pending[s][k]
    const old = cur.get(k)
    if (op.op === 'delete') {
      if (!old) continue
      out.push({
        scope: s,
        name: old.name,
        before: old.value,
        after: '',
        existed: true,
        kindBefore: old.kind,
        kindAfter: old.kind
      })
    } else if (!old) {
      out.push({
        scope: s,
        name: op.name,
        before: '',
        after: op.value || '',
        existed: false,
        kindBefore: 'String',
        kindAfter: op.kind || 'String'
      })
    } else {
      const nextKind = op.kind || old.kind
      // 值与类型都没变就不算变更（比如切了一圈又切回原值）
      if (old.value === (op.value || '') && nextKind === old.kind) continue
      out.push({
        scope: s,
        name: old.name,
        before: old.value,
        after: op.value || '',
        existed: true,
        kindBefore: old.kind,
        kindAfter: nextKind
      })
    }
  }
  return out
}

async function doApply() {
  applying.value = true
  try {
    const userChanges = buildChanges('user')
    const machineChanges = buildChanges('machine')
    const changes = [...userChanges, ...machineChanges]
    if (!changes.length) {
      ElMessage.info('没有需要应用的修改')
      diffVisible.value = false
      return
    }
    // 快照只记本次改动的项，失败就不往下走
    const snap = await window.services.takeSnapshot('应用修改前自动快照', changes)
    if (!snap.ok) {
      ElMessage.error('创建快照失败，已中止写入：' + (snap.error || '未知错误'))
      return
    }

    const resultLines: string[] = []
    const applied: SnapshotChange[] = []

    if (userDiff.value.length) {
      // 传纯对象给 preload，避免把响应式 Proxy 递进 Node 层
      const ops = Object.values(pending.user).map((o) => ({ ...o }))
      const r = await window.services.applyOps('user', ops)
      if (r.ok) {
        pending.user = {}
        applied.push(...userChanges)
        resultLines.push(`用户变量 ${r.applied} 项`)
      } else {
        ElMessage.error('用户变量写入失败：' + (r.error || '未知错误'))
      }
    }

    if (machineDiff.value.length) {
      const ops = Object.values(pending.machine).map((o) => ({ ...o }))
      const r = await window.services.applyOps('machine', ops)
      if (r.ok) {
        pending.machine = {}
        applied.push(...machineChanges)
        resultLines.push(`系统变量 ${r.applied} 项`)
      } else {
        ElMessage.error('系统变量写入失败：' + (r.error || '未知错误'))
      }
    }

    // 有备选值的变量，把改前/改后都留在候选里，别让旧值丢掉
    maintainPresets(applied)

    diffVisible.value = false
    await reload()

    if (resultLines.length) {
      ElMessage.success(
        `已写入：${resultLines.join('、')}。已广播刷新，已打开的终端需重开才能读到新值`
      )
    }
  } catch (e: any) {
    ElMessage.error('应用失败：' + (e?.message || e))
  } finally {
    applying.value = false
  }
}

// ==================== 窗口高度自适应 ====================

let fitTimer: ReturnType<typeof setTimeout> | undefined
function fitHeight() {
  if (typeof (window.ztools as any).setExpendHeight !== 'function') return
  const h = Math.ceil(document.documentElement.scrollHeight)
  if (h > 100) window.ztools.setExpendHeight(Math.min(h, 760))
}
function scheduleFit() {
  clearTimeout(fitTimer)
  fitTimer = setTimeout(fitHeight, 150)
}

let entered = false

onMounted(() => {
  window.ztools.onPluginEnter(() => {
    entered = true
    checkAdmin()
    reload().then(scheduleFit)
  })
  // 兜底：个别宿主时序下 onPluginEnter 可能不触发
  setTimeout(() => {
    if (!entered) {
      checkAdmin()
      reload().then(scheduleFit)
    }
  }, 800)
  scheduleFit()
  const el = document.querySelector('.app')
  if (el) new ResizeObserver(scheduleFit).observe(el)
})
</script>

<template>
  <div class="app">
    <div class="header">
      <div class="header-left">
        <el-radio-group v-model="scope" size="small">
          <el-radio-button value="user">用户变量</el-radio-button>
          <el-radio-button value="machine">
            系统变量<template v-if="pendingCount('machine')">
              ({{ pendingCount('machine') }})</template>
          </el-radio-button>
        </el-radio-group>
        <el-tooltip
          :content="
            admin
              ? 'ZTools 以管理员运行，写系统变量不会弹 UAC'
              : '写系统变量时会弹一次 UAC 提权确认'
          "
          placement="bottom"
        >
          <el-tag :type="admin ? 'success' : 'info'" size="small">
            {{ admin ? '管理员' : '普通权限' }}
          </el-tag>
        </el-tooltip>
      </div>
      <div class="header-right">
        <el-input v-model="keyword" size="small" placeholder="搜索变量" clearable class="search" />
        <el-button size="small" @click="openAdd">新建</el-button>
        <el-button size="small" @click="snapshotVisible = true">快照</el-button>
        <el-button size="small" :loading="loading" @click="reload">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      :closable="false"
      show-icon
      class="load-error"
    />

    <el-table
      v-loading="loading"
      :data="rows"
      size="small"
      max-height="440"
      row-key="key"
      class="env-table"
      empty-text="没有匹配的变量"
      @row-click="openDetail"
    >
      <el-table-column label="变量名" min-width="170">
        <template #default="{ row }">
          <span class="var-name" :class="{ 'is-del': row.pending === 'delete' }">
            {{ row.name || '(默认)' }}
          </span>
          <el-tag
            v-if="row.pending === 'add'"
            type="success"
            size="small"
            effect="plain"
            class="pl"
          >
            新增
          </el-tag>
          <el-tag
            v-else-if="row.pending === 'set'"
            type="warning"
            size="small"
            effect="plain"
            class="pl"
          >
            待确认
          </el-tag>
          <el-tag
            v-else-if="row.pending === 'delete'"
            type="danger"
            size="small"
            effect="plain"
            class="pl"
          >
            待删除
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="值" min-width="300">
        <template #default="{ row }">
          <div class="val-cell" :class="{ 'is-del': row.pending === 'delete' }">
            <template v-if="isPathVar(row.name)">
              <el-tag size="small" type="info" effect="plain">
                {{ splitPath(showValue(row)).length }} 条路径
              </el-tag>
              <span class="val-text">{{ splitPath(showValue(row)).slice(0, 2).join(' ; ') }}</span>
            </template>
            <span v-else class="val-text">{{ showValue(row) || '（空）' }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="210" align="right">
        <template #default="{ row }">
          <!-- 包一层阻断冒泡：点操作按钮不应该同时打开行详情 -->
          <span @click.stop>
            <el-tooltip
              v-if="canSwitch(row.name)"
              content="点一次换下一个值；不点「确认」不会写入"
              placement="top"
            >
              <el-button size="small" text type="warning" @click="cycleSwitch(row)">切换</el-button>
            </el-tooltip>
            <template v-if="row.pending">
              <el-button
                v-if="row.pending !== 'delete'"
                size="small"
                text
                type="primary"
                :loading="applyingRow === row.key"
                @click="applyRow(row)"
              >
                确认
              </el-button>
              <el-button size="small" text @click="undo(row)">撤销</el-button>
            </template>
            <template v-else>
              <el-button
                v-if="isPathVar(row.name)"
                size="small"
                text
                type="primary"
                @click="openPath(row)"
              >
                路径
              </el-button>
              <el-button size="small" text @click="openEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="queueDelete(row)">删除</el-button>
            </template>
          </span>
        </template>
      </el-table-column>
    </el-table>

    <div class="table-hint">
      点击行看详情；有备选值的变量点「切换」就地换下一个值，可以一直点，点「确认」才真正写入
    </div>

    <div v-if="pendingTotal" class="apply-bar">
      <span class="apply-text">
        未应用修改 <b>{{ pendingTotal }}</b> 项<template v-if="machineDiff.length">
          （其中系统变量 {{ machineDiff.length }} 项需提权）</template>
      </span>
      <div>
        <el-button size="small" @click="discardAll">放弃</el-button>
        <el-button size="small" type="primary" @click="diffVisible = true">
          查看变更并应用
        </el-button>
      </div>
    </div>

    <VarDetail
      v-model="detail.visible"
      :name="detailRow ? detailRow.name : ''"
      :kind="detailRow ? effKind(detailRow) : 'String'"
      :value="detailValue"
      :expanded="detailExpanded"
      :scope-label="scopeLabel(scope)"
      :is-path="!!detailRow && isPathVar(detailRow.name)"
      :env-map="envMapForCheck"
      :presets="detailRow ? presetsOf(scope, detailRow.name) : []"
      :pending="detailRow ? detailRow.pending : undefined"
      :pending-value="detailPendingValue"
      @edit="detailEdit"
      @delete="detailDelete"
      @edit-path="detailPath"
      @switch-value="onDetailSwitch"
      @presets-change="onDetailPresets"
    />

    <VarDialog
      v-model="varDialog.visible"
      :mode="varDialog.mode"
      :scope-label="scopeLabel(scope)"
      :init-name="varDialog.initName"
      :init-value="varDialog.initValue"
      :init-kind="varDialog.initKind"
      @save="onVarSave"
    />

    <PathEditor
      v-model="pathDialog.visible"
      :value="pathDialog.value"
      :kind="pathDialog.kind"
      :scope-label="scopeLabel(scope)"
      :env-map="envMapForCheck"
      @save="onPathSave"
    />

    <DiffDialog
      v-model="diffVisible"
      :user-diff="userDiff"
      :machine-diff="machineDiff"
      :is-admin="admin"
      :applying="applying"
      @confirm="doApply"
    />

    <SnapshotPanel v-model="snapshotVisible" :is-admin="admin" @restored="reload" />
  </div>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.search {
  width: 160px;
}
.load-error {
  margin-bottom: 10px;
}
.table-hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.env-table :deep(.el-table__row) {
  cursor: pointer;
}
.var-name {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12.5px;
  word-break: break-all;
}
.pl {
  margin-left: 6px;
}
.val-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.val-text {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.is-del .val-text,
.var-name.is-del {
  text-decoration: line-through;
  color: var(--el-text-color-disabled);
}
.apply-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-5);
}
.apply-text {
  font-size: 12px;
  flex: 1;
}
</style>
