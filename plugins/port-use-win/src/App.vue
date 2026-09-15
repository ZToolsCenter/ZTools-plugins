<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Aim,
  Connection,
  DataLine,
  Delete,
  Monitor,
  RefreshRight,
  Search
} from '@element-plus/icons-vue'

interface LaunchAction {
  code?: string
  type?: string
  payload?: unknown
}

type ConnectionCategory = 'all' | 'tcp' | 'udp' | 'listening' | 'active'

const FEATURE_CODE = 'port-use-win'

const entries = ref<PortUsage[]>([])
const loading = ref(false)
const killingPid = ref<number | null>(null)
const errorMessage = ref('')
const keyword = ref('')
const lastUpdatedAt = ref('')
const connectionCategory = ref<ConnectionCategory>('all')

const CATEGORY_OPTIONS = [
  { label: '全部连接', value: 'all', icon: Search },
  { label: 'TCP', value: 'tcp', icon: Connection },
  { label: 'UDP', value: 'udp', icon: Aim },
  { label: '监听端口', value: 'listening', icon: Monitor },
  { label: '活跃连接', value: 'active', icon: DataLine }
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

function matchesSearch(entry: PortUsage, value: string) {
  const query = normalizeSearchText(value)
  if (!query) {
    return true
  }

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

function matchesCategory(entry: PortUsage, category: ConnectionCategory) {
  const protocol = entry.protocol.toUpperCase()
  const state = entry.state.toUpperCase()

  if (category === 'all') {
    return true
  }

  if (category === 'tcp' || category === 'udp') {
    return protocol === category.toUpperCase()
  }

  if (category === 'listening') {
    return state === 'LISTENING'
  }

  return hasMeaningfulRemoteAddress(entry) && !['LISTENING', 'BOUND'].includes(state)
}

const filteredEntries = computed(() => {
  return entries.value.filter((entry) => {
    return matchesSearch(entry, keyword.value) && matchesCategory(entry, connectionCategory.value)
  })
})

function getCategoryCount(category: ConnectionCategory) {
  return entries.value.filter((entry) => {
    return matchesSearch(entry, keyword.value) && matchesCategory(entry, category)
  }).length
}

function selectCategory(category: ConnectionCategory) {
  connectionCategory.value = category
  window.ztools?.subInputFocus()
}

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

function applySearchKeyword(value: string) {
  keyword.value = value.trim()
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
      applySearchKeyword(input.text)
    },
    '输入搜索值，如 node / 82 / LISTENING / 127.0.0.1',
    true
  )
  syncSubInput(initialKeyword)
}

function handlePluginEnter(action: LaunchAction) {
  const initialKeyword = resolveInitialKeyword(action)
  connectionCategory.value = 'all'
  applySearchKeyword(initialKeyword)
  setupSubInput(initialKeyword)
  void loadPortUsage()
}

function handlePluginOut() {
  connectionCategory.value = 'all'
  applySearchKeyword('')
  void window.ztools?.removeSubInput()
}

onMounted(() => {
  const ztools = window.ztools

  if (!ztools) {
    return
  }

  ztools.setExpendHeight(580)
  ztools.onPluginEnter(handlePluginEnter)
  ztools.onPluginOut(handlePluginOut)
})

onBeforeUnmount(() => {
  void window.ztools?.removeSubInput()
})
</script>

