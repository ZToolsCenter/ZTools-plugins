<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, RefreshRight } from '@element-plus/icons-vue'

interface LaunchAction {
  code?: string
  type?: string
  payload?: unknown
}

type FilterField = 'all' | 'name' | 'pid' | 'port' | 'local' | 'remote' | 'state' | 'protocol'

const FEATURE_CODE = 'port-use-win'

const entries = ref<PortUsage[]>([])
const loading = ref(false)
const killingPid = ref<number | null>(null)
const errorMessage = ref('')
const keyword = ref('')
const lastUpdatedAt = ref('')
const filterField = ref<FilterField>('all')

const FILTER_OPTIONS = [
  { label: '全部字段', value: 'all' },
  { label: '进程名', value: 'name' },
  { label: 'PID', value: 'pid' },
  { label: '端口', value: 'port' },
  { label: '本地地址', value: 'local' },
  { label: '远程地址', value: 'remote' },
  { label: '状态', value: 'state' },
  { label: '协议', value: 'protocol' }
] as const

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase()
}

function hasMeaningfulRemoteAddress(entry: PortUsage) {
  const remoteAddress = entry.remoteAddress.trim()
  return !['', '0.0.0.0:0', '*:*', '[::]:0'].includes(remoteAddress)
}

function includesInFields(fields: Array<string | number>, query: string) {
  return fields.some((item) => normalizeSearchText(String(item)).includes(query))
}

function matchEntryByField(entry: PortUsage, field: FilterField, value: string) {
  const query = normalizeSearchText(value)
  if (!query) {
    return true
  }

  if (field === 'all') {
    return includesInFields([
      entry.processName,
      entry.pid,
      entry.localAddress,
      entry.localHost,
      entry.localPort,
      entry.remoteAddress,
      entry.remoteHost,
      entry.remotePort,
      entry.protocol,
      entry.state
    ], query)
  }

  if (field === 'name') {
    return normalizeSearchText(entry.processName).includes(query)
  }

  if (field === 'pid') {
    return includesInFields([entry.pid], query)
  }

  if (field === 'port') {
    return includesInFields([entry.localPort, entry.remotePort], query)
  }

  if (field === 'local') {
    return includesInFields([entry.localAddress, entry.localHost, entry.localPort], query)
  }

  if (field === 'remote') {
    return includesInFields([entry.remoteAddress, entry.remoteHost, entry.remotePort], query)
  }

  if (field === 'state') {
    return normalizeSearchText(entry.state).includes(query)
  }

  if (field === 'protocol') {
    return normalizeSearchText(entry.protocol).includes(query)
  }

  return false
}

const filteredEntries = computed(() => {
  const query = normalizeSearchText(keyword.value)
  if (!query) {
    return entries.value
  }

  return entries.value.filter((entry) => matchEntryByField(entry, filterField.value, query))
})

function formatEntryMeta(entry: PortUsage) {
  return [`PID ${entry.pid}`, entry.protocol].join(' · ')
}

function getServices(): Services {
  if (window.services) {
    return window.services
  }

  const reason = window.servicesLoadError || 'preload 未注入 window.services'
  throw new Error(`${reason}\n请确认当前页面是通过 ZTools 插件运行，而不是直接在普通浏览器里打开。`)
}

function syncSubInput(value: string) {
  window.ztools?.setSubInputValue(value)
}

function resolveInitialKeyword(action: LaunchAction) {
  if (typeof action.payload !== 'string') {
    return ''
  }

  if (action.type === 'text' && action.code === FEATURE_CODE) {
    return ''
  }

  return action.payload.trim()
}

function formatTime(date: Date) {
  return date.toLocaleString('zh-CN', {
    hour12: false
  })
}

async function loadPortUsage() {
  loading.value = true
  errorMessage.value = ''

  try {
    const result = await Promise.resolve(getServices().getPortUsage())
    entries.value = result
    lastUpdatedAt.value = formatTime(new Date())
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取端口占用失败'
    errorMessage.value = message
    entries.value = []
  } finally {
    loading.value = false
  }
}

async function handleKillProcess(entry: PortUsage) {
  killingPid.value = entry.pid
  errorMessage.value = ''

  try {
    const result = await Promise.resolve(getServices().killProcess(entry.pid))
    const processName = result.processName || entry.processName
    window.ztools?.showNotification(`已结束进程 ${processName} (${entry.pid})`)
    ElMessage.success(`已结束进程 ${processName} (${entry.pid})`)
    await loadPortUsage()
  } catch (error) {
    const message = error instanceof Error ? error.message : '结束进程失败'
    errorMessage.value = message
    ElMessage.error(message)
  } finally {
    killingPid.value = null
  }
}

function setupSubInput(initialKeyword = '') {
  window.ztools?.setSubInput(
    (input: { text: string }) => {
      keyword.value = input.text.trim()
    },
    '输入搜索值，如 node / 82 / LISTENING / 127.0.0.1',
    true
  )
  syncSubInput(initialKeyword)
}

function handlePluginEnter(action: LaunchAction) {
  const initialKeyword = resolveInitialKeyword(action)
  keyword.value = initialKeyword
  setupSubInput(initialKeyword)
  void loadPortUsage()
}

function handlePluginOut() {
  keyword.value = ''
  void window.ztools?.removeSubInput()
}

onMounted(() => {
  const ztools = window.ztools

  if (!ztools) {
    return
  }

  ztools.setExpendHeight(720)
  ztools.onPluginEnter(handlePluginEnter)
  ztools.onPluginOut(handlePluginOut)
})

