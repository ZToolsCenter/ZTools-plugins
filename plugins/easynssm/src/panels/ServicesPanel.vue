<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchServices,
  isNssmService,
  pollUntilSettled,
  startModeText,
  stateTagType,
  stateText,
  START_TYPES,
  type ServiceAction,
  type ServiceInfo
} from '../api'
import { confirmAndRun } from '../run'

const emit = defineEmits<{ (e: 'manage-nssm', name: string): void }>()

const services = ref<ServiceInfo[]>([])
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const stateFilter = ref('')
const selected = ref<ServiceInfo | null>(null)
const drawer = ref(false)
const startType = ref('')
const applyingStartType = ref(false)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return services.value.filter((s) => {
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
  loadError.value = ''
  const r = await fetchServices()
  loading.value = false
  if (!r.ok) {
    loadError.value = r.error || '查询失败'
    return
  }
  services.value = r.services
}

function openDetail(s: ServiceInfo) {
  selected.value = s
  startType.value = s.StartMode === 'Auto' ? 'auto' : s.StartMode === 'Manual' ? 'manual' : 'disabled'
  drawer.value = true
}

async function doAction(name: string, action: ServiceAction) {
  const label = { start: '启动', stop: '停止', restart: '重启' }[action]
  const outcome = await confirmAndRun(`${label}服务 ${name}`, window.services.buildServiceActionOps(name, action))
  // 取消不动列表；真正执行过（成败都）才刷新
  if (outcome === 'canceled') return
  await refresh()
  // 追踪中间态（启动中/停止中）直到落定，期间表格实时更新
  await pollUntilSettled(name, (list) => {
    services.value = list
    if (selected.value) {
      const s = list.find((x) => x.Name === selected.value!.Name)
      if (s) selected.value = s
    }
  })
}

async function applyStartType() {
  if (!selected.value) return
  const ok = await confirmAndRun(
    `修改启动类型 ${selected.value.Name}`,
    window.services.buildStartTypeOp(selected.value.Name, startType.value)
  )
  if (ok) {
    await refresh()
    const s = services.value.find((x) => x.Name === selected.value!.Name)
    if (s) selected.value = s
    ElMessage.success('启动类型已修改')
  }
}

defineExpose({ refresh })
</script>

<template>
  <div>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索服务名 / 显示名"
        clearable
        style="width: 220px"
        size="small"
      />
      <el-radio-group v-model="stateFilter" size="small">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="Running">运行中</el-radio-button>
        <el-radio-button value="Stopped">已停止</el-radio-button>
      </el-radio-group>
      <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
      <span class="tip">共 {{ filtered.length }} 项</span>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" :closable="false" />

    <el-table
      v-loading="loading"
      :data="filtered"
      size="small"
      max-height="440"
      @row-click="openDetail"
    >
      <el-table-column label="显示名" min-width="180">
        <template #default="{ row }">
          <div class="svc-name">{{ row.DisplayName || row.Name }}</div>
          <div class="svc-sub">{{ row.Name }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="stateTagType(row.State)" size="small">{{ stateText(row.State) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启动类型" width="90">
        <template #default="{ row }">{{ startModeText(row.StartMode) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="80">
        <template #default="{ row }">
          <el-tag
            v-if="isNssmService(row)"
            type="warning"
            size="small"
            style="cursor: pointer"
            @click.stop="emit('manage-nssm', row.Name)"
          >NSSM</el-tag>
          <span v-else class="tip">系统</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <el-button
            size="small"
            type="success"
            link
            :disabled="row.State === 'Running'"
            @click.stop="doAction(row.Name, 'start')"
          >启动</el-button>
          <el-button
            size="small"
            type="danger"
            link
            :disabled="row.State === 'Stopped'"
            @click.stop="doAction(row.Name, 'stop')"
          >停止</el-button>
          <el-button
            size="small"
            type="primary"
            link
            :disabled="row.State === 'Stopped'"
            @click.stop="doAction(row.Name, 'restart')"
          >重启</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer v-model="drawer" :title="selected?.DisplayName || selected?.Name" size="420px" :lock-scroll="false">
      <template v-if="selected">
        <p class="kv"><span class="k">服务名</span><span class="v">{{ selected.Name }}</span></p>
        <p class="kv"><span class="k">状态</span><span class="v">{{ selected.State }}</span></p>
        <p class="kv"><span class="k">启动类型</span><span class="v">{{ startModeText(selected.StartMode) }}</span></p>
        <p class="kv"><span class="k">可执行路径</span><span class="v">{{ selected.PathName || '-' }}</span></p>
        <p class="kv"><span class="k">登录账户</span><span class="v">{{ selected.StartName || '-' }}</span></p>
        <p class="kv"><span class="k">进程 PID</span><span class="v">{{ selected.ProcessId || '-' }}</span></p>
        <p class="kv"><span class="k">退出码</span><span class="v">{{ selected.ExitCode || '-' }}</span></p>
        <p class="kv"><span class="k">描述</span><span class="v">{{ selected.Description || '-' }}</span></p>

        <el-divider />
        <div class="start-type">
          <span>修改启动类型：</span>
          <el-select v-model="startType" size="small" style="width: 150px">
            <el-option
              v-for="t in START_TYPES"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
          <el-button size="small" type="primary" :loading="applyingStartType" @click="applyStartType">
            应用
          </el-button>
          <p class="tip">对 nssm 服务同样生效（sc config）。修改立即写注册表，无需重启服务。</p>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
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
