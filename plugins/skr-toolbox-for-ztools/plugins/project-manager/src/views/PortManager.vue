<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import type { PortEntry } from '../api/types';

const { t } = useI18n();

const loading = ref(false);
const ports = ref<PortEntry[]>([]);
const searchQuery = ref('');
const protocolFilter = ref<'all' | 'TCP' | 'UDP'>('all');
const stateFilter = ref<'all' | 'LISTEN' | 'ESTABLISHED' | 'OTHER'>('all');
const detailVisible = ref(false);
const selectedPort = ref<PortEntry | null>(null);
const unsupportedMessage = ref('');

const summary = computed(() => ({
  total: ports.value.length,
  tcp: ports.value.filter(item => item.protocol === 'TCP').length,
  udp: ports.value.filter(item => item.protocol === 'UDP').length,
  listening: ports.value.filter(item => item.state === 'LISTEN').length,
}));

const filteredPorts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return ports.value.filter((item) => {
    if (protocolFilter.value !== 'all' && item.protocol !== protocolFilter.value) {
      return false;
    }

    if (stateFilter.value === 'LISTEN' && item.state !== 'LISTEN') {
      return false;
    }

    if (stateFilter.value === 'ESTABLISHED' && item.state !== 'ESTABLISHED') {
      return false;
    }

    if (stateFilter.value === 'OTHER' && (item.state === 'LISTEN' || item.state === 'ESTABLISHED')) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchPool = [
      item.protocol,
      item.state,
      item.local_address,
      String(item.local_port),
      item.remote_address || '',
      item.remote_port ? String(item.remote_port) : '',
      item.process_name || '',
      item.executable_path || '',
      item.command_line || '',
      item.pid ? String(item.pid) : '',
    ]
      .join(' ')
      .toLowerCase();

    return searchPool.includes(query);
  });
});

function formatEndpoint(address?: string | null, port?: number | null) {
  if (!address && !port) return '-';
  if (!port) return address || '-';
  return `${address || '0.0.0.0'}:${port}`;
}

function getStateTagType(state: string) {
  if (state === 'LISTEN') return 'success';
  if (state === 'ESTABLISHED') return 'primary';
  if (state === 'TIME_WAIT' || state === 'CLOSE_WAIT') return 'warning';
  return 'info';
}

function getRowKey(row: PortEntry) {
  return `${row.protocol}-${row.local_address}-${row.local_port}-${row.pid || 0}-${row.remote_address || ''}-${row.remote_port || 0}`;
}

async function loadPorts() {
  loading.value = true;
  unsupportedMessage.value = '';

  try {
    ports.value = await api.listUsedPorts();
  } catch (error) {
    ports.value = [];
    unsupportedMessage.value = String(error);
  } finally {
    loading.value = false;
  }
}

function viewProcess(entry: PortEntry) {
  selectedPort.value = entry;
  detailVisible.value = true;
}

async function openExecutableLocation() {
  if (!selectedPort.value?.executable_path) return;
  const exePath = selectedPort.value.executable_path;
  const index = Math.max(exePath.lastIndexOf('/'), exePath.lastIndexOf('\\'));
  const directory = index > 0 ? exePath.slice(0, index) : exePath;

  try {
    await api.openFolder(directory);
  } catch (error) {
    ElMessage.error(`${t('ports.openLocationFailed')}: ${String(error)}`);
  }
}

