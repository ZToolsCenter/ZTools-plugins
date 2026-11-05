<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchServices,
  isNssmService,
  pollUntilSettled,
  stateTagType,
  stateText,
  startModeText,
  type NssmConfig,
  type NssmDetect,
  type ServiceAction,
  type ServiceInfo
} from '../api'
import { confirmAndRun } from '../run'
import ServiceForm from '../components/ServiceForm.vue'

const props = defineProps<{ env: NssmDetect }>()
const emit = defineEmits<{ (e: 'open-path'): void }>()

const services = ref<ServiceInfo[]>([])
const loading = ref(false)

const formVisible = ref(false)
const formMode = ref<'install' | 'edit'>('install')
const editName = ref('')
const editConfig = ref<NssmConfig>({})
const editStartMode = ref('')

const detailVisible = ref(false)
const detailSvc = ref<ServiceInfo | null>(null)
const detailCfg = ref<NssmConfig | null>(null)
const cfgError = ref('')

const nssmServices = computed(() => services.value.filter((s) => isNssmService(s)))

// 搜索 + 状态筛选（与系统服务页一致）
const keyword = ref('')
const stateFilter = ref('')
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return nssmServices.value.filter((s) => {
    if (stateFilter.value && s.State !== stateFilter.value) return false
    if (!kw) return true
    return (
      (s.Name || '').toLowerCase().includes(kw) ||
      (s.DisplayName || '').toLowerCase().includes(kw)
    )
  })
})

async function refresh() {
  loading.value = true
  const r = await fetchServices()
  loading.value = false
  if (r.ok) services.value = r.services
}

function openDownload() {
  window.ztools.shellOpenExternal('https://nssm.cc/download')
}

function openInstall() {
  formMode.value = 'install'
  editName.value = ''
  editConfig.value = {}
  editStartMode.value = ''
  formVisible.value = true
}

async function openEdit(name: string) {
  const r = await window.services.getNssmConfig(name)
  if (!r.ok || !r.config) {
    ElMessage.error('读取 nssm 配置失败：' + (r.error || '未知错误'))
    return
  }
  const svc = services.value.find((s) => s.Name === name)
  formMode.value = 'edit'
  editName.value = name
  editConfig.value = r.config
  editStartMode.value = svc?.StartMode || ''
  formVisible.value = true
}

// 行点击 → 详情抽屉（服务信息 + nssm 参数）
async function openDetail(row: ServiceInfo) {
  detailSvc.value = row
  detailCfg.value = null
  cfgError.value = ''
  detailVisible.value = true
  const r = await window.services.getNssmConfig(row.Name)
  if (r.ok && r.config) detailCfg.value = r.config
  else cfgError.value = r.error || '读取失败'
}

function editFromDetail() {
  if (!detailSvc.value) return
  detailVisible.value = false
  openEdit(detailSvc.value.Name)
}

// ==================== 日志查看 ====================
const logVisible = ref(false)
const logSvcName = ref('')
const logPaths = ref<{ stdout: string; stderr: string }>({ stdout: '', stderr: '' })
const logSrc = ref<'stdout' | 'stderr'>('stdout')
const logContent = ref('')
const logTruncated = ref(false)
const logLoading = ref(false)
const logErr = ref('')
const logPreRef = ref<HTMLElement>()

async function loadLog() {
  const p = logSrc.value === 'stdout' ? logPaths.value.stdout : logPaths.value.stderr
  logLoading.value = true
  logErr.value = ''
  const r = await window.services.readLogTail(p, 200)
  logLoading.value = false
  if (r.ok) {
    logContent.value = r.content || '（文件为空）'
    logTruncated.value = !!r.truncated
    // 日志场景默认看最新内容：滚动到底部
    nextTick(() => {
      if (logPreRef.value) logPreRef.value.scrollTop = logPreRef.value.scrollHeight
    })
  } else {
    logContent.value = ''
    logErr.value = r.error || '读取失败'
  }
}

function openLog(src: 'stdout' | 'stderr') {
  if (!detailCfg.value) return
  logSvcName.value = detailSvc.value?.Name || ''
  logPaths.value = { stdout: str(detailCfg.value.AppStdout), stderr: str(detailCfg.value.AppStderr) }
  logSrc.value = src
  logVisible.value = true
  loadLog()
}

function rotateText(cfg: NssmConfig): string {
  if (str(cfg.AppRotateFiles) !== '1') return '关闭'
  const parts: string[] = []
  if (str(cfg.AppRotateOnline) === '1') parts.push('在线')
  if (cfg.AppRotateBytes) parts.push(Math.round(Number(cfg.AppRotateBytes) / 1048576) + ' MB')
  return '开启' + (parts.length ? '（' + parts.join('，') + '）' : '')
}

