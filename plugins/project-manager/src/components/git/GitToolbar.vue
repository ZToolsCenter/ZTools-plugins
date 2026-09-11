<script setup lang="ts">
import { computed } from 'vue';
import { useGitStore } from '../../stores/git.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import type { Project } from '../../types.ts';
import { showPersistentGitError } from './message.ts';

/***********************组件输入与依赖*********************/

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'open-branch-dialog'): void;
  (e: 'open-settings-dialog'): void;
  (e: 'open-repo-center'): void;
  (e: 'refresh'): void;
}>();

const { t } = useI18n();
const gitStore = useGitStore();
const settingsStore = useSettingsStore();

/***********************状态派生*********************/

const summary = computed(() => gitStore.getSummary(props.project.id));
const status = computed(() => gitStore.getStatus(props.project.id));
const isLoading = computed(() =>
  gitStore.operationLoading && gitStore.activeOperationProjectId === props.project.id
);
const isCancellable = computed(() => isLoading.value && gitStore.operationCancellable);
const isCancelling = computed(() => isLoading.value && gitStore.operationCancelling);

const dirtyCount = computed(() => {
  const s = status.value;
  if (!s) return summary.value
    ? (summary.value.staged_count || 0) + (summary.value.unstaged_count || 0) + (summary.value.untracked_count || 0)
    : 0;
  return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length;
});

const hasConflicts = computed(() =>
  Boolean(summary.value?.has_conflicts) || (status.value?.conflicted?.length || 0) > 0
);

const operationState = computed(() => summary.value?.operation_state || null);

/** 干净工作区 + 仅 ahead → 突出 Push */
const canSmartPush = computed(() =>
  dirtyCount.value === 0 && !hasConflicts.value && (summary.value?.ahead || 0) > 0 && (summary.value?.behind || 0) === 0
);
/** 干净 + 仅 behind → 突出 Pull */
const canSmartPull = computed(() =>
  dirtyCount.value === 0 && !hasConflicts.value && (summary.value?.behind || 0) > 0 && (summary.value?.ahead || 0) === 0
);
/** 双向分歧 */
const isDiverged = computed(() =>
  (summary.value?.ahead || 0) > 0 && (summary.value?.behind || 0) > 0
);

const activeOperationLabel = computed(() => {
  if (!isLoading.value) return '';
  const kind = gitStore.activeOperationKind;
  if (!kind) return '';

  const labelMap: Record<string, string> = {
    stage: t('git.staged'),
    unstage: t('git.unstage'),
    stageAll: t('git.stageAll'),
    unstageAll: t('git.unstageAll'),
    commit: t('git.commit'),
    amend: t('git.amend'),
    pull: t('git.pull'),
    push: t('git.push'),
    fetch: t('git.fetch'),
    switchBranch: t('git.switchBranch'),
    createBranch: t('git.createBranch'),
    deleteBranch: t('git.deleteBranch'),
    renameBranch: t('git.renameBranch'),
    merge: t('git.merge'),
    rebase: t('git.rebase'),
    reset: t('git.reset'),
    cherryPick: t('git.cherryPick'),
    revertCommit: t('git.revertCommit'),
    stash: t('git.stash'),
    tag: t('git.tag'),
    revertHunk: t('git.discard'),
    discard: t('git.discard'),
    discardUntracked: t('git.discard'),
  };

  return labelMap[kind] || t('git.loading');
});

const operationBannerText = computed(() => {
  const state = operationState.value;
  if (!state) return '';
  if (state === 'merge') return t('git.operationStateMerge');
  if (state === 'rebase') return t('git.operationStateRebase');
  if (state === 'cherry-pick') return t('git.operationStateCherryPick');
  if (state === 'revert') return t('git.operationStateRevert');
  return '';
});

/***********************操作*********************/

function showError(error: unknown) {
  showPersistentGitError(t('git.operationFailed', { error: String(error) }));
}

function isCancelledError(error: unknown): boolean {
  return String(error).toLowerCase().includes('cancelled');
}

async function handleFetch() {
  try {
    await gitStore.fetch(props.project.id, props.project.path);
    ElMessage.success(t('git.fetchSuccess'));
  } catch (e) {
    if (isCancelledError(e)) {
      ElMessage.info(t('git.operationCancelled'));
      return;
    }
    showError(e);
  }
}

async function handlePull() {
  try {
    const strategy = settingsStore.settings.gitPullStrategy || 'default';
    await gitStore.pull(props.project.id, props.project.path, undefined, undefined, strategy);
    ElMessage.success(t('git.pullSuccess'));
  } catch (e) {
    if (isCancelledError(e)) {
      ElMessage.info(t('git.operationCancelled'));
      return;
    }
    showError(e);
  }
}

