<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useNodeStore } from '../stores/node';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { NodeInstallProgress, NodeReleaseInfo } from '../types';

const { t } = useI18n();
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const nodeStore = useNodeStore();
const versions = ref<NodeReleaseInfo[]>([]);
const loading = ref(false);
const fetchError = ref('');
const installingVersion = ref<string | null>(null);
const operationId = ref<string | null>(null);
const installError = ref<{ version: string; detail: string } | null>(null);
const searchQuery = ref('');
const currentPage = ref(1);
const pageSize = ref(20);

const updatePageSize = () => {
  if (window.innerWidth < 1024) {
    pageSize.value = 10;
  } else {
    pageSize.value = 20;
  }
};

onMounted(async () => {
  updatePageSize();
  window.addEventListener('resize', updatePageSize);
  if (visible.value) {
    await fetchVersions();
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', updatePageSize);
});

async function fetchVersions() {
  try {
    loading.value = true;
    fetchError.value = '';
    versions.value = await api.listAvailableNodeReleases();
  } catch (e) {
    console.error(e);
    fetchError.value = String(e);
    ElMessage.error(t('nodes.releaseFetchFailed'));
  } finally {
    loading.value = false;
  }
}

watch(visible, async (val) => {
  if (val) {
    await nodeStore.refreshManagedRuntimes();
    if (versions.value.length === 0) {
      fetchVersions();
    }
  }
});

const installedVersions = computed(() => {
  const set = new Set<string>();
  nodeStore.versions.forEach(v => {
    if (v.source === 'managed') {
      const ver = v.version.toLowerCase().startsWith('v') ? v.version : 'v' + v.version;
      set.add(ver.toLowerCase());
    }
  });
  return set;
});

function isInstalled(version: string) {
  return installedVersions.value.has(version.toLowerCase());
}

const filteredVersions = computed(() => {
  let res = versions.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    res = versions.value.filter(v => {
      const lts = typeof v.lts === 'string' ? v.lts : (v.lts ? 'lts' : '');
      return v.version.toLowerCase().includes(q) || String(lts).toLowerCase().includes(q) || (v.date || '').includes(q);
    });
  }
  return res;
});

const paginatedVersions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredVersions.value.slice(start, end);
});

watch(searchQuery, () => {
  currentPage.value = 1;
});

function progressFor(version: string): NodeInstallProgress | undefined {
  return nodeStore.installProgress[version] || nodeStore.installProgress[`v${version.replace(/^v/i, '')}`];
}

function progressLabel(version: string) {
  const progress = progressFor(version);
  if (!progress) return '';
  if (progress.phase === 'downloading' && typeof progress.percent === 'number') {
    return `${t('nodes.phaseDownloading')} ${progress.percent}%`;
  }
  const map: Record<string, string> = {
    preparing: t('nodes.phasePreparing'),
    resolving: t('nodes.phaseResolving'),
    verifying: t('nodes.phaseVerifying'),
    extracting: t('nodes.phaseExtracting'),
    finalizing: t('nodes.phaseFinalizing'),
    validating: t('nodes.phaseValidating'),
    cleanup: t('nodes.phaseCleanup'),
    complete: t('nodes.phaseComplete'),
  };
  return map[progress.phase] || progress.phase;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

async function install(version: string) {
  try {
    installError.value = null;
    installingVersion.value = version;
    operationId.value = `install-${version}-${Date.now()}`;
    await nodeStore.installManagedNode(version, operationId.value);
    ElMessage.success(`Node ${version} installed successfully`);
  } catch (e: any) {
    const detail = errorDetail(e);
    installError.value = { version, detail };
    ElMessage.error(`${t('nodes.installFailed')}: ${detail}`);
  } finally {
    installingVersion.value = null;
    operationId.value = null;
  }
}

async function cancelInstall() {
  if (!operationId.value) return;
  try {
    await nodeStore.cancelManagedNodeInstall(operationId.value);
    ElMessage.info(t('nodes.installCancelled'));
  } catch (e: any) {
    ElMessage.error(e.message || t('common.error'));
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('nodes.installNode')" width="600px" destroy-on-close class="rounded-xl install-node-dialog" align-center>
    <div class="mb-4">
      <el-input v-model="searchQuery" :placeholder="t('common.search')" clearable>
        <template #prefix>
          <el-icon>
            <div class="i-mdi-magnify" />
          </el-icon>
        </template>
      </el-input>
    </div>

    <div v-if="fetchError" class="app-text-control mb-3 flex items-center justify-between text-rose-500">
      <span>{{ t('nodes.releaseFetchFailed') }}</span>
      <el-button link type="primary" @click="fetchVersions">{{ t('common.refresh') }}</el-button>
    </div>

    <div
      class="flex flex-col border border-slate-200 dark:border-slate-700 rounded-md relative"
      v-loading="loading">
      <el-table :data="paginatedVersions" style="width: 100%" size="small" class="flex-1" max-height="450"
        :row-style="{ background: 'transparent' }">
        <el-table-column prop="version" label="Version" width="140">
          <template #default="{ row }">
            <span class="font-mono font-bold text-slate-700 dark:text-slate-300">{{ row.version }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="lts" label="LTS" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.lts" type="success" size="small" effect="light" class="!rounded-md">{{ row.lts === true ? 'LTS' : row.lts }}</el-tag>
            <span v-else class="text-slate-300 dark:text-slate-600">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="date" label="Date">
          <template #default="{ row }">
            <span class="app-text-meta text-slate-500">{{ row.date }}</span>
          </template>
        </el-table-column>
        <el-table-column align="right" width="140">
          <template #default="{ row }">
            <el-tag v-if="isInstalled(row.version)" type="info" size="small">Installed</el-tag>
            <div v-else class="flex flex-col items-end gap-1">
              <el-button type="primary" link @click="install(row.version)" :loading="installingVersion === row.version"
                :disabled="!!installingVersion">
                Install
              </el-button>
              <span v-if="progressLabel(row.version)" class="app-text-meta text-blue-500">{{ progressLabel(row.version) }}</span>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="installError" class="app-text-control mx-2 mb-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
        <div class="flex items-center justify-between gap-2">
          <strong>{{ t('nodes.installFailed') }}: {{ installError.version }}</strong>
          <el-button link type="danger" size="small" @click="install(installError!.version)">{{ t('nodes.retryInstall') }}</el-button>
        </div>
        <pre class="app-text-code mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono">{{ installError.detail }}</pre>
      </div>

      <div
        class="p-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-between">
        <el-button v-if="installingVersion" size="small" @click="cancelInstall">{{ t('nodes.cancelInstall') }}</el-button>
        <span v-else></span>
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next" :total="filteredVersions.length" size="small" background />
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
:deep(.install-node-dialog .el-dialog) {
  width: min(600px, calc(100vw - 32px));
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.install-node-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
}

:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
}
</style>