function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join('\n')
  return (v ?? '') as string
}

function envText(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.length ? v.join('；') : '-'
  return (v ?? '') ? String(v) : '-'
}

// nssm remove 是真删除（连注册表一起清掉），要求输入服务名确认
async function removeService(row: ServiceInfo) {
  try {
    const { value } = await ElMessageBox.prompt(
      `卸载会删除服务「${row.Name}」的全部注册信息，不可恢复。请输入服务名确认：`,
      '卸载 nssm 服务',
      {
        confirmButtonText: '下一步',
        cancelButtonText: '取消',
        inputValidator: (v: string) => v === row.Name || '服务名不匹配'
      }
    )
    const outcome = await confirmAndRun(`卸载服务 ${row.Name}`, [window.services.buildRemoveOp(props.env.path, row.Name)])
    if (outcome === 'success') ElMessage.success('已卸载：' + value)
    if (outcome !== 'canceled') await refresh()
  } catch (e) {
    /* 用户取消 */
  }
}

async function doAction(row: ServiceInfo, action: ServiceAction) {
  const label = { start: '启动', stop: '停止', restart: '重启' }[action]
  const outcome = await confirmAndRun(`${label}服务 ${row.Name}`, window.services.buildServiceActionOps(row.Name, action))
  // 取消不动列表；真正执行过（成败都）才刷新
  if (outcome === 'canceled') return
  await refresh()
  // 追踪中间态（启动中/停止中）直到落定，期间表格实时更新
  await pollUntilSettled(row.Name, (list) => {
    services.value = list
    if (detailSvc.value) {
      const s = list.find((x) => x.Name === detailSvc.value!.Name)
      if (s) detailSvc.value = s
    }
  })
}

function onSaved() {
  formVisible.value = false
  refresh()
}

defineExpose({ refresh, openEdit })
</script>

