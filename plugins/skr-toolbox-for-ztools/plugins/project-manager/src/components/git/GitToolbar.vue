<script setup lang="ts">
import { computed } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import type { Project } from '../../types';
import { showPersistentGitError } from './message';

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'open-branch-dialog'): void;
  (e: 'open-settings-dialog'): void;
  (e: 'refresh'): void;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

const summary = computed(() => gitStore.getSummary(props.project.id));
const isLoading = computed(() => gitStore.operationLoading);
const isCancellable = computed(() => gitStore.operationCancellable);
const isCancelling = computed(() => gitStore.operationCancelling);
const activeOperationLabel = computed(() => {
  const kind = gitStore.activeOperationKind;
  if (!kind) return '';

  const labelMap: Record<string, string> = {
    stage: t('git.staged'),
    unstage: t('git.unstage'),
    stageAll: t('git.stageAll'),
    unstageAll: t('git.unstageAll'),
    commit: t('git.commit'),
    pull: t('git.pull'),
    push: t('git.push'),
    fetch: t('git.fetch'),
    switchBranch: t('git.switchBranch'),
    createBranch: t('git.createBranch'),
    deleteBranch: t('git.deleteBranch'),
    renameBranch: t('git.renameBranch'),
    revertHunk: t('git.discard'),
    discard: t('git.discard'),
    discardUntracked: t('git.discard'),
  };

  return labelMap[kind] || t('git.loading');
});

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
    await gitStore.pull(props.project.id, props.project.path);
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
      <span class="text-[11px] font-medium text-slate-700 dark:text-slate-300 max-w-[140px] truncate">
        {{ summary?.branch || 'HEAD' }}
      </span>
      <template v-if="summary">
        <span v-if="summary.is_detached" class="text-[9px] px-1 py-0.5 rounded-sm bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
          detached
        </span>
        <span v-if="summary.ahead > 0" class="text-[9px] px-1 py-0.5 rounded-sm bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
          ↑{{ summary.ahead }}
        </span>
        <span v-if="summary.behind > 0" class="text-[9px] px-1 py-0.5 rounded-sm bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
          ↓{{ summary.behind }}
        </span>
      </template>
    </button>

    <div class="flex-1" />

    <!-- Action buttons -->
    <button @click="handleFetch" :disabled="isLoading" class="toolbar-action" :title="t('git.fetch')">
      <div class="i-mdi-cloud-download-outline action-icon" />
    </button>
    <button @click="handlePull" :disabled="isLoading" class="toolbar-action" :title="t('git.pull')">
      <div class="i-mdi-arrow-down-bold action-icon" />
      <span v-if="summary && summary.behind > 0" class="action-badge bg-orange-500">{{ summary.behind }}</span>
    </button>
    <button @click="handlePush" :disabled="isLoading" class="toolbar-action" :title="t('git.push')">
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
    <button @click="emit('open-settings-dialog')" class="toolbar-action" :title="t('git.repoSettings')">
      <div class="i-mdi-cog-outline action-icon" />
    </button>
  </div>
  <div v-if="isLoading" class="git-toolbar-status">
    <span class="status-pill">
      <div class="i-mdi-loading animate-spin text-[10px]" />
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
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}
.git-toolbar-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10px;
  color: rgb(71, 85, 105);
  background: rgba(59, 130, 246, 0.08);
}
.status-cancel {
  border: none;
  background: transparent;
  color: rgb(239, 68, 68);
  font-size: 10px;
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
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.68), rgba(248,250,252,0.5));
  border: none;
  backdrop-filter: blur(14px) saturate(1.16);
  -webkit-backdrop-filter: blur(14px) saturate(1.16);
  box-shadow:
    0 8px 18px rgba(15,23,42,0.05),
    inset 0 1px 0 rgba(255,255,255,0.42),
    inset 0 0 0 1px rgba(191,219,254,0.5);
  cursor: pointer;
  transition: all 0.22s ease, backdrop-filter 0.22s ease, -webkit-backdrop-filter 0.22s ease;
}
.branch-chip:hover {
  transform: translateY(-1px);
  backdrop-filter: blur(18px) saturate(1.28);
  -webkit-backdrop-filter: blur(18px) saturate(1.28);
  box-shadow:
    0 12px 24px rgba(15,23,42,0.08),
    inset 0 1px 0 rgba(255,255,255,0.46),
    inset 0 0 0 1px rgba(96,165,250,0.4);
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
  transition: all 0.22s ease, backdrop-filter 0.22s ease, -webkit-backdrop-filter 0.22s ease;
  border: none;
  background: linear-gradient(180deg, rgba(255,255,255,0.66), rgba(248,250,252,0.48));
  backdrop-filter: blur(14px) saturate(1.16);
  -webkit-backdrop-filter: blur(14px) saturate(1.16);
  box-shadow:
    0 8px 18px rgba(15,23,42,0.05),
    inset 0 1px 0 rgba(255,255,255,0.42),
    inset 0 0 0 1px rgba(226,232,240,0.5);
}
.toolbar-action:hover:not(:disabled) {
  transform: translateY(-1px);
  backdrop-filter: blur(18px) saturate(1.28);
  -webkit-backdrop-filter: blur(18px) saturate(1.28);
  box-shadow:
    0 12px 24px rgba(15,23,42,0.08),
    inset 0 1px 0 rgba(255,255,255,0.48),
    inset 0 0 0 1px rgba(191,219,254,0.64);
}
.toolbar-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.action-icon {
  font-size: 14px;
  color: rgb(100, 116, 139);
}
:global(.dark) .branch-chip {
  background:
    linear-gradient(180deg, rgba(96,165,250,0.03), rgba(96,165,250,0)),
    linear-gradient(180deg, rgba(15,23,42,0.84), rgba(2,6,23,0.74));
  backdrop-filter: blur(20px) saturate(1.18);
  -webkit-backdrop-filter: blur(20px) saturate(1.18);
  box-shadow:
    0 16px 30px rgba(2,6,23,0.32),
    inset 0 1px 0 rgba(255,255,255,0.06),
    inset 0 0 0 1px rgba(96,165,250,0.18);
}
:global(.dark) .branch-chip:hover {
  backdrop-filter: blur(24px) saturate(1.26);
  -webkit-backdrop-filter: blur(24px) saturate(1.26);
  box-shadow:
    0 18px 34px rgba(2,6,23,0.36),
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 0 0 1px rgba(96,165,250,0.24);
}
:global(.dark) .toolbar-action {
  background:
    linear-gradient(180deg, rgba(45,212,191,0.02), rgba(45,212,191,0)),
    linear-gradient(180deg, rgba(15,23,42,0.82), rgba(2,6,23,0.72));
  backdrop-filter: blur(20px) saturate(1.18);
  -webkit-backdrop-filter: blur(20px) saturate(1.18);
  box-shadow:
    0 16px 28px rgba(2,6,23,0.3),
    inset 0 1px 0 rgba(255,255,255,0.05),
    inset 0 0 0 1px rgba(148,163,184,0.12);
}
:global(.dark) .toolbar-action:hover:not(:disabled) {
  backdrop-filter: blur(24px) saturate(1.26);
  -webkit-backdrop-filter: blur(24px) saturate(1.26);
  box-shadow:
    0 18px 34px rgba(2,6,23,0.36),
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 0 0 1px rgba(96,165,250,0.24);
}
:global(.dark) .action-icon {
  color: rgb(148, 163, 184);
}
.action-badge {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 9px;
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
  box-shadow:
    0 8px 18px rgba(239,68,68,0.12),
    inset 0 1px 0 rgba(255,255,255,0.42),
    inset 0 0 0 1px rgba(252,165,165,0.5);
}
:global(.dark) .git-toolbar-status {
  border-bottom-color: rgba(148, 163, 184, 0.1);
}
:global(.dark) .status-pill {
  color: rgb(203, 213, 225);
  background: rgba(59, 130, 246, 0.14);
}
:global(.dark) .status-cancel {
  color: rgb(248, 113, 113);
}
</style>
