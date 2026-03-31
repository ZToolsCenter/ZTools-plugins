<script setup lang="ts">
import { computed } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Project, GitFileStatus } from '../../types';

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
    ElMessage.error(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleStageAll() {
  await gitStore.stageAll(props.project.id, props.project.path);
}

async function handleUnstageAll() {
  await gitStore.unstageAll(props.project.id, props.project.path);
}
</script>

<template>
  <div class="h-full flex flex-col text-[11px]">
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
          </span>
          <button v-if="stagedFiles.length > 0" @click="handleUnstageAll" class="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" :title="t('git.unstageAll')">
            <div class="i-mdi-minus-circle-outline" />
          </button>
        </div>
        <div class="flex-1 overflow-auto">
          <div v-if="stagedFiles.length === 0" class="flex items-center justify-center h-full text-slate-400/60 dark:text-slate-500/40 text-[10px]">
            {{ t('git.noChanges') }}
          </div>
          <div v-for="file in stagedFiles" :key="'s:' + file.path"
            @click="viewDiff(file)"
            class="flex items-center gap-1 px-2 py-1 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 cursor-pointer group">
            <span class="w-4 text-center font-mono font-bold text-[10px] shrink-0" :class="statusColor(file.status)">{{ statusIcon(file.status) }}</span>
            <span class="flex-1 truncate text-slate-700 dark:text-slate-300">
              <span class="text-slate-400 dark:text-slate-500">{{ fileDir(file.path) }}</span>{{ fileName(file.path) }}
            </span>
            <button @click.stop="unstageFile(file)" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-orange-500 transition-opacity cursor-pointer" :title="t('git.unstage')">
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
              @click="viewDiff(file)"
              class="flex items-center gap-1 px-2 py-1 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 cursor-pointer group">
              <span class="w-4 text-center font-mono font-bold text-[10px] text-orange-500 shrink-0">C</span>
              <span class="flex-1 truncate text-slate-700 dark:text-slate-300">
                <span class="text-slate-400 dark:text-slate-500">{{ fileDir(file.path) }}</span>{{ fileName(file.path) }}
              </span>
              <button @click.stop="stageFile(file)" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-green-500 transition-opacity cursor-pointer" :title="t('git.stage')">
                <div class="i-mdi-plus text-xs" />
              </button>
            </div>
          </div>
        </template>

        <div class="flex items-center gap-1 px-2 py-1 bg-yellow-500/5 border-b border-slate-200/30 dark:border-slate-700/20 shrink-0">
          <span class="font-medium text-yellow-600 dark:text-yellow-400 flex-1">
            {{ t('git.unstagedChanges') }} ({{ unstagedFiles.length }})
          </span>
          <button v-if="unstagedFiles.length > 0" @click="handleStageAll" class="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer" :title="t('git.stageAll')">
            <div class="i-mdi-plus-circle-outline" />
          </button>
        </div>
        <div class="flex-1 overflow-auto">
          <div v-if="unstagedFiles.length === 0" class="flex items-center justify-center h-full text-slate-400/60 dark:text-slate-500/40 text-[10px]">
            {{ t('git.noChanges') }}
          </div>
          <div v-for="file in unstagedFiles" :key="'u:' + file.path"
            @click="viewDiff(file)"
            class="flex items-center gap-1 px-2 py-1 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 cursor-pointer group">
            <span class="w-4 text-center font-mono font-bold text-[10px] shrink-0" :class="statusColor(file.status)">{{ statusIcon(file.status) }}</span>
            <span class="flex-1 truncate text-slate-700 dark:text-slate-300">
              <span class="text-slate-400 dark:text-slate-500">{{ fileDir(file.path) }}</span>{{ fileName(file.path) }}
            </span>
            <div class="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity shrink-0">
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