<template>
  <div class="port-app">
    <aside class="category-sidebar">
      <div class="sidebar-label">连接分类</div>
      <nav class="category-nav" aria-label="连接分类">
        <button
          v-for="option in CATEGORY_OPTIONS"
          :key="option.value"
          class="category-option"
          :class="{ active: connectionCategory === option.value }"
          type="button"
          @click="selectCategory(option.value)"
        >
          <el-icon class="category-icon"><component :is="option.icon" /></el-icon>
          <span class="category-copy">
            <strong>{{ option.label }}</strong>
          </span>
          <span class="category-count">{{ getCategoryCount(option.value) }}</span>
        </button>
      </nav>
    </aside>

    <main class="content-panel">
      <header class="content-header">
        <div class="result-summary">
          <strong>{{ filteredEntries.length }}</strong>
          <span>条结果</span>
          <template v-if="keyword">
            <i></i>
            <span>“{{ keyword }}”</span>
          </template>
          <span class="update-time">更新：{{ lastUpdatedAt || '--' }}</span>
        </div>
        <el-button class="refresh-button" type="primary" :loading="loading" @click="loadPortUsage">
          <el-icon><RefreshRight /></el-icon>
          {{ loading ? '刷新中' : '刷新' }}
        </el-button>
      </header>

      <el-alert v-if="errorMessage" class="error-message" type="error" :closable="false" show-icon>
        {{ errorMessage }}
      </el-alert>

      <section class="table-container" aria-label="端口占用结果">
        <el-empty
          v-if="!loading && filteredEntries.length === 0"
          class="empty-state"
          :description="keyword ? '没有匹配的端口记录' : '未获取到端口记录'"
        />

        <el-table
          v-else
          class="port-table"
          :data="filteredEntries"
          height="100%"
          table-layout="fixed"
          header-cell-class-name="port-table-header"
          cell-class-name="port-table-cell"
        >
          <el-table-column type="expand" width="36">
            <template #default="{ row }">
              <div class="details-panel">
                <div class="detail-row">
                  <span class="detail-label">连接状态</span>
                  <strong class="detail-value">{{ row.state || '--' }}</strong>
                </div>
                <div class="detail-row">
                  <span class="detail-label">本地 Host / Port</span>
                  <span class="mono detail-value">{{ row.localHost }} / {{ row.localPort }}</span>
                </div>
                <div v-if="hasMeaningfulRemoteAddress(row)" class="detail-row">
                  <span class="detail-label">远程地址</span>
                  <span class="mono detail-value">{{ row.remoteAddress }}</span>
                </div>
                <div v-if="hasMeaningfulRemoteAddress(row)" class="detail-row">
                  <span class="detail-label">远程 Host / Port</span>
                  <span class="mono detail-value">{{ row.remoteHost }} / {{ row.remotePort }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="进程" width="150">
            <template #default="{ row }">
              <div class="process-cell">
                <span class="process-avatar">{{ row.processName.slice(0, 1).toUpperCase() }}</span>
                <span class="process-copy">
                  <strong>{{ row.processName }}</strong>
                  <small>{{ formatEntryMeta(row) }}</small>
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="本地监听" min-width="180">
            <template #default="{ row }">
              <div class="address-cell">
                <span class="mono address-value">{{ row.localHost }}</span>
                <strong class="mono port-value">{{ row.localPort }}</strong>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="88">
            <template #default="{ row }">
              <span class="state-label">{{ row.state || '--' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="协议" width="60" align="center">
            <template #default="{ row }">
              <span class="protocol-tag" :class="row.protocol.toLowerCase()">{{ row.protocol }}</span>
            </template>
          </el-table-column>

          <el-table-column width="48" align="center">
            <template #default="{ row }">
              <el-tooltip :content="`结束进程 ${row.processName} (${row.pid})`" placement="left">
                <el-button
                  class="kill-button"
                  text
                  :loading="killingPid === row.pid"
                  @click="handleKillProcess(row)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </main>
  </div>
</template>

<style scoped>
.port-app {
  display: grid;
  grid-template-columns: 172px minmax(0, 1fr);
  height: 580px;
  min-width: 760px;
  overflow: hidden;
  background: var(--bg-panel-strong);
}

.category-sidebar {
  display: flex;
  flex-direction: column;
  padding: 24px 14px 18px;
  border-right: 1px solid var(--border-color);
  background: var(--sidebar-bg);
}

.sidebar-label {
  padding: 1px 9px 13px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.category-nav {
  display: grid;
  gap: 4px;
}

.category-option {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 9px;
  border-radius: 10px;
  color: var(--text-subtle);
  text-align: left;
  background: transparent;
  transition: color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.category-option:hover {
  color: var(--text-main);
  background: var(--sidebar-hover);
  transform: translateX(2px);
}

.category-option.active {
  color: var(--accent);
  background: var(--accent-soft);
}

.category-option.active::before {
  position: absolute;
  left: -14px;
  width: 3px;
  height: 24px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
  content: '';
}

.category-icon {
  font-size: 17px;
}

.category-copy,
.category-copy strong {
  display: block;
  min-width: 0;
}

.category-copy strong {
  font-size: 13px;
  line-height: 1.2;
}

.category-count {
  min-width: 23px;
  padding: 2px 5px;
  border-radius: 999px;
  color: var(--text-faint);
  font-family: var(--mono-font);
  font-size: 9px;
  text-align: center;
  background: var(--count-bg);
}

.category-option.active .category-count {
  color: var(--accent);
  background: var(--bg-panel-strong);
}

.content-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 22px 20px 18px;
  background:
    linear-gradient(var(--content-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--content-grid) 1px, transparent 1px),
    var(--bg-panel-strong);
  background-size: 32px 32px;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  min-height: 36px;
  margin-bottom: 14px;
}

.result-summary {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-faint);
  font-size: 11px;
}

.result-summary strong {
  color: var(--text-main);
  font-family: var(--mono-font);
  font-size: 15px;
}

.result-summary i {
  width: 3px;
  height: 3px;
  margin: 0 4px;
  border-radius: 50%;
  background: var(--text-faint);
}

.update-time {
  margin-left: 8px;
}

.refresh-button {
  min-width: 86px;
  border-color: var(--accent);
  border-radius: 9px;
  color: #fff;
  background: var(--accent);
  box-shadow: 0 7px 18px rgba(23, 119, 255, 0.2);
}

.error-message {
  margin-bottom: 12px;
}

.table-container {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-panel);
  box-shadow: 0 16px 40px rgba(30, 55, 90, 0.08);
}

.process-cell {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.process-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--accent);
  font-family: var(--mono-font);
  font-size: 12px;
  font-weight: 700;
  background: var(--accent-soft);
}

.process-copy,
.process-copy strong,
.process-copy small {
  display: block;
  min-width: 0;
}

.process-copy strong {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-copy small {
  margin-top: 4px;
  color: var(--text-faint);
  font-size: 9px;
}

.address-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.address-value {
  overflow: hidden;
  color: var(--text-subtle);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.port-value {
  margin-left: auto;
  padding: 4px 7px;
  border-radius: 6px;
  color: var(--text-main);
  font-size: 11px;
  background: var(--count-bg);
}

.state-label {
  color: var(--text-subtle);
  font-family: var(--mono-font);
  font-size: 9px;
}

.mono {
  font-family: var(--mono-font);
}

.protocol-tag {
  display: inline-block;
  min-width: 38px;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--accent);
  font-family: var(--mono-font);
  font-size: 9px;
  font-weight: 700;
  background: var(--accent-soft);
}

.protocol-tag.udp {
  color: #13875a;
  background: rgba(32, 164, 107, 0.11);
}

.empty-state {
  padding: 120px 0;
}

.kill-button {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--text-faint);
}

.kill-button:hover {
  color: var(--danger-text);
  background: var(--danger-soft);
}

.details-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 24px;
  margin: 0 16px;
  padding: 18px;
  border-left: 2px solid var(--accent);
  background: var(--detail-bg);
}

.detail-row {
  min-width: 0;
}

.detail-label {
  display: block;
  margin-bottom: 5px;
  color: var(--text-faint);
  font-size: 9px;
}

.detail-value {
  display: block;
  font-size: 11px;
  word-break: break-all;
}

:deep(.el-alert__content) {
  white-space: pre-wrap;
}

:deep(.port-table .el-table__inner-wrapper::before) {
  display: none;
}

:deep(.port-table-header) {
  height: 38px;
  border-bottom-color: var(--border-color);
  color: var(--text-faint);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  background: var(--table-header-bg);
}

:deep(.port-table-cell) {
  height: 54px;
  border-bottom-color: var(--border-color);
  vertical-align: middle;
}

:deep(.port-table-header .cell),
:deep(.port-table-cell .cell) {
  padding-right: 8px;
  padding-left: 8px;
}

:deep(.port-table .el-table__row:hover > td.el-table__cell) {
  background: var(--table-hover);
}

:deep(.port-table .el-table__expanded-cell) {
  padding: 10px 0 14px;
  background: var(--bg-panel);
}
</style>
