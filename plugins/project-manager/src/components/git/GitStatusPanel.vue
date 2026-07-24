<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';
import type { Project, GitFileStatus } from '../../types';
import { showPersistentGitError } from './message';

const props = defineProps<{
  project: Project;
  stagedRatio: number;
}>();

const emit = defineEmits<{
  'staged-split-mousedown': [e: MouseEvent];
}>();

const { t } = useI18n();
const gitStore = useGitStore();

const statusResult = computed(() => gitStore.getStatus(props.project.id));
const stagedFiles = computed(() => statusResult.value?.staged || []);
const unstagedFiles = computed(() => [
  ...(statusResult.value?.unstaged || []),
  ...(statusResult.value?.untracked || []),
]);
const conflictedFiles = computed(() => statusResult.value?.conflicted || []);

const hasChanges = computed(() =>
  stagedFiles.value.length > 0 || unstagedFiles.value.length > 0 || conflictedFiles.value.length > 0
);

// Multi-select state
const selectedFiles = ref<Set<string>>(new Set());
const lastClickedFile = ref<string | null>(null);
const lastClickedArea = ref<'staged' | 'unstaged' | 'conflicted' | null>(null);

const selectedStagedCount = computed(() =>
  stagedFiles.value.filter(f => selectedFiles.value.has(f.path)).length
);
const selectedUnstagedCount = computed(() =>
  unstagedFiles.value.filter(f => selectedFiles.value.has(f.path)).length
);

// Clear selection when project changes
watch(() => props.project.id, () => {
  selectedFiles.value.clear();
  lastClickedFile.value = null;
  lastClickedArea.value = null;
});

// Clear selection for files that no longer exist in status
watch(statusResult, () => {
  if (selectedFiles.value.size === 0) return;
  const allPaths = new Set([
    ...stagedFiles.value.map(f => f.path),
    ...unstagedFiles.value.map(f => f.path),
    ...conflictedFiles.value.map(f => f.path),
  ]);
  for (const path of selectedFiles.value) {
    if (!allPaths.has(path)) {
      selectedFiles.value.delete(path);
    }
  }
});

function isFileSelected(file: GitFileStatus): boolean {
  return selectedFiles.value.has(file.path);
}

function getFileList(area: 'staged' | 'unstaged' | 'conflicted'): GitFileStatus[] {
  if (area === 'staged') return stagedFiles.value;
  if (area === 'conflicted') return conflictedFiles.value;
  return unstagedFiles.value;
}