async function handlePush() {
  try {
    const s = summary.value;
    if (s && !s.has_remote) {
      await gitStore.push(props.project.id, props.project.path, 'origin', s.branch, false, true);
    } else {
      await gitStore.push(props.project.id, props.project.path);
    }
    ElMessage.success(t('git.pushSuccess'));
  } catch (e) {
    if (isCancelledError(e)) {
      ElMessage.info(t('git.operationCancelled'));
      return;
    }
    showError(e);
  }
}

async function handleMergeContinue() {
  try {
    await gitStore.mergeContinue(props.project.id, props.project.path);
    ElMessage.success(t('git.mergeContinueSuccess'));
  } catch (e) {
    showError(e);
  }
}

async function handleMergeAbort() {
  try {
    await gitStore.mergeAbort(props.project.id, props.project.path);
    ElMessage.success(t('git.mergeAbortSuccess'));
  } catch (e) {
    showError(e);
  }
}

async function handleCancel() {
  try {
    await gitStore.cancelActiveOperation();
    ElMessage.info(t('git.operationCancelling'));
  } catch (e) {
    showError(e);
  }
}
</script>

<template>
  <div class="git-toolbar">
    <!-- Branch chip -->
    <button class="branch-chip" @click="emit('open-branch-dialog')" :title="t('git.switchBranch')">
      <div class="i-mdi-source-branch text-xs text-blue-500" />
      <span class="app-text-control font-medium text-slate-700 dark:text-slate-300 max-w-[140px] truncate">
        {{ summary?.branch || 'HEAD' }}
      </span>
      <template v-if="summary">
        <span v-if="summary.is_detached" class="app-text-caption px-1 py-0.5 rounded-sm bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
          detached
        </span>
        <span v-if="summary.ahead > 0" class="app-text-caption px-1 py-0.5 rounded-sm bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
          ↑{{ summary.ahead }}
        </span>
        <span v-if="summary.behind > 0" class="app-text-caption px-1 py-0.5 rounded-sm bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
          ↓{{ summary.behind }}
        </span>
        <span
          v-if="hasConflicts"
          class="app-text-caption px-1 py-0.5 rounded-sm bg-red-500/10 text-red-600 dark:text-red-400 font-medium"
        >
          {{ t('git.conflictBadge', { count: summary.conflicted_count || status?.conflicted.length || 0 }) }}
        </span>
      </template>
    </button>

    <div class="flex-1" />

    <!-- 智能主操作：干净工作区时突出 Push/Pull -->
    <button
      v-if="canSmartPush"
      @click="handlePush"
      :disabled="isLoading"
      class="toolbar-smart toolbar-smart-push"
      :title="t('git.pushN', { count: summary?.ahead || 0 })"
    >
      <div class="i-mdi-arrow-up-bold text-xs" />
      {{ t('git.pushN', { count: summary?.ahead || 0 }) }}
    </button>
    <button
      v-else-if="canSmartPull"
      @click="handlePull"
      :disabled="isLoading"
      class="toolbar-smart toolbar-smart-pull"
      :title="t('git.pullN', { count: summary?.behind || 0 })"
    >
      <div class="i-mdi-arrow-down-bold text-xs" />
      {{ t('git.pullN', { count: summary?.behind || 0 }) }}
    </button>
    <span
      v-else-if="isDiverged"
      class="toolbar-diverged"
      :title="t('git.divergedHint')"
    >
      {{ t('git.diverged') }}
    </span>

    <!-- Action buttons -->
    <button @click="handleFetch" :disabled="isLoading" class="toolbar-action" :title="t('git.fetch')">
      <div class="i-mdi-cloud-download-outline action-icon" />
    </button>
    <button
      v-if="!canSmartPull"
      @click="handlePull"
      :disabled="isLoading"
      class="toolbar-action"
      :title="t('git.pull')"
    >
      <div class="i-mdi-arrow-down-bold action-icon" />
      <span v-if="summary && summary.behind > 0" class="action-badge bg-orange-500">{{ summary.behind }}</span>
    </button>
    <button
      v-if="!canSmartPush"
      @click="handlePush"
      :disabled="isLoading"
      class="toolbar-action"
      :title="t('git.push')"
    >
      <div class="i-mdi-arrow-up-bold action-icon" />
      <span v-if="summary && summary.ahead > 0" class="action-badge bg-blue-500">{{ summary.ahead }}</span>
    </button>
    <button @click="emit('refresh')" :disabled="isLoading" class="toolbar-action" :title="t('git.refresh')">
      <div class="i-mdi-refresh action-icon" :class="{ 'animate-spin': isLoading }" />
    </button>
    <button
      v-if="isLoading && isCancellable"
      @click="handleCancel"
      :disabled="isCancelling"
      class="toolbar-action toolbar-cancel"
      :title="t('git.cancelOperation')"
    >
      <div :class="isCancelling ? 'i-mdi-loading animate-spin' : 'i-mdi-close-circle-outline'" class="action-icon" />
    </button>
    <button @click="emit('open-repo-center')" class="toolbar-action" :title="t('git.repoCenter')">
      <div class="i-mdi-source-repository action-icon" />
    </button>
    <button @click="emit('open-settings-dialog')" class="toolbar-action" :title="t('git.repoSettings')">
      <div class="i-mdi-cog-outline action-icon" />
    </button>
  </div>

  <!-- 进行中操作 banner（merge/rebase…） -->
  <div v-if="operationBannerText && !isLoading" class="git-op-banner">
    <span class="op-text">
      <div class="i-mdi-alert-outline text-xs" />
      {{ operationBannerText }}
    </span>
    <div class="op-actions">
      <button
        v-if="operationState === 'merge'"
        type="button"
        class="op-btn primary"
        :disabled="isLoading || hasConflicts"
        :title="hasConflicts ? t('git.resolveConflictsFirst') : t('git.mergeContinue')"
        @click="handleMergeContinue"
      >
        {{ t('git.mergeContinue') }}
      </button>
      <button
        v-if="operationState === 'merge'"
        type="button"
        class="op-btn danger"
        :disabled="isLoading"
        @click="handleMergeAbort"
      >
        {{ t('git.mergeAbort') }}
      </button>
    </div>
  </div>

  <div v-if="isLoading" class="git-toolbar-status">
    <span class="status-pill">
      <div class="i-mdi-loading animate-spin text-xs" />
      {{ t('git.operationInProgress', { action: activeOperationLabel }) }}
    </span>
    <button
      v-if="isCancellable"
      @click="handleCancel"
      :disabled="isCancelling"
      class="status-cancel"
    >
      {{ isCancelling ? t('git.operationCancelling') : t('common.cancel') }}
    </button>
  </div>
