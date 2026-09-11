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
  return `${ address || '0.0.0.0' }:${ port }`;
}

function getStateTagType(state: string) {
  if (state === 'LISTEN') return 'success';
  if (state === 'ESTABLISHED') return 'primary';
  if (state === 'TIME_WAIT' || state === 'CLOSE_WAIT') return 'warning';
  return 'info';
}

function getRowKey(row: PortEntry) {
  return `${ row.protocol }-${ row.local_address }-${ row.local_port }-${ row.pid || 0 }-${ row.remote_address || '' }-${ row.remote_port || 0 }`;
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
    ElMessage.error(`${ t('ports.openLocationFailed') }: ${ String(error) }`);
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
    ElMessage.error(`${ t('ports.killFailed') }: ${ String(error) }`);
  }
}

onMounted(() => {
  void loadPorts();
});
</script>

<template>
  <div class="app-page">
    <div class="app-page-header">
      <div class="app-content-container">
      <div class="app-page-header-main">
        <div class="app-page-heading">
          <div class="app-page-kicker">
            {{ t('ports.section') }}
          </div>
          <h2 class="app-page-title">
            {{ t('ports.title') }}
          </h2>
          <p class="app-page-description">
            {{ t('ports.description') }}
          </p>
        </div>

        <button
            class="app-primary-action"
            :disabled="loading"
            @click="loadPorts"
        >
          <div class="i-mdi-refresh text-base" :class="{ 'animate-spin': loading }"/>
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>

      <div class="app-page-header-extra grid gap-3 md:grid-cols-4">
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

      <div class="mt-3 flex flex-wrap gap-3">
        <el-input
            v-model="searchQuery"
            :placeholder="t('ports.searchPlaceholder')"
            clearable
            class="max-w-sm"
        >
          <template #prefix>
            <el-icon>
              <div class="i-mdi-magnify"/>
            </el-icon>
          </template>
        </el-input>

        <el-select v-model="protocolFilter" class="w-36">
          <el-option :label="t('ports.protocolAll')" value="all"/>
          <el-option label="TCP" value="TCP"/>
          <el-option label="UDP" value="UDP"/>
        </el-select>

        <el-select v-model="stateFilter" class="w-40">
          <el-option :label="t('ports.stateAll')" value="all"/>
          <el-option :label="t('ports.stateListen')" value="LISTEN"/>
          <el-option :label="t('ports.stateEstablished')" value="ESTABLISHED"/>
          <el-option :label="t('ports.stateOther')" value="OTHER"/>
        </el-select>
      </div>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden px-5 py-4">
      <div class="app-content-container h-full">
      <div
          v-if="unsupportedMessage"
          class="app-alert-warning h-full p-6 text-sm"
      >
        <div class="flex items-start gap-3">
          <div class="i-mdi-alert-circle-outline mt-0.5 text-xl"/>
          <div>
            <div class="font-medium">{{ t('ports.unsupportedTitle') }}</div>
            <div class="mt-2 leading-6">{{ unsupportedMessage }}</div>
          </div>
        </div>
      </div>

      <div v-else class="app-table-panel h-full">
        <el-table
            v-loading="loading"
            :data="filteredPorts"
            height="100%"
            stripe
            class="port-table"
            :empty-text="t('ports.empty')"
            :row-key="getRowKey"
        >
          <el-table-column prop="protocol" :label="t('ports.protocol')" width="90" align="center"/>
          <el-table-column :label="t('ports.localEndpoint')" align="center">
            <template #default="{ row }">
              <span class="app-text-control font-mono">{{ formatEndpoint(row.local_address, row.local_port) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('ports.remoteEndpoint')" align="center">
            <template #default="{ row }">
              <span class="app-text-control font-mono">{{ formatEndpoint(row.remote_address, row.remote_port) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="state" :label="t('ports.state')" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" :type="getStateTagType(row.state)">
                {{ row.state }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="pid" label="PID" width="90" align="center"/>
          <el-table-column prop="process_name" :label="t('ports.process')" align="center" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.process_name || t('ports.unknownProcess') }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('ports.actions')" fixed="right" header-align="center" align="center">
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
              <div class="detail-value-block app-text-code font-mono">{{ selectedPort.executable_path || '-' }}</div>
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
            <div class="detail-value-block app-text-code font-mono leading-6">
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
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-sm);
  padding: 14px 16px;
}

.summary-label {
  font-size: var(--app-font-meta);
  color: var(--app-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.summary-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 700;
  color: var(--app-text);
}

.port-table :deep(.el-table__cell) {
  background: transparent !important;
}

.port-table :deep(.el-table__fixed-right::before) {
  width: 0;
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

/* Light mode fixed column styles */
.port-table :deep(.el-table__fixed-right),
.port-table :deep(.el-table__fixed-right-patch) {
  background: var(--app-surface) !important;
}

.port-table :deep(.el-table__fixed-right .el-table__cell),
.port-table :deep(.el-table-fixed-column--right),
.port-table :deep(.el-table-fixed-column--right .el-table__cell) {
  background: var(--app-surface) !important;
}

.port-table :deep(.el-table__fixed-right) {
  box-shadow: -16px 0 20px -18px color-mix(in srgb, var(--app-text) 24%, transparent);
}
</style>
