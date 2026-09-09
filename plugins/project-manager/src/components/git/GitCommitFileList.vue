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

const selectedFile = computed(() => gitStore.getDiffSelection(props.project.id).file);

async function selectFile(file: GitCommitFile) {
  if (!selectedHash.value) return;
  await gitStore.getDiffCommitFile(
    props.project.id,
    props.project.path,
    selectedHash.value,
    file.path,
    file.old_path,
  );
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
  <div class="git-commit-files app-text-control">
    <!-- Header -->
    <div class="git-commit-files-header">
      <div class="i-mdi-file-tree-outline text-xs opacity-70" />
      <span>{{ t('git.commitFiles') }}</span>
      <span v-if="files.length > 0" class="git-commit-files-count">{{ files.length }}</span>
    </div>

    <!-- Empty state -->
    <div v-if="!selectedHash" class="git-empty">
      <div class="i-mdi-source-commit git-empty-icon" />
      <span>{{ t('git.selectCommitToView') }}</span>
    </div>

    <!-- File list -->
    <div v-else class="flex-1 overflow-auto">
      <div
        v-for="file in files"
        :key="file.path"
        class="git-commit-file-row"
        :class="{ 'is-active': selectedFile === file.path }"
        @click="selectFile(file)"
      >
        <span class="git-scm-file-status shrink-0 w-3" :class="statusClass[file.status] || ''">
          {{ statusLabel[file.status] || file.status }}
        </span>
        <div class="flex-1 min-w-0">
          <div class="git-scm-file-name truncate">{{ filename(file.path) }}</div>
          <div v-if="dirname(file.path)" class="git-scm-file-dir truncate app-text-meta">{{ dirname(file.path) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
