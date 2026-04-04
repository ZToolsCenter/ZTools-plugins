<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Project } from '../../types';
import { showPersistentGitError } from './message';

const props = defineProps<{
  project: Project;
}>();

const visible = defineModel<boolean>();
const { t } = useI18n();
const gitStore = useGitStore();

const newBranchName = ref('');
const startPoint = ref('');
const isLoading = ref(false);
const searchQuery = ref('');

const localBranches = computed(() => gitStore.getLocalBranches(props.project.id));
const remoteBranches = computed(() => gitStore.getRemoteBranches(props.project.id));

const filteredLocal = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return localBranches.value;
  return localBranches.value.filter(b => b.name.toLowerCase().includes(q));
});

const filteredRemote = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return remoteBranches.value;
  return remoteBranches.value.filter(b => b.name.toLowerCase().includes(q));
});

watch(visible, (v) => {
  if (v) {
    gitStore.refreshBranches(props.project.id, props.project.path);
    searchQuery.value = '';
    newBranchName.value = '';
    startPoint.value = '';
  }
});

async function switchToBranch(name: string) {
  isLoading.value = true;
  try {
    await gitStore.switchBranch(props.project.id, props.project.path, name);
    ElMessage.success(t('git.switchSuccess', { name }));
    await gitStore.refreshBranches(props.project.id, props.project.path);
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

async function createBranch() {
  if (!newBranchName.value.trim()) return;
  isLoading.value = true;
  try {
    await gitStore.createAndSwitchBranch(
      props.project.id,
      props.project.path,
      newBranchName.value.trim(),
      startPoint.value.trim() || undefined,
    );
    ElMessage.success(t('git.createBranchSuccess', { name: newBranchName.value.trim() }));
    newBranchName.value = '';
    startPoint.value = '';
    await gitStore.refreshBranches(props.project.id, props.project.path);
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

async function deleteBranch(name: string, force = false) {
  if (!force) {
    try {
      await ElMessageBox.confirm(
        t('git.deleteBranchConfirm', { name }),
        t('common.warning'),
        { type: 'warning' },
      );
    } catch {
      return;
    }
  }
  isLoading.value = true;
  try {
    await gitStore.deleteBranch(props.project.id, props.project.path, name, force);
    ElMessage.success(t('git.deleteBranchSuccess', { name }));
  } catch (e) {
    if (!force) {
      try {
        await ElMessageBox.confirm(
          `${t('git.forceDelete')}?`,
          t('common.warning'),
          { type: 'warning' },
        );
        await deleteBranch(name, true);
      } catch {
        /* user cancelled */
      }
    } else {
      showPersistentGitError(t('git.operationFailed', { error: String(e) }));
    }
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('git.branch')"
    width="480px"
    :close-on-click-modal="false"
    align-center
    class="branch-dialog"
  >
    <!-- Search -->
    <div class="mb-3">
      <el-input
        v-model="searchQuery"
        :placeholder="t('common.search')"
        size="small"
        clearable
      >
        <template #prefix>
          <div class="i-mdi-magnify text-sm text-slate-400" />
        </template>
      </el-input>
    </div>

    <!-- Create branch -->
    <div class="mb-4 p-3 rounded-lg bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/40 dark:border-slate-700/30">
      <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">{{ t('git.newBranch') }}</div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <el-input
          v-model="newBranchName"
          :placeholder="t('git.branchNamePlaceholder')"
          size="small"
          class="min-w-0 flex-1"
          @keydown.enter="createBranch"
        />
        <el-input
          v-model="startPoint"
          :placeholder="t('git.startPointPlaceholder')"
          size="small"
          class="w-full sm:w-[140px]"
        />
        <el-button
          size="small"
          type="primary"
          :loading="isLoading"
          :disabled="!newBranchName.trim()"
          class="w-full sm:w-auto"
          @click="createBranch"
        >
          {{ t('common.add') }}
        </el-button>
      </div>
    </div>

    <!-- Local branches -->
    <div class="mb-3">
      <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
        {{ t('git.localBranches') }} ({{ filteredLocal.length }})
      </div>
      <div class="max-h-[200px] overflow-auto rounded-md border border-slate-200/40 dark:border-slate-700/30">
        <div
          v-for="branch in filteredLocal"
          :key="branch.name"
          class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 text-[12px] group"
        >
          <div class="i-mdi-source-branch text-sm" :class="branch.is_current ? 'text-blue-500' : 'text-slate-400'" />
          <span class="flex-1 truncate" :class="branch.is_current ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'">
            {{ branch.name }}
          </span>
          <template v-if="branch.upstream">
            <span v-if="branch.ahead > 0" class="text-[9px] text-green-500 font-mono">↑{{ branch.ahead }}</span>
            <span v-if="branch.behind > 0" class="text-[9px] text-orange-500 font-mono">↓{{ branch.behind }}</span>
          </template>
          <div v-if="!branch.is_current" class="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
            <button @click="switchToBranch(branch.name)" class="text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer" :title="t('git.switchBranch')">
              <div class="i-mdi-swap-horizontal text-sm" />
            </button>
            <button @click="deleteBranch(branch.name)" class="text-[10px] text-red-400 hover:text-red-600 cursor-pointer" :title="t('git.deleteBranch')">
              <div class="i-mdi-delete-outline text-sm" />
            </button>
          </div>
          <span v-else class="text-[9px] text-blue-500/60 bg-blue-500/8 px-1.5 py-0.5 rounded-full">current</span>
        </div>
        <div v-if="filteredLocal.length === 0" class="px-3 py-4 text-center text-slate-400 text-[11px]">
          {{ t('git.noCommits') }}
        </div>
      </div>
    </div>

    <!-- Remote branches -->
    <div v-if="filteredRemote.length > 0">
      <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
        {{ t('git.remoteBranches') }} ({{ filteredRemote.length }})
      </div>
      <div class="max-h-[200px] overflow-auto rounded-md border border-slate-200/40 dark:border-slate-700/30">
        <div
          v-for="branch in filteredRemote"
          :key="branch.name"
          class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 text-[12px] group"
        >
          <div class="i-mdi-cloud-outline text-sm text-slate-400" />
          <span class="flex-1 truncate text-slate-600 dark:text-slate-400">{{ branch.name }}</span>
          <button
            @click="switchToBranch(branch.name)"
            class="opacity-0 group-hover:opacity-100 text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer transition-opacity"
            :title="t('git.switchBranch')"
          >
            <div class="i-mdi-download text-sm" />
          </button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
:deep(.branch-dialog .el-dialog) {
  width: min(480px, calc(100vw - 32px));
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.branch-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
}
</style>
