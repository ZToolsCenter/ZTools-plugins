<script setup lang="ts">
import { computed, watch } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import type { Project, GitCommitFile } from '../../types';

const props = defineProps<{
  project: Project;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

const selectedHash = computed(() => gitStore.selectedCommitHash[props.project.id] || '');
const files = computed(() => {
  if (!selectedHash.value) return [];
  return gitStore.getCommitFiles(props.project.id, selectedHash.value);
});

const selectedFile = computed(() => gitStore.selectedDiffFile);

async function selectFile(file: GitCommitFile) {
  if (!selectedHash.value) return;
  await gitStore.getDiffCommitFile(props.project.path, selectedHash.value, file.path);
}

// Auto-select first file when commit selection changes
watch(files, async (newFiles) => {
  if (newFiles.length > 0) {
    await selectFile(newFiles[0]);
  }
});

const statusClass: Record<string, string> = {
  M: 'text-amber-500',
  A: 'text-green-500',
  D: 'text-red-500',
  R: 'text-blue-500',
  C: 'text-blue-400',
  T: 'text-slate-400',
  U: 'text-red-400',
};

const statusLabel: Record<string, string> = {
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  T: 'T',
  U: 'U',
};

function filename(path: string): string {
  return path.split('/').pop() || path;
}

function dirname(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden text-[11px]">
    <!-- Header -->
    <div class="px-2.5 py-1.5 border-b border-slate-200/40 dark:border-slate-700/20 shrink-0 flex items-center gap-1">
      <div class="i-mdi-file-tree-outline text-xs text-slate-400" />
      <span class="text-[10px] font-medium text-slate-500 dark:text-slate-400">
        {{ t('git.commitFiles') }}
      </span>
      <span v-if="files.length > 0" class="ml-auto text-[9px] text-slate-400 bg-slate-200/50 dark:bg-slate-700/30 px-1.5 py-0.5 rounded-full">{{ files.length }}</span>
    </div>

    <!-- Empty state -->
    <div v-if="!selectedHash" class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1 p-4">
      <div class="i-mdi-source-commit text-2xl" />
      <span class="text-center">{{ t('git.selectCommitToView') }}</span>
    </div>

    <!-- File list -->
    <div v-else class="flex-1 overflow-auto">
      <div
        v-for="file in files"
        :key="file.path"
        @click="selectFile(file)"
        class="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer border-b border-slate-200/15 dark:border-slate-700/10 transition-colors"
        :class="selectedFile === file.path
          ? 'bg-blue-500/8'
          : 'hover:bg-slate-100/50 dark:hover:bg-slate-800/20'"
      >
        <span class="shrink-0 font-mono font-bold text-[10px] w-3" :class="statusClass[file.status] || 'text-slate-400'">
          {{ statusLabel[file.status] || file.status }}
        </span>
        <div class="flex-1 min-w-0">
          <div class="truncate text-slate-700 dark:text-slate-300">{{ filename(file.path) }}</div>
          <div v-if="dirname(file.path)" class="truncate text-slate-400 dark:text-slate-500 text-[9px]">{{ dirname(file.path) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