<template>
  <div>
    <!-- nssm 未就绪：引导（配置入口在全局头部「nssm 路径」按钮） -->
    <el-alert v-if="!env.found" type="error" :closable="false" style="margin-bottom: 10px">
      <template #title>
        未检测到可用的 nssm.exe —— 插件不内置二进制（避免杀软误报）。
        <el-link type="primary" style="vertical-align: baseline" @click="emit('open-path')">去配置路径</el-link>
        或
        <el-link type="primary" style="vertical-align: baseline" @click="openDownload">官网下载</el-link>
      </template>
    </el-alert>

    <div class="toolbar">
      <!-- 左上角：与系统服务页一致 -->
      <el-input
        v-model="keyword"
        placeholder="搜索服务名 / 显示名"
        clearable
        style="width: 200px"
        size="small"
      />
      <el-radio-group v-model="stateFilter" size="small">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="Running">运行中</el-radio-button>
        <el-radio-button value="Stopped">已停止</el-radio-button>
      </el-radio-group>
      <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
      <span class="tip">共 {{ filtered.length }} 项</span>
      <!-- 右上角：安装 -->
      <span style="flex: 1"></span>
      <el-button size="small" type="primary" :disabled="!env.found" @click="openInstall">安装新服务</el-button>
    </div>

    <el-table v-loading="loading" :data="filtered" size="small" max-height="400" @row-click="openDetail">
      <el-table-column label="服务名" min-width="140">
        <template #default="{ row }">
          <div class="svc-name">{{ row.Name }}</div>
          <div class="svc-sub">{{ row.DisplayName }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="stateTagType(row.State)" size="small">{{ stateText(row.State) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启动类型" width="90">
        <template #default="{ row }">{{ startModeText(row.StartMode) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230">
        <template #default="{ row }">
          <el-button size="small" type="primary" link @click.stop="openEdit(row.Name)">编辑</el-button>
          <el-button size="small" type="danger" link @click.stop="removeService(row)">卸载</el-button>
          <el-button size="small" type="success" link :disabled="row.State === 'Running'" @click.stop="doAction(row, 'start')">启动</el-button>
          <el-button size="small" type="warning" link :disabled="row.State === 'Stopped'" @click.stop="doAction(row, 'stop')">停止</el-button>
          <el-button size="small" type="primary" link :disabled="row.State === 'Stopped'" @click.stop="doAction(row, 'restart')">重启</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 详情抽屉：服务信息 + nssm 参数 -->
    <el-drawer v-model="detailVisible" :title="detailSvc?.Name" size="420px" :lock-scroll="false">
      <template v-if="detailSvc">
        <p class="kv"><span class="k">服务名</span><span class="v">{{ detailSvc.Name }}</span></p>
        <p class="kv"><span class="k">显示名</span><span class="v">{{ detailSvc.DisplayName || '-' }}</span></p>
        <p class="kv"><span class="k">状态</span><span class="v">{{ detailSvc.State }}</span></p>
        <p class="kv"><span class="k">启动类型</span><span class="v">{{ startModeText(detailSvc.StartMode) }}</span></p>
        <p class="kv"><span class="k">登录账户</span><span class="v">{{ detailSvc.StartName || '-' }}</span></p>
        <p class="kv"><span class="k">描述</span><span class="v">{{ detailSvc.Description || '-' }}</span></p>

        <el-divider content-position="left">NSSM 配置</el-divider>
        <template v-if="detailCfg">
          <p class="kv"><span class="k">程序路径</span><span class="v">{{ str(detailCfg.AppApplication) || '-' }}</span></p>
          <p class="kv"><span class="k">启动参数</span><span class="v">{{ str(detailCfg.AppParameters) || '-' }}</span></p>
          <p class="kv"><span class="k">启动目录</span><span class="v">{{ str(detailCfg.AppDirectory) || '-' }}</span></p>
          <p class="kv"><span class="k">stdout</span><span class="v">{{ str(detailCfg.AppStdout) || '-' }}</span></p>
          <p class="kv"><span class="k">stderr</span><span class="v">{{ str(detailCfg.AppStderr) || '-' }}</span></p>
          <p class="kv"><span class="k">日志轮转</span><span class="v">{{ rotateText(detailCfg) }}</span></p>
          <p class="kv"><span class="k">退出动作</span><span class="v">{{ str(detailCfg.AppExit) || '默认（重启）' }}</span></p>
          <p class="kv"><span class="k">重启延迟</span><span class="v">{{ str(detailCfg.AppRestartDelay) ? str(detailCfg.AppRestartDelay) + ' ms' : '-' }}</span></p>
          <p class="kv"><span class="k">崩溃节流</span><span class="v">{{ str(detailCfg.AppThrottle) ? str(detailCfg.AppThrottle) + ' ms' : '-' }}</span></p>
          <p class="kv"><span class="k">优先级</span><span class="v">{{ str(detailCfg.AppPriority) || '-' }}</span></p>
          <p class="kv"><span class="k">环境变量</span><span class="v">{{ envText(detailCfg.AppEnvironment) }}</span></p>
        </template>
        <el-alert v-else-if="cfgError" type="error" :title="cfgError" :closable="false" />
        <p v-else class="tip">正在读取 nssm 配置…</p>

        <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap">
          <el-button size="small" type="primary" @click="editFromDetail">编辑配置</el-button>
          <el-tooltip content="未配置该日志路径：编辑 → 日志 页添加并重启服务后可查看" :disabled="!!str(detailCfg?.AppStdout)" placement="top">
            <span>
              <el-button size="small" :disabled="!str(detailCfg?.AppStdout)" @click="openLog('stdout')">stdout 日志</el-button>
            </span>
          </el-tooltip>
          <el-tooltip content="未配置该日志路径：编辑 → 日志 页添加并重启服务后可查看" :disabled="!!str(detailCfg?.AppStderr)" placement="top">
            <span>
              <el-button size="small" :disabled="!str(detailCfg?.AppStderr)" @click="openLog('stderr')">stderr 日志</el-button>
            </span>
          </el-tooltip>
        </div>
      </template>
    </el-drawer>

    <!-- 日志查看弹窗 -->
    <el-dialog
      v-model="logVisible"
      :title="logSvcName + ' 日志（' + logSrc + '）'"
      width="90%"
      top="3vh"
      :lock-scroll="false"
      @closed="logContent = ''"
    >
      <div class="toolbar">
        <el-radio-group v-model="logSrc" size="small" @change="loadLog">
          <el-radio-button value="stdout">stdout</el-radio-button>
          <el-radio-button value="stderr">stderr</el-radio-button>
        </el-radio-group>
        <el-button size="small" :loading="logLoading" @click="loadLog">刷新</el-button>
        <span v-if="logTruncated" class="tip">文件较大，仅显示最后 200 行</span>
      </div>
      <el-alert v-if="logErr" type="error" :title="logErr" :closable="false" />
      <pre v-else ref="logPreRef" class="cmd-preview" style="max-height: 420px">{{ logContent }}</pre>
    </el-dialog>

    <ServiceForm
      v-if="formVisible"
      :mode="formMode"
      :nssm-path="env.path"
      :name="editName"
      :initial="editConfig"
      :start-mode="editStartMode"
      @saved="onSaved"
      @close="formVisible = false"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.svc-name {
  line-height: 1.3;
}

.svc-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