</template>

<style scoped>
.git-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.git-toolbar-status,
.git-op-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 8px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.git-op-banner {
  background: color-mix(in srgb, var(--app-warning, #f59e0b) 10%, var(--app-surface-raised));
}
.op-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--app-font-control);
  color: var(--app-text-secondary);
}
.op-actions {
  display: flex;
  gap: 6px;
}
.op-btn {
  border: 1px solid var(--app-border);
  background: var(--app-surface-soft);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: var(--app-font-control);
  cursor: pointer;
  color: var(--app-text-secondary);
}
.op-btn.primary {
  border-color: color-mix(in srgb, var(--app-primary) 34%, transparent);
  color: var(--app-primary);
  background: var(--app-primary-soft);
}
.op-btn.danger {
  border-color: color-mix(in srgb, var(--app-danger) 34%, transparent);
  color: var(--app-danger);
}
.op-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: var(--app-font-control);
  color: var(--app-text-secondary);
  background: var(--app-primary-soft);
}
.status-cancel {
  border: none;
  background: transparent;
  color: var(--app-danger);
  font-size: var(--app-font-control);
  font-weight: 600;
  cursor: pointer;
}
.status-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.branch-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-soft);
  color: var(--app-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    border-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease),
    box-shadow var(--app-duration-fast) var(--app-ease);
}
.branch-chip:hover {
  border-color: color-mix(in srgb, var(--app-primary) 30%, transparent);
  background: var(--app-primary-soft);
  color: var(--app-primary);
  box-shadow: var(--app-shadow-sm);
}
.toolbar-smart {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 8px;
  border: none;
  font-size: var(--app-font-control);
  font-weight: 600;
  cursor: pointer;
  color: white;
}
.toolbar-smart:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.toolbar-smart-push {
  background: var(--app-primary);
}
.toolbar-smart-pull {
  background: var(--app-warning, #f59e0b);
}
.toolbar-diverged {
  font-size: var(--app-font-caption);
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--app-danger) 10%, transparent);
  color: var(--app-danger);
}
.toolbar-action {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    border-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease);
  border: 1px solid var(--app-border);
  background: var(--app-surface-soft);
}
.toolbar-action:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--app-primary) 30%, transparent);
  background: var(--app-primary-soft);
}
.toolbar-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.action-icon {
  font-size: 14px;
  color: var(--app-text-secondary);
  transition: color var(--app-duration-fast) var(--app-ease);
}
.toolbar-action:hover:not(:disabled) .action-icon {
  color: var(--app-primary);
}
.action-badge {
  position: absolute;
  top: 0;
  right: 0;
  font-size: var(--app-font-caption);
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-weight: 600;
}
.toolbar-cancel {
  border-color: color-mix(in srgb, var(--app-danger) 34%, transparent);
  background: color-mix(in srgb, var(--app-danger) 8%, transparent);
}
.toolbar-cancel .action-icon,
.toolbar-cancel:hover:not(:disabled) .action-icon {
  color: var(--app-danger);
}
</style>