function handleFileClick(event: MouseEvent, file: GitFileStatus, area: 'staged' | 'unstaged' | 'conflicted') {
  if (event.ctrlKey || event.metaKey) {
    // Ctrl+click: toggle selection
    if (selectedFiles.value.has(file.path)) {
      selectedFiles.value.delete(file.path);
    } else {
      selectedFiles.value.add(file.path);
    }
    lastClickedFile.value = file.path;
    lastClickedArea.value = area;
  } else if (event.shiftKey && lastClickedFile.value && lastClickedArea.value === area) {
    // Shift+click: range select within same area
    const fileList = getFileList(area);
    const lastIdx = fileList.findIndex(f => f.path === lastClickedFile.value);
    const currentIdx = fileList.findIndex(f => f.path === file.path);
    if (lastIdx !== -1 && currentIdx !== -1) {
      const start = Math.min(lastIdx, currentIdx);
      const end = Math.max(lastIdx, currentIdx);
      for (let i = start; i <= end; i++) {
        selectedFiles.value.add(fileList[i].path);
      }
    }
  } else {
    // Normal click: clear multi-select, select single, view diff
    selectedFiles.value.clear();
    selectedFiles.value.add(file.path);
    lastClickedFile.value = file.path;
    lastClickedArea.value = area;
    viewDiff(file);
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'modified': return 'M';
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'untracked': return 'U';
    case 'conflicted': return 'C';
    case 'copied': return 'C';
    default: return '?';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'modified': return 'text-yellow-500';
    case 'added': case 'untracked': return 'text-green-500';
    case 'deleted': return 'text-red-500';
    case 'renamed': case 'copied': return 'text-blue-500';
    case 'conflicted': return 'text-orange-500';
    default: return 'text-slate-500';
  }
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function fileDir(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.length > 0 ? parts.join('/') + '/' : '';
}

async function viewDiff(file: GitFileStatus) {
  await gitStore.getDiff(props.project.path, file.path, file.staged);
}

async function stageFile(file: GitFileStatus) {
  await gitStore.stageFiles(props.project.id, props.project.path, [file.path]);
}

async function unstageFile(file: GitFileStatus) {
  await gitStore.unstageFiles(props.project.id, props.project.path, [file.path]);
}

async function discardFile(file: GitFileStatus) {
  try {
    await ElMessageBox.confirm(t('git.discardConfirm'), t('common.warning'), { type: 'warning' });
  } catch {
    return;
  }
  try {
    if (file.status === 'untracked') {
      await gitStore.discardUntracked(props.project.id, props.project.path, [file.path]);
    } else {
      await gitStore.discardFiles(props.project.id, props.project.path, [file.path]);
    }
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleStageAll() {
  await gitStore.stageAll(props.project.id, props.project.path);
}

async function handleUnstageAll() {
  await gitStore.unstageAll(props.project.id, props.project.path);
}

// Batch operations
async function handleBatchStage() {
  const files = [
    ...unstagedFiles.value.filter(f => selectedFiles.value.has(f.path)),
    ...conflictedFiles.value.filter(f => selectedFiles.value.has(f.path)),
  ];
  if (files.length > 0) {
    await gitStore.stageFiles(props.project.id, props.project.path, files.map(f => f.path));
    selectedFiles.value.clear();
  }
}

async function handleBatchUnstage() {
  const files = stagedFiles.value.filter(f => selectedFiles.value.has(f.path));
  if (files.length > 0) {
    await gitStore.unstageFiles(props.project.id, props.project.path, files.map(f => f.path));
    selectedFiles.value.clear();
  }
}

async function handleBatchDiscard() {
  try {
    await ElMessageBox.confirm(t('git.discardConfirm'), t('common.warning'), { type: 'warning' });
  } catch {
    return;
  }
  const selected = unstagedFiles.value.filter(f => selectedFiles.value.has(f.path));
  const untracked = selected.filter(f => f.status === 'untracked');
  const modified = selected.filter(f => f.status !== 'untracked');
  try {
    if (untracked.length > 0) {
      await gitStore.discardUntracked(props.project.id, props.project.path, untracked.map(f => f.path));
    }
    if (modified.length > 0) {
      await gitStore.discardFiles(props.project.id, props.project.path, modified.map(f => f.path));
    }
    selectedFiles.value.clear();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}
</script>

<template>
  <div class="h-full flex flex-col text-[11px] select-none">
    <!-- No changes -->
    <div v-if="!hasChanges" class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1 p-4">
      <div class="i-mdi-check-circle-outline text-2xl" />
      <span>{{ t('git.noChanges') }}</span>
    </div>

    <template v-else>
      <!-- Staged area (top) -->
      <div class="flex flex-col min-h-0 overflow-hidden" :style="{ height: stagedRatio + '%' }">
        <div class="flex items-center gap-1 px-2 py-1 bg-green-500/5 border-b border-slate-200/30 dark:border-slate-700/20 shrink-0">
          <span class="font-medium text-green-600 dark:text-green-400 flex-1">
            {{ t('git.stagedChanges') }} ({{ stagedFiles.length }})
            <template v-if="selectedStagedCount > 0">
              <span class="text-blue-500 dark:text-blue-400 font-normal"> · {{ t('git.selectedCount', { count: selectedStagedCount }) }}</span>
            </template>
          </span>
          <template v-if="selectedStagedCount > 1">
            <button @click="handleBatchUnstage" class="text-[10px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 cursor-pointer" :title="t('git.batchUnstage')">
              {{ t('git.batchUnstage') }}
            </button>
            <button @click="selectedFiles.clear()" class="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" :title="t('git.clearSelection')">
              <div class="i-mdi-close-circle-outline" />
            </button>
          </template>
          <button v-else-if="stagedFiles.length > 0" @click="handleUnstageAll" class="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" :title="t('git.unstageAll')">
            <div class="i-mdi-minus-circle-outline" />
          </button>
        </div>
        <div class="flex-1 overflow-auto">
          <div v-if="stagedFiles.length === 0" class="flex items-center justify-center h-full text-slate-400/60 dark:text-slate-500/40 text-[10px]">
            {{ t('git.noChanges') }}
          </div>
          <div v-for="file in stagedFiles" :key="'s:' + file.path"
            @click="handleFileClick($event, file, 'staged')"
            class="flex items-center gap-1 px-2 py-1 cursor-pointer group select-none"
            :class="isFileSelected(file) ? 'bg-blue-500/12 dark:bg-blue-500/18 ring-1 ring-blue-400/30' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/30'">
            <span class="w-4 text-center font-mono font-bold text-[10px] shrink-0" :class="statusColor(file.status)">{{ statusIcon(file.status) }}</span>
            <span class="flex-1 truncate text-slate-700 dark:text-slate-300">
              <span class="text-slate-400 dark:text-slate-500">{{ fileDir(file.path) }}</span>{{ fileName(file.path) }}
            </span>
            <button @click.stop="unstageFile(file)" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-orange-500 transition-opacity cursor-pointer" :class="isFileSelected(file) ? '!opacity-100' : ''" :title="t('git.unstage')">
              <div class="i-mdi-minus text-xs" />
            </button>
          </div>
        </div>
      </div>

      <!-- Staged/Unstaged drag handle -->
      <div
        class="h-1 hover:h-1.5 shrink-0 cursor-row-resize transition-all hover:bg-blue-500/20"
        @mousedown="emit('staged-split-mousedown', $event)"
      >
        <div class="relative inset-x-0 -top-1 -bottom-1" />
      </div>

      <!-- Unstaged area (bottom) -->
      <div class="flex flex-col min-h-0 overflow-hidden" :style="{ height: (100 - stagedRatio) + '%' }">
        <!-- Conflicted files at top of unstaged -->
        <template v-if="conflictedFiles.length > 0">
          <div class="flex items-center gap-1 px-2 py-1 bg-orange-500/5 border-b border-slate-200/30 dark:border-slate-700/20 shrink-0">
            <span class="font-medium text-orange-600 dark:text-orange-400 flex-1">
              {{ t('git.conflictedFiles') }} ({{ conflictedFiles.length }})
            </span>
          </div>
          <div class="max-h-[100px] overflow-auto shrink-0">
            <div v-for="file in conflictedFiles" :key="'c:' + file.path"
              @click="handleFileClick($event, file, 'conflicted')"
              class="flex items-center gap-1 px-2 py-1 cursor-pointer group select-none"
              :class="isFileSelected(file) ? 'bg-blue-500/12 dark:bg-blue-500/18 ring-1 ring-blue-400/30' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/30'">
              <span class="w-4 text-center font-mono font-bold text-[10px] text-orange-500 shrink-0">C</span>
              <span class="flex-1 truncate text-slate-700 dark:text-slate-300">
                <span class="text-slate-400 dark:text-slate-500">{{ fileDir(file.path) }}</span>{{ fileName(file.path) }}
              </span>
              <button @click.stop="stageFile(file)" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-green-500 transition-opacity cursor-pointer" :class="isFileSelected(file) ? '!opacity-100' : ''" :title="t('git.stage')">
                <div class="i-mdi-plus text-xs" />
              </button>
            </div>
          </div>
        </template>

        <div class="flex items-center gap-1 px-2 py-1 bg-yellow-500/5 border-b border-slate-200/30 dark:border-slate-700/20 shrink-0">
          <span class="font-medium text-yellow-600 dark:text-yellow-400 flex-1">
            {{ t('git.unstagedChanges') }} ({{ unstagedFiles.length }})
            <template v-if="selectedUnstagedCount > 0">
              <span class="text-blue-500 dark:text-blue-400 font-normal"> · {{ t('git.selectedCount', { count: selectedUnstagedCount }) }}</span>
            </template>
          </span>
          <template v-if="selectedUnstagedCount > 1">
            <button @click="handleBatchStage" class="text-[10px] px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 cursor-pointer" :title="t('git.batchStage')">
              {{ t('git.batchStage') }}
            </button>
            <button @click="handleBatchDiscard" class="text-[10px] px-1 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 cursor-pointer" :title="t('git.batchDiscard')">
              {{ t('git.batchDiscard') }}
            </button>
            <button @click="selectedFiles.clear()" class="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" :title="t('git.clearSelection')">
              <div class="i-mdi-close-circle-outline" />
            </button>
          </template>
          <button v-else-if="unstagedFiles.length > 0" @click="handleStageAll" class="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" :title="t('git.stageAll')">
            <div class="i-mdi-plus-circle-outline" />
          </button>
        </div>
        <div class="flex-1 overflow-auto">
          <div v-if="unstagedFiles.length === 0" class="flex items-center justify-center h-full text-slate-400/60 dark:text-slate-500/40 text-[10px]">
            {{ t('git.noChanges') }}
          </div>
          <div v-for="file in unstagedFiles" :key="'u:' + file.path"
            @click="handleFileClick($event, file, 'unstaged')"
            class="flex items-center gap-1 px-2 py-1 cursor-pointer group select-none"
            :class="isFileSelected(file) ? 'bg-blue-500/12 dark:bg-blue-500/18 ring-1 ring-blue-400/30' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/30'">
            <span class="w-4 text-center font-mono font-bold text-[10px] shrink-0" :class="statusColor(file.status)">{{ statusIcon(file.status) }}</span>
            <span class="flex-1 truncate text-slate-700 dark:text-slate-300">
              <span class="text-slate-400 dark:text-slate-500">{{ fileDir(file.path) }}</span>{{ fileName(file.path) }}
            </span>
            <div class="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity shrink-0" :class="isFileSelected(file) ? '!opacity-100' : ''">
              <button @click.stop="stageFile(file)" class="text-slate-400 hover:text-green-500 cursor-pointer" :title="t('git.stage')">
                <div class="i-mdi-plus text-xs" />
              </button>
              <button @click.stop="discardFile(file)" class="text-slate-400 hover:text-red-500 cursor-pointer" :title="t('git.discard')">
                <div class="i-mdi-undo text-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>
