<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { useProjectStore } from '../stores/project';
import type { Project } from '../types';
import {
  scanFrontendEnvProject,
  switchFrontendEnvCandidate,
  type FrontendEnvCandidate,
  type FrontendEnvGroup,
} from '../utils/frontendEnvSwitcher';

/***********************组件输入与状态*********************/

const props = defineProps<{
  project: Project;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();

const scanning = shallowRef(false);
const switchingId = shallowRef('');

/***********************扫描结果派生*********************/

const frontendEnvGroups = computed(() => props.project.frontendEnvGroups || []);
const envGroups = computed(() => frontendEnvGroups.value.filter(group => group.type === 'env'));
const proxyGroups = computed(() => frontendEnvGroups.value.filter(group => group.type === 'proxy'));
const totalGroupCount = computed(() => envGroups.value.length + proxyGroups.value.length);
const scanned = computed(() => !!props.project.frontendEnvScannedAt);

function getActiveCandidate(group: FrontendEnvGroup): FrontendEnvCandidate | undefined {
  return group.candidates.find(candidate => candidate.active);
}

/***********************扫描文件*********************/

async function scanCurrentProjectEnv() {
  if (typeof projectStore.scanFrontendEnvForProject === 'function') {
    return projectStore.scanFrontendEnvForProject(props.project.id);
  }

  const groups = await scanFrontendEnvProject(props.project.path, api);
  projectStore.updateProject({
    ...props.project,
    frontendEnvGroups: groups,
    frontendEnvScannedAt: Date.now(),
  });
  return groups;
}

async function scanFrontendEnvData(options: { silent?: boolean } = {}) {
  scanning.value = true;
  try {
    const groups = await scanCurrentProjectEnv();

    if (options.silent) {
      return;
    }

    if (groups.length === 0) {
      ElMessage.info(t('dashboard.envScanEmpty'));
    } else {
      ElMessage.success(t('dashboard.envScanDone', { count: groups.length }));
    }
  } catch (error) {
    console.error('Failed to scan frontend env:', error);
    ElMessage.error(t('dashboard.envScanFailed'));
  } finally {
    scanning.value = false;
  }
}

/***********************切换候选值*********************/

async function switchCandidate(group: FrontendEnvGroup, candidate: FrontendEnvCandidate) {
  switchingId.value = candidate.id;
  try {
    const content = await api.readTextFile(group.filePath);
    const nextContent = switchFrontendEnvCandidate(content, {
      type: group.type,
      key: group.key,
      value: candidate.value,
    });

    if (nextContent !== content) {
      await api.writeTextFile(group.filePath, nextContent);
    }

    ElMessage.success(t('dashboard.envSwitchSuccess'));
    await scanFrontendEnvData({ silent: true });
  } catch (error) {
    console.error('Failed to switch frontend env:', error);
    ElMessage.error(t('dashboard.envSwitchFailed'));
  } finally {
    switchingId.value = '';
  }
}

/***********************项目切换重置*********************/

watch(
  () => props.project.id,
  () => {
    switchingId.value = '';
  },
);
</script>

<template>
  <div class="frontend-env-panel flex h-full flex-col font-sans">
    <div class="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-4 py-2 dark:border-slate-700/50">
      <span class="app-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {{ t('dashboard.envSwitcher') }}
      </span>
      <el-button
        type="primary"
        text
        size="small"
        :loading="scanning"
        @click="scanFrontendEnvData"
      >
        <el-icon class="mr-0.5"><div class="i-mdi-radar text-xs" /></el-icon>
        {{ scanning ? t('dashboard.envScanning') : t('dashboard.envScan') }}
      </el-button>
    </div>

    <div class="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
      <div v-if="scanned && totalGroupCount === 0" class="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
        <div class="i-mdi-tune-variant text-4xl opacity-20" />
        <p class="app-text-body mt-2 font-medium">{{ t('dashboard.envNoItems') }}</p>
      </div>

      <section v-if="envGroups.length > 0" class="space-y-2">
        <div class="app-text-meta flex items-center gap-2 font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <div class="i-mdi-variable text-sm" />
          {{ t('dashboard.envVars') }}
        </div>

        <div
          v-for="group in envGroups"
          :key="group.id"
          class="rounded-lg border border-slate-200/70 bg-white/70 p-3 dark:border-slate-700/50 dark:bg-slate-900/30"
        >
          <div class="mb-2 flex min-w-0 items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="app-text-control truncate font-mono font-semibold text-slate-700 dark:text-slate-200">{{ group.key }}</div>
              <div class="app-text-meta truncate text-slate-400 dark:text-slate-500">{{ group.fileName }}</div>
            </div>
            <span class="app-text-caption max-w-[45%] shrink-0 truncate rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
              {{ t('dashboard.envCurrent') }}: {{ getActiveCandidate(group)?.value || '-' }}
            </span>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="candidate in group.candidates"
              :key="candidate.id"
              type="button"
              class="app-text-control max-w-full truncate rounded-md border px-2 py-1 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="candidate.active
                ? 'border-blue-400 bg-blue-500/10 text-blue-600 dark:border-blue-500/60 dark:text-blue-300'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-blue-500/60 dark:hover:text-blue-300'"
              :disabled="scanning || switchingId === candidate.id || candidate.active"
              @click="switchCandidate(group, candidate)"
            >
              {{ candidate.value }}
            </button>
          </div>
        </div>
      </section>

      <section v-if="proxyGroups.length > 0" class="space-y-2">
        <div class="app-text-meta flex items-center gap-2 font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <div class="i-mdi-lan-connect text-sm" />
          {{ t('dashboard.envProxies') }}
        </div>

        <div
          v-for="group in proxyGroups"
          :key="group.id"
          class="rounded-lg border border-slate-200/70 bg-white/70 p-3 dark:border-slate-700/50 dark:bg-slate-900/30"
        >
          <div class="mb-2 flex min-w-0 items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="app-text-control truncate font-mono font-semibold text-slate-700 dark:text-slate-200">{{ group.key }}</div>
              <div class="app-text-meta truncate text-slate-400 dark:text-slate-500">{{ group.fileName }}</div>
            </div>
            <span class="app-text-caption max-w-[45%] shrink-0 truncate rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
              {{ t('dashboard.envCurrent') }}: {{ getActiveCandidate(group)?.value || '-' }}
            </span>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="candidate in group.candidates"
              :key="candidate.id"
              type="button"
              class="app-text-control max-w-full truncate rounded-md border px-2 py-1 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="candidate.active
                ? 'border-blue-400 bg-blue-500/10 text-blue-600 dark:border-blue-500/60 dark:text-blue-300'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-blue-500/60 dark:hover:text-blue-300'"
              :disabled="scanning || switchingId === candidate.id || candidate.active"
              @click="switchCandidate(group, candidate)"
            >
              {{ candidate.value }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-text-muted) 56%, transparent);
  border-radius: 2px;
}

.frontend-env-panel {
  background: var(--app-surface);
  color: var(--app-text);
}
</style>