async function terminateProcess(entry: PortEntry) {
  if (!entry.pid) return;

  try {
    await ElMessageBox.confirm(
      t('ports.killConfirm', {
        process: entry.process_name || t('ports.unknownProcess'),
        pid: entry.pid,
      }),
      t('ports.killTitle'),
      {
        confirmButtonText: t('ports.killProcess'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  try {
    await api.terminateProcessByPid(entry.pid);
    ElMessage.success(t('ports.killSuccess', { pid: entry.pid }));
    if (selectedPort.value?.pid === entry.pid) {
      detailVisible.value = false;
    }
    await loadPorts();
  } catch (error) {
    ElMessage.error(`${t('ports.killFailed')}: ${String(error)}`);
  }
}

onMounted(() => {
  void loadPorts();
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0b1120]">
    <div class="shrink-0 border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#0f172a]">
      <div class="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-xs font-semibold tracking-[0.24em] uppercase text-slate-400 dark:text-slate-500">
            {{ t('ports.section') }}
          </div>
          <h2 class="mt-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
            {{ t('ports.title') }}
          </h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {{ t('ports.description') }}
          </p>
        </div>

        <button
          class="inline-flex items-center gap-2 rounded-xl border border-blue-200/70 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
          :disabled="loading"
          @click="loadPorts"
        >
          <div class="i-mdi-refresh text-base" :class="{ 'animate-spin': loading }" />
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>

      <div class="px-5 pb-4 grid gap-3 md:grid-cols-4">
        <div class="summary-card">
          <div class="summary-label">{{ t('ports.summaryTotal') }}</div>
          <div class="summary-value">{{ summary.total }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">TCP</div>
          <div class="summary-value">{{ summary.tcp }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">UDP</div>
          <div class="summary-value">{{ summary.udp }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">{{ t('ports.summaryListening') }}</div>
          <div class="summary-value">{{ summary.listening }}</div>
        </div>
      </div>

      <div class="px-5 pb-5 flex flex-wrap gap-3">
        <el-input
          v-model="searchQuery"
          :placeholder="t('ports.searchPlaceholder')"
          clearable
          class="max-w-sm"
        >
          <template #prefix>
            <el-icon><div class="i-mdi-magnify" /></el-icon>
          </template>
        </el-input>

        <el-select v-model="protocolFilter" class="w-36">
          <el-option :label="t('ports.protocolAll')" value="all" />
          <el-option label="TCP" value="TCP" />
          <el-option label="UDP" value="UDP" />
        </el-select>

        <el-select v-model="stateFilter" class="w-40">
          <el-option :label="t('ports.stateAll')" value="all" />
          <el-option :label="t('ports.stateListen')" value="LISTEN" />
          <el-option :label="t('ports.stateEstablished')" value="ESTABLISHED" />
          <el-option :label="t('ports.stateOther')" value="OTHER" />
        </el-select>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden px-5 py-4">
      <div
        v-if="unsupportedMessage"
        class="h-full rounded-2xl border border-amber-200/80 bg-amber-50/80 p-6 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
      >
        <div class="flex items-start gap-3">
          <div class="i-mdi-alert-circle-outline mt-0.5 text-xl" />
          <div>
            <div class="font-medium">{{ t('ports.unsupportedTitle') }}</div>
            <div class="mt-2 leading-6">{{ unsupportedMessage }}</div>
          </div>
        </div>
      </div>

      <div v-else class="h-full rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm shadow-slate-200/40 dark:border-slate-700/20 dark:bg-slate-900/70 dark:shadow-black/20 overflow-hidden">
        <el-table
          v-loading="loading"
          :data="filteredPorts"
          height="100%"
          stripe
          class="port-table"
          :empty-text="t('ports.empty')"
          :row-key="getRowKey"
        >
          <el-table-column prop="protocol" :label="t('ports.protocol')" width="90" />
          <el-table-column :label="t('ports.localEndpoint')" min-width="180">
            <template #default="{ row }">
              <span class="font-mono text-xs">{{ formatEndpoint(row.local_address, row.local_port) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('ports.remoteEndpoint')" min-width="180">
            <template #default="{ row }">
              <span class="font-mono text-xs">{{ formatEndpoint(row.remote_address, row.remote_port) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="state" :label="t('ports.state')" width="120">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" :type="getStateTagType(row.state)">
                {{ row.state }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="pid" label="PID" width="90" />
          <el-table-column prop="process_name" :label="t('ports.process')" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.process_name || t('ports.unknownProcess') }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('ports.actions')" width="168" fixed="right" header-align="center" align="center">
            <template #default="{ row }">
              <div class="flex items-center justify-center gap-2 whitespace-nowrap">
                <el-button text type="primary" @click="viewProcess(row)">
                  {{ t('ports.viewProcess') }}
                </el-button>
                <el-button
                  text
                  type="danger"
                  :disabled="!row.pid"
                  @click="terminateProcess(row)"
                >
                  {{ t('ports.killProcess') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog
      v-model="detailVisible"
      :title="t('ports.processDetail')"
      width="960px"
      class="app-dialog port-detail-dialog"
      append-to-body
    >
      <template v-if="selectedPort">
        <el-descriptions :column="1" border class="port-detail-descriptions">
          <el-descriptions-item :label="t('ports.process')">
            {{ selectedPort.process_name || t('ports.unknownProcess') }}
          </el-descriptions-item>
          <el-descriptions-item label="PID">
            {{ selectedPort.pid || '-' }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('ports.protocol')">
            {{ selectedPort.protocol }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('ports.localEndpoint')">
            <span class="font-mono">{{ formatEndpoint(selectedPort.local_address, selectedPort.local_port) }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('ports.remoteEndpoint')">
            <span class="font-mono">{{ formatEndpoint(selectedPort.remote_address, selectedPort.remote_port) }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('ports.state')">
            {{ selectedPort.state }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('ports.executablePath')">
            <div class="space-y-2">
              <div class="detail-value-block font-mono text-xs">{{ selectedPort.executable_path || '-' }}</div>
              <el-button
                v-if="selectedPort.executable_path"
                text
                type="primary"
                @click="openExecutableLocation"
              >
                {{ t('ports.openLocation') }}
              </el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item :label="t('ports.commandLine')">
            <div class="detail-value-block font-mono text-xs leading-6">
              {{ selectedPort.command_line || '-' }}
            </div>
          </el-descriptions-item>
        </el-descriptions>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="detailVisible = false">{{ t('common.close') }}</el-button>
          <el-button
            v-if="selectedPort?.pid"
            type="danger"
            @click="terminateProcess(selectedPort)"
          >
            {{ t('ports.killProcess') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.summary-card {
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  padding: 14px 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(248, 250, 252, 0.78));
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.summary-label {
  font-size: 11px;
  color: rgb(100 116 139);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.summary-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 700;
  color: rgb(15 23 42);
}

:global(html.dark) .summary-card {
  border-color: rgba(51, 65, 85, 0.7);
  background:
    linear-gradient(180deg, rgba(30, 41, 59, 0.58), rgba(15, 23, 42, 0.72));
  box-shadow:
    0 16px 28px rgba(2, 6, 23, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

:global(html.dark) .summary-label {
  color: rgb(148 163 184);
}

:global(html.dark) .summary-value {
  color: rgb(241 245 249);
}

.port-table :deep(.el-table__cell) {
  background: transparent !important;
}

.port-table :deep(.el-table__fixed-right),
.port-table :deep(.el-table__fixed-right-patch) {
  background: rgba(255, 255, 255, 0.98) !important;
}

.port-table :deep(.el-table__fixed-right .el-table__cell),
.port-table :deep(.el-table-fixed-column--right),
.port-table :deep(.el-table-fixed-column--right .el-table__cell) {
  background: rgba(255, 255, 255, 0.98) !important;
}

.port-table :deep(.el-table__fixed-right::before) {
  width: 0;
}

.port-table :deep(.el-table__fixed-right) {
  box-shadow: -16px 0 20px -18px rgba(15, 23, 42, 0.22);
}

.port-detail-descriptions :deep(.el-descriptions__label.el-descriptions__cell) {
  width: 128px;
  white-space: nowrap;
  vertical-align: top;
}

.port-detail-descriptions :deep(.el-descriptions__content.el-descriptions__cell) {
  min-width: 0;
}

.detail-value-block {
  overflow-wrap: anywhere;
  word-break: break-word;
}

:global(html.dark) .port-table :deep(.el-table__fixed-right),
:global(html.dark) .port-table :deep(.el-table__fixed-right-patch),
:global(html.dark) .port-table :deep(.el-table__fixed-right .el-table__cell),
:global(html.dark) .port-table :deep(.el-table-fixed-column--right),
:global(html.dark) .port-table :deep(.el-table-fixed-column--right .el-table__cell) {
  background: rgba(15, 23, 42, 0.98) !important;
}

:global(html.dark) .port-table :deep(.el-table__fixed-right) {
  box-shadow: -16px 0 20px -18px rgba(2, 6, 23, 0.65);
}
</style>
