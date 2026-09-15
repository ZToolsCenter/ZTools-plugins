<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { GitBranch, Project } from '../../types';
import {
  createBranchGroups,
  getRemoteCheckoutName,
  isBranchActionDisabled,
} from './gitBranchModel';
import { showPersistentGitError } from './message';

const props = defineProps<{
  project: Project;
}>();

const visible = defineModel<boolean>();
const { t } = useI18n();
const gitStore = useGitStore();

/***********************分支表单状态*********************/

const newBranchName = ref('');
const startPoint = ref('');
const isLoading = ref(false);
const searchQuery = ref('');

/***********************分支列表派生*********************/

const branchGroups = computed(() => createBranchGroups(gitStore.getBranches(props.project.id), searchQuery.value));
const currentBranch = computed(() => branchGroups.value.current);
const filteredLocal = computed(() => branchGroups.value.locals);
const filteredRemote = computed(() => branchGroups.value.remotes);

/***********************弹窗打开刷新*********************/

watch(visible, (v) => {
  if (v) {
    void refreshBranches();
    searchQuery.value = '';
    newBranchName.value = '';
    startPoint.value = '';
  }
});

/***********************分支数据刷新*********************/

async function refreshBranches() {
  isLoading.value = true;
  try {
    await gitStore.refreshRepositoryState(props.project.id, props.project.path, { includeBranches: true });
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

/***********************分支切换与检出*********************/

async function switchToBranch(name: string) {
  isLoading.value = true;
  try {
    await gitStore.switchBranch(props.project.id, props.project.path, name);
    ElMessage.success(t('git.switchSuccess', { name }));
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

async function checkoutRemoteBranch(branch: GitBranch) {
  const localName = getRemoteCheckoutName(branch.name);
  isLoading.value = true;
  try {
    await gitStore.switchBranch(props.project.id, props.project.path, branch.name);
    ElMessage.success(t('git.checkoutRemoteSuccess', { remote: branch.name, local: localName }));
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

/***********************分支创建与维护*********************/

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
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

async function renameBranch(branch: GitBranch) {
  if (isBranchActionDisabled(branch, 'rename')) return;

  let newName = '';
  try {
    const result = await ElMessageBox.prompt(
      t('git.renameBranchPrompt', { name: branch.name }),
      t('git.renameBranch'),
      {
        inputValue: branch.name,
        inputPattern: /\S+/,
        inputErrorMessage: t('git.branchNameInvalid'),
      },
    ) as unknown as { value?: unknown };
    newName = String(result.value || '').trim();
  } catch {
    return;
  }

  if (!newName || newName === branch.name) return;

  isLoading.value = true;
  try {
    await gitStore.renameBranch(props.project.id, props.project.path, branch.name, newName);
    ElMessage.success(t('git.renameBranchSuccess', { old: branch.name, name: newName }));
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
    append-to-body
    align-center
    class="branch-dialog"
  >
    <div class="branch-dialog-toolbar">
      <el-input
        v-model="searchQuery"
        :placeholder="t('common.search')"
        size="small"
        clearable
        class="min-w-0 flex-1"
      >
        <template #prefix>
          <div class="i-mdi-magnify text-sm text-slate-400" />
        </template>
      </el-input>
      <el-button size="small" :loading="isLoading" @click="refreshBranches">
        <div class="i-mdi-refresh text-sm" />
        {{ t('git.refresh') }}
      </el-button>
    </div>

    <div v-if="currentBranch" class="current-branch-panel">
      <div class="flex items-center gap-2 min-w-0">
        <div class="i-mdi-source-branch text-sm text-blue-500" />
        <div class="min-w-0 flex-1">
          <div class="app-text-control truncate font-medium text-blue-600 dark:text-blue-400">{{ currentBranch.name }}</div>
          <div v-if="currentBranch.upstream" class="app-text-meta truncate text-slate-400 dark:text-slate-500">
            {{ t('git.upstream') }}：{{ currentBranch.upstream }}
          </div>
        </div>
      </div>
      <div class="branch-meta">
        <span v-if="currentBranch.ahead > 0" class="branch-badge branch-badge-ahead">↑{{ currentBranch.ahead }}</span>
        <span v-if="currentBranch.behind > 0" class="branch-badge branch-badge-behind">↓{{ currentBranch.behind }}</span>
        <span v-if="currentBranch.ahead === 0 && currentBranch.behind === 0" class="branch-badge">{{ t('git.currentBranch') }}</span>
      </div>
    </div>

    <div class="mb-4 p-3 rounded-lg bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/40 dark:border-slate-700/30">
      <div class="app-text-control font-medium text-slate-500 dark:text-slate-400 mb-2">{{ t('git.newBranch') }}</div>
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

    <div class="mb-3">
      <div class="app-text-control font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
        {{ t('git.localBranches') }} ({{ filteredLocal.length }})
      </div>
      <div class="max-h-[200px] overflow-auto rounded-md border border-slate-200/40 dark:border-slate-700/30">
        <div
          v-for="branch in filteredLocal"
          :key="branch.name"
          class="app-text-control flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 group"
        >
          <div class="i-mdi-source-branch text-sm" :class="branch.is_current ? 'text-blue-500' : 'text-slate-400'" />
          <span class="flex-1 truncate" :class="branch.is_current ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'">
            {{ branch.name }}
          </span>
          <template v-if="branch.upstream">
            <span v-if="branch.ahead > 0" class="app-text-caption text-green-500 font-mono">↑{{ branch.ahead }}</span>
            <span v-if="branch.behind > 0" class="app-text-caption text-orange-500 font-mono">↓{{ branch.behind }}</span>
          </template>
          <div class="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
            <button
              @click="switchToBranch(branch.name)"
              class="app-text-meta text-blue-500 hover:text-blue-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="isBranchActionDisabled(branch, 'switch') || isLoading"
              :title="t('git.switchBranch')"
            >
              <div class="i-mdi-swap-horizontal text-sm" />
            </button>
            <button
              @click="renameBranch(branch)"
              class="app-text-meta text-slate-400 hover:text-blue-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="isBranchActionDisabled(branch, 'rename') || isLoading"
              :title="t('git.renameBranch')"
            >
              <div class="i-mdi-pencil-outline text-sm" />
            </button>
            <button
              @click="deleteBranch(branch.name)"
              class="app-text-meta text-red-400 hover:text-red-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="isBranchActionDisabled(branch, 'delete') || isLoading"
              :title="t('git.deleteBranch')"
            >
              <div class="i-mdi-delete-outline text-sm" />
            </button>
          </div>
        </div>
        <div v-if="filteredLocal.length === 0" class="px-3 py-4 text-center app-text-meta text-slate-400">
          {{ t('git.noBranches') }}
        </div>
      </div>
    </div>

    <div v-if="filteredRemote.length > 0">
      <div class="app-text-control font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
        {{ t('git.remoteBranches') }} ({{ filteredRemote.length }})
      </div>
      <div class="max-h-[200px] overflow-auto rounded-md border border-slate-200/40 dark:border-slate-700/30">
        <div
          v-for="branch in filteredRemote"
          :key="branch.name"
          class="app-text-control flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 group"
        >
          <div class="i-mdi-cloud-outline text-sm text-slate-400" />
          <span class="flex-1 truncate text-slate-600 dark:text-slate-400">{{ branch.name }}</span>
          <span class="hidden sm:inline app-text-meta text-slate-400 dark:text-slate-500 truncate max-w-[140px]">
            {{ t('git.checkoutRemoteAs', { name: getRemoteCheckoutName(branch.name) }) }}
          </span>
          <button
            @click="checkoutRemoteBranch(branch)"
            class="opacity-0 group-hover:opacity-100 app-text-meta text-blue-500 hover:text-blue-700 cursor-pointer transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="isLoading"
            :title="t('git.checkoutBranch', { name: branch.name })"
          >
            <div class="i-mdi-download text-sm" />
          </button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.branch-dialog-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.current-branch-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: var(--app-radius-md);
  border: 1px solid color-mix(in srgb, var(--app-primary) 24%, transparent);
  background: var(--app-primary-soft);
}

.branch-meta {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.branch-badge {
  padding: 2px 6px;
  border-radius: 999px;
  font-size: var(--app-font-caption);
  color: var(--app-primary);
  background: var(--app-primary-soft);
}

.branch-badge-ahead {
  color: var(--app-success);
  background: color-mix(in srgb, var(--app-success) 12%, transparent);
}

.branch-badge-behind {
  color: var(--app-warning);
  background: color-mix(in srgb, var(--app-warning) 12%, transparent);
}

</style>

<!-- append-to-body 后弹层挂到 body，需非 scoped 才能命中 -->
<style>
.branch-dialog .el-dialog {
  width: min(480px, calc(100vw - 32px));
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.branch-dialog .el-dialog__body {
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
}
</style>
