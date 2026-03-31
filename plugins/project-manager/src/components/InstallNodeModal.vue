<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useNodeStore } from '../stores/node';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';

const { t } = useI18n();
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const nodeStore = useNodeStore();
const versions = ref<any[]>([]);
const loading = ref(false);
const installingVersion = ref<string | null>(null);
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
    const res = await fetch('https://nodejs.org/dist/index.json');
    const data = await res.json();
    versions.value = data;
  } catch (e) {
    console.error(e);
    ElMessage.error('Failed to fetch node versions');
  } finally {
    loading.value = false;
  }
}

// Fetch when opened
watch(visible, async (val) => {
  if (val) {
    // Refresh installed nodes status
    await nodeStore.loadNvmNodes();
    
    if (versions.value.length === 0) {
      fetchVersions();
    }
  }
});

const installedVersions = computed(() => {
  const set = new Set<string>();
  nodeStore.versions.forEach(v => {
    if (v.source === 'nvm') {
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
    res = versions.value.filter(v => v.version.toLowerCase().includes(q));
  }
  return res;
});

const paginatedVersions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredVersions.value.slice(start, end);
});

// Reset page when search changes
watch(searchQuery, () => {
  currentPage.value = 1;
});

async function install(version: string) {
  try {
    installingVersion.value = version;
    await nodeStore.installNode(version);
    ElMessage.success(`Node ${version} installed successfully`);
    // Do not close modal automatically, user might want to install more or verify
    // But if we want to follow typical flow, maybe we keep it open.
    // However, the original code closed it: visible.value = false;
    // The user requirement "Update status after closing early" implies they might close it.
    // If I keep it open, they can see the "Installed" tag appear.
    visible.value = false;
  } catch (e: any) {
    ElMessage.error(e.message || 'Installation failed');
  } finally {
    installingVersion.value = null;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('nodes.installNode')" width="600px" destroy-on-close class="rounded-xl" align-center>
    <div class="mb-4">
      <el-input v-model="searchQuery" :placeholder="t('common.search')" clearable>
        <template #prefix>
          <el-icon>
            <div class="i-mdi-magnify" />
          </el-icon>
        </template>
      </el-input>
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
            <el-tag v-if="row.lts" type="success" size="small" effect="light" class="!rounded-md">{{ row.lts }}</el-tag>
            <span v-else class="text-slate-300 dark:text-slate-600">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="date" label="Date">
          <template #default="{ row }">
            <span class="text-slate-500 text-xs">{{ row.date }}</span>
          </template>
        </el-table-column>
        <el-table-column align="right" width="100">
          <template #default="{ row }">
            <el-tag v-if="isInstalled(row.version)" type="info" size="small">Installed</el-tag>
            <el-button v-else type="primary" link @click="install(row.version)" :loading="installingVersion === row.version"
              :disabled="!!installingVersion">
              Install
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div
        class="p-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end">
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next" :total="filteredVersions.length" size="small" background />
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
}
</style>