onBeforeUnmount(() => {
  void window.ztools?.removeSubInput()
})
</script>

<template>
  <div class="port-app">
    <div class="header">
      <div class="header-main">
        <div class="title-row">
          <h1>Windows 端口占用</h1>
          <el-tag class="count-badge" effect="light" round>
            {{ filteredEntries.length }}
          </el-tag>
        </div>
        <p class="subtitle">页面选择筛选字段，顶部搜索框只输入值；主表展示核心信息，展开行查看更多明细。</p>
      </div>
      <el-button class="refresh-button" type="primary" :loading="loading" @click="loadPortUsage">
        <el-icon><RefreshRight /></el-icon>
        {{ loading ? '刷新中...' : '刷新' }}
      </el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="filterField" class="filter-select" size="large">
        <el-option
          v-for="option in FILTER_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-tag effect="plain" round>搜索值：{{ keyword || '全部' }}</el-tag>
      <el-tag effect="plain" round>最后更新：{{ lastUpdatedAt || '--' }}</el-tag>
    </div>

    <el-alert v-if="errorMessage" class="error-message" type="error" :closable="false" show-icon>
      {{ errorMessage }}
    </el-alert>

    <div class="table-container">
      <el-empty
        v-if="!loading && filteredEntries.length === 0"
        class="empty-state"
        :description="keyword ? '没有匹配的端口记录。' : '未获取到端口记录。'"
      />

      <el-table
        v-else
        class="port-table"
        :data="filteredEntries"
        stripe
        table-layout="fixed"
        header-cell-class-name="port-table-header"
        cell-class-name="port-table-cell"
      >
        <el-table-column type="expand" width="52">
          <template #default="{ row }">
            <div class="details-panel">
              <div v-if="hasMeaningfulRemoteAddress(row)" class="detail-row">
                <span class="detail-label">远程地址</span>
                <span class="mono detail-value">{{ row.remoteAddress }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">状态</span>
                <span class="detail-value">{{ row.state || '--' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">本地 Host / Port</span>
                <span class="mono detail-value">{{ row.localHost }} / {{ row.localPort }}</span>
              </div>
              <div v-if="hasMeaningfulRemoteAddress(row)" class="detail-row">
                <span class="detail-label">远程 Host / Port</span>
                <span class="mono detail-value">{{ row.remoteHost }} / {{ row.remotePort }}</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="进程名" min-width="180">
          <template #default="{ row }">
            <div class="process-cell">
              <strong>{{ row.processName }}</strong>
              <span class="entry-meta">{{ formatEntryMeta(row) }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="监听地址" min-width="250">
          <template #default="{ row }">
            <span class="mono address-value">{{ row.localAddress }}</span>
          </template>
        </el-table-column>

        <el-table-column label="协议" width="90" align="center">
          <template #default="{ row }">
            <el-tag class="protocol-tag" :type="row.protocol === 'TCP' ? 'primary' : 'success'" round>
              {{ row.protocol }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-tooltip :content="`结束进程 ${row.processName} (${row.pid})`" placement="top">
              <el-button
                class="icon-button danger"
                type="danger"
                plain
                :loading="killingPid === row.pid"
                @click="handleKillProcess(row)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.port-app {
  padding: 22px;
  max-width: 800px;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.header-main {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-row h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
}

.count-badge {
  min-width: 42px;
  font-weight: 700;
}

.subtitle {
  margin: 10px 0 0;
  color: var(--text-subtle);
  font-size: 13px;
}

.refresh-button {
  border-radius: 12px;
  box-shadow: 0 10px 24px rgba(23, 119, 255, 0.28);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  color: var(--text-subtle);
  font-size: 13px;
}

.filter-select {
  width: 148px;
}

.error-message {
  margin-bottom: 14px;
}

.table-container {
  padding: 4px 0 0;
}

.process-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.process-cell strong {
  font-size: 15px;
  line-height: 1.2;
  word-break: break-word;
}

.entry-meta {
  color: var(--text-subtle);
  font-size: 12px;
}

.address-value {
  font-size: 14px;
  word-break: break-all;
}

.mono {
  font-family: var(--mono-font);
}

.protocol-tag {
  font-weight: 700;
}

.empty-state {
  padding: 42px 0;
}

.icon-button {
  border-radius: 12px;
}

.details-panel {
  display: grid;
  gap: 8px;
  padding: 8px 4px 8px 18px;
}

.detail-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.detail-label {
  color: var(--text-subtle);
  font-size: 12px;
}

.detail-value {
  word-break: break-all;
}

@media (max-width: 720px) {
  .port-app {
    padding: 16px;
  }

  .header {
    flex-direction: column;
    align-items: stretch;
  }

  .refresh-button {
    width: 100%;
  }

  .filter-select {
    width: 100%;
  }

  .detail-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}

:deep(.el-alert__content) {
  white-space: pre-wrap;
}

:deep(.port-table) {
  border: 1px solid var(--border-color);
  border-radius: 18px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: var(--shadow-panel);
}

:deep(.port-table .el-table__inner-wrapper::before) {
  display: none;
}

:deep(.port-table-header) {
  background: rgba(232, 239, 248, 0.92);
  color: var(--text-subtle);
  font-size: 12px;
  font-weight: 700;
}

:deep(.port-table-cell) {
  vertical-align: middle;
}

:deep(.port-table .el-table__expanded-cell) {
  background: rgba(23, 119, 255, 0.03);
}
</style>
