<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Project, GitFileStatus } from '../../types';
import { showPersistentGitError } from './message';
import { api } from '../../api';
import { useProjectExternalActions } from '../../composables/useProjectExternalActions';
import GitFileContextMenu from './GitFileContextMenu.vue';
import {
  gitStatusSelectionKey,
  isGitStatusSelected,
  selectedGitStatusFiles,
  type GitStatusArea,
} from '../../utils/gitStatusSelection';

const props = defineProps<{
  project: Project;
  stagedRatio: number;
}>();

const emit = defineEmits<{
  'staged-split-mousedown': [e: MouseEvent];
  'open-file-history': [file: string];
}>();

const { t } = useI18n();
const gitStore = useGitStore();
const { resolveEditorPath } = useProjectExternalActions(() => props.project);

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
const lastClickedArea = ref<GitStatusArea | null>(null);
const contextMenu = ref<{ x: number; y: number; targetPath: string; files: GitFileStatus[] } | null>(null);

const selectedStagedCount = computed(() =>
  selectedGitStatusFiles(selectedFiles.value, 'staged', stagedFiles.value).length
);
const selectedUnstagedCount = computed(() =>
  selectedGitStatusFiles(selectedFiles.value, 'unstaged', unstagedFiles.value).length
);

// Clear selection when project changes
watch(() => props.project.id, () => {
  selectedFiles.value.clear();
  lastClickedFile.value = null;
  lastClickedArea.value = null;
  contextMenu.value = null;
});

// Clear selection for files that no longer exist in status
watch(statusResult, () => {
  if (selectedFiles.value.size === 0) return;
  const allPaths = new Set([
    ...stagedFiles.value.map(f => gitStatusSelectionKey('staged', f.path)),
    ...unstagedFiles.value.map(f => gitStatusSelectionKey('unstaged', f.path)),
    ...conflictedFiles.value.map(f => gitStatusSelectionKey('conflicted', f.path)),
  ]);
  for (const key of selectedFiles.value) {
    if (!allPaths.has(key)) {
      selectedFiles.value.delete(key);
    }
  }
});

function isFileSelected(file: GitFileStatus, area: GitStatusArea): boolean {
  return isGitStatusSelected(selectedFiles.value, area, file.path);
}

function uniqueFiles(files: GitFileStatus[]): GitFileStatus[] {
  const seen = new Set<string>();
  return files.filter(file => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

function selectedStatusFiles(): GitFileStatus[] {
  return [
    ...selectedGitStatusFiles(selectedFiles.value, 'staged', stagedFiles.value),
    ...selectedGitStatusFiles(selectedFiles.value, 'unstaged', unstagedFiles.value),
    ...selectedGitStatusFiles(selectedFiles.value, 'conflicted', conflictedFiles.value),
  ];
}

function getFileList(area: 'staged' | 'unstaged' | 'conflicted'): GitFileStatus[] {
  if (area === 'staged') return stagedFiles.value;
  if (area === 'conflicted') return conflictedFiles.value;
  return unstagedFiles.value;
}

function handleFileClick(event: MouseEvent, file: GitFileStatus, area: 'staged' | 'unstaged' | 'conflicted') {
  const key = gitStatusSelectionKey(area, file.path);
  if (event.ctrlKey || event.metaKey) {
    // Ctrl+click: toggle selection
    if (selectedFiles.value.has(key)) {
      selectedFiles.value.delete(key);
    } else {
      selectedFiles.value.add(key);
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
        selectedFiles.value.add(gitStatusSelectionKey(area, fileList[i].path));
      }
    }
  } else {
    // Normal click: clear multi-select, select single, view diff
    selectedFiles.value.clear();
    selectedFiles.value.add(key);
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

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function fileDir(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.length > 0 ? parts.join('/') + '/' : '';
}

async function viewDiff(file: GitFileStatus) {
  try {
    await gitStore.getDiff(props.project.id, props.project.path, file.path, file.staged, file.old_path);
  } catch (e) {
    showPersistentGitError(t('git.diffLoadFailed', { error: String(e) }));
  }
}

async function stageFile(file: GitFileStatus) {
  try {
    await gitStore.stageFiles(props.project.id, props.project.path, [file.path]);
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function unstageFile(file: GitFileStatus) {
  try {
    await gitStore.unstageFiles(props.project.id, props.project.path, [file.path]);
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
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

function handleFileContextMenu(
  event: MouseEvent,
  file: GitFileStatus,
  area: 'staged' | 'unstaged' | 'conflicted',
) {
  event.preventDefault();
  const key = gitStatusSelectionKey(area, file.path);
  if (!selectedFiles.value.has(key)) {
    selectedFiles.value.clear();
    selectedFiles.value.add(key);
    lastClickedFile.value = file.path;
    lastClickedArea.value = area;
  }
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    targetPath: file.path,
    files: selectedStatusFiles(),
  };
}

function closeContextMenu() {
  contextMenu.value = null;
}

function isContextMenuElement(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.git-file-context-menu'));
}

function handleGlobalMouseDown(event: MouseEvent) {
  if (contextMenu.value && !isContextMenuElement(event.target)) closeContextMenu();
}

function handleGlobalClick(event: MouseEvent) {
  if (contextMenu.value && !isContextMenuElement(event.target)) closeContextMenu();
}

function handleGlobalScroll() {
  if (contextMenu.value) closeContextMenu();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && contextMenu.value) {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleGlobalMouseDown, true);
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('wheel', handleGlobalScroll, true);
  document.addEventListener('scroll', handleGlobalScroll, true);
  document.addEventListener('keydown', handleGlobalKeydown, true);
  window.addEventListener('resize', handleGlobalScroll);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleGlobalMouseDown, true);
  document.removeEventListener('click', handleGlobalClick);
  document.removeEventListener('wheel', handleGlobalScroll, true);
  document.removeEventListener('scroll', handleGlobalScroll, true);
  document.removeEventListener('keydown', handleGlobalKeydown, true);
  window.removeEventListener('resize', handleGlobalScroll);
});

function uniquePaths(files: GitFileStatus[]): string[] {
  return [...new Set(files.map(file => file.path))];
}

function fileWithExtension(files: GitFileStatus[]): GitFileStatus[] {
  return files.filter(file => {
    const name = file.path.split('/').pop() || file.path;
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1;
  });
}

function fileWithDirectory(files: GitFileStatus[]): GitFileStatus[] {
  return files.filter(file => file.path.includes('/'));
}

function absoluteFilePath(relativePath: string): string {
  const root = props.project.path.replace(/[\\/]+$/, '');
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root}${separator}${relativePath.replace(/[\\/]+/g, separator)}`;
}

async function copyPath(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(t('git.pathCopied'));
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function confirmDiscard(count: number): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      t('git.discardNConfirm', { count }),
      t('common.warning'),
      { type: 'warning' },
    );
    return true;
  } catch {
    return false;
  }
}

async function confirmStopTracking(count: number): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      t('git.stopTrackingConfirm', { count }),
      t('common.warning'),
      {
        type: 'warning',
        confirmButtonText: t('git.stopTrackingAndIgnore'),
        cancelButtonText: t('common.cancel'),
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function handleIgnore(
  files: GitFileStatus[],
  kind: 'file' | 'filename' | 'extension' | 'directory',
  local: boolean,
) {
  let applicable = files;
  if (kind === 'extension') applicable = fileWithExtension(files);
  if (kind === 'directory') applicable = fileWithDirectory(files);
  applicable = uniqueFiles(applicable);
  if (applicable.length === 0) {
    ElMessage.warning(t('git.ignoreNotApplicable'));
    return;
  }

    const tracked = applicable.filter(file => file.status !== 'untracked');
    const untracked = applicable.filter(file => file.status === 'untracked');
    try {
      if (tracked.length > 0) {
        if (local) {
          ElMessage.warning(t('git.localIgnoreTrackedUnsupported'));
        } else {
          if (!(await confirmStopTracking(tracked.length))) return;
          await gitStore.stopTracking(
            props.project.id,
            props.project.path,
            uniquePaths(tracked),
            kind,
            local,
          );
        }
      }
      if (untracked.length > 0) {
      await gitStore.addIgnorePattern(
        props.project.id,
        props.project.path,
        uniquePaths(untracked),
        kind,
        local,
      );
      }
      if (tracked.length > 0 && local && untracked.length === 0) return;
      ElMessage.success(t(local ? 'git.localIgnoreSuccess' : 'git.ignoreSuccess'));
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleContextAction(action: {
  type: 'stage' | 'unstage' | 'discard' | 'ignore' | 'stopTracking' | 'editor' | 'folder' | 'copyRelative' | 'copyAbsolute' | 'history';
  kind?: 'file' | 'filename' | 'extension' | 'directory';
  local?: boolean;
}) {
  const menu = contextMenu.value;
  if (!menu) return;
  closeContextMenu();
  const files = menu.files;

  try {
    if (action.type === 'stage') {
      const eligible = files.filter(file => !file.staged);
      if (eligible.length) await gitStore.stageFiles(props.project.id, props.project.path, uniquePaths(eligible));
      return;
    }
    if (action.type === 'unstage') {
      const eligible = files.filter(file => file.staged);
      if (eligible.length) await gitStore.unstageFiles(props.project.id, props.project.path, uniquePaths(eligible));
      return;
    }
    if (action.type === 'discard') {
      const tracked = files.filter(file => !file.staged && file.status !== 'untracked' && file.status !== 'conflicted');
      const untracked = files.filter(file => !file.staged && file.status === 'untracked');
      const count = new Set([...tracked, ...untracked].map(file => file.path)).size;
      if (!count || !(await confirmDiscard(count))) return;
      if (tracked.length) await gitStore.discardFiles(props.project.id, props.project.path, uniquePaths(tracked));
      if (untracked.length) await gitStore.discardUntracked(props.project.id, props.project.path, uniquePaths(untracked));
      return;
    }
    if (action.type === 'ignore' && action.kind) {
      await handleIgnore(files, action.kind, Boolean(action.local));
      return;
    }
    if (action.type === 'stopTracking') {
      const tracked = files.filter(file => file.status !== 'untracked');
      if (!tracked.length || !(await confirmStopTracking(tracked.length))) return;
      await gitStore.stopTracking(
        props.project.id,
        props.project.path,
        uniquePaths(tracked),
        'file',
        false,
      );
      ElMessage.success(t('git.ignoreSuccess'));
      return;
    }
    const target = absoluteFilePath(menu.targetPath);
    if (action.type === 'editor') {
      await api.openInEditor(target, resolveEditorPath(props.project));
      return;
    }
    if (action.type === 'folder') {
      await api.revealInFolder(target);
      return;
    }
    if (action.type === 'copyRelative') {
      await copyPath(menu.targetPath);
      return;
    }
    if (action.type === 'copyAbsolute') {
      await copyPath(target);
      return;
    }
    if (action.type === 'history') {
      emit('open-file-history', menu.targetPath);
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
    ...selectedGitStatusFiles(selectedFiles.value, 'unstaged', unstagedFiles.value),
    ...selectedGitStatusFiles(selectedFiles.value, 'conflicted', conflictedFiles.value),
  ];
  if (files.length > 0) {
    await gitStore.stageFiles(props.project.id, props.project.path, files.map(f => f.path));
    selectedFiles.value.clear();
  }
}

async function handleBatchUnstage() {
  const files = selectedGitStatusFiles(selectedFiles.value, 'staged', stagedFiles.value);
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
  const selected = selectedGitStatusFiles(selectedFiles.value, 'unstaged', unstagedFiles.value);
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
  <div class="git-status-panel">
    <!-- No changes -->
    <div v-if="!hasChanges" class="git-empty">
      <div class="i-mdi-check-circle-outline git-empty-icon" />
      <span>{{ t('git.noChanges') }}</span>
    </div>

    <template v-else>
      <!-- Staged area (top) -->
      <div class="git-scm-section" :style="{ height: stagedRatio + '%' }">
        <div class="git-scm-section-header is-staged">
          <span class="flex-1 min-w-0 truncate">
            {{ t('git.stagedChanges') }}
            <span class="git-scm-count">{{ stagedFiles.length }}</span>
            <template v-if="selectedStagedCount > 0">
              <span class="font-normal opacity-80"> · {{ t('git.selectedCount', { count: selectedStagedCount }) }}</span>
            </template>
          </span>
          <div class="git-scm-actions">
            <template v-if="selectedStagedCount > 1">
              <button type="button" class="git-scm-chip-btn" :title="t('git.batchUnstage')" @click="handleBatchUnstage">
                {{ t('git.batchUnstage') }}
              </button>
              <button type="button" class="git-scm-icon-btn" :title="t('git.clearSelection')" @click="selectedFiles.clear()">
                <div class="i-mdi-close-circle-outline" />
              </button>
            </template>
            <button
              v-else-if="stagedFiles.length > 0"
              type="button"
              class="git-scm-icon-btn"
              :title="t('git.unstageAll')"
              @click="handleUnstageAll"
            >
              <div class="i-mdi-minus-circle-outline" />
            </button>
          </div>
        </div>
        <div class="git-scm-list">
          <div v-if="stagedFiles.length === 0" class="git-scm-list-empty">
            {{ t('git.noChanges') }}
          </div>
          <div
            v-for="file in stagedFiles"
            :key="'s:' + file.path"
            class="git-scm-file-row"
            :class="{ 'is-selected': isFileSelected(file, 'staged') }"
            @click="handleFileClick($event, file, 'staged')"
            @contextmenu="handleFileContextMenu($event, file, 'staged')"
          >
            <span class="git-scm-file-status" :class="`is-${file.status}`">{{ statusIcon(file.status) }}</span>
            <span class="git-scm-file-main">
              <span class="git-scm-file-dir">{{ fileDir(file.path) }}</span><span class="git-scm-file-name">{{ fileName(file.path) }}</span>
            </span>
            <div class="git-scm-file-actions">
              <button type="button" :title="t('git.unstage')" @click.stop="unstageFile(file)">
                <div class="i-mdi-minus text-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Staged/Unstaged drag handle -->
      <div
        class="git-split-h"
        @mousedown="emit('staged-split-mousedown', $event)"
      />

      <!-- Unstaged area (bottom) -->
      <div class="git-scm-section" :style="{ height: (100 - stagedRatio) + '%' }">
        <!-- Conflicted files at top of unstaged -->
        <template v-if="conflictedFiles.length > 0">
          <div class="git-scm-section-header is-conflict">
            <span class="flex-1 min-w-0 truncate">
              {{ t('git.conflictedFiles') }}
              <span class="git-scm-count">{{ conflictedFiles.length }}</span>
            </span>
          </div>
          <div class="max-h-[100px] overflow-auto shrink-0">
            <div
              v-for="file in conflictedFiles"
              :key="'c:' + file.path"
              class="git-scm-file-row"
              :class="{ 'is-selected': isFileSelected(file, 'conflicted') }"
              @click="handleFileClick($event, file, 'conflicted')"
              @contextmenu="handleFileContextMenu($event, file, 'conflicted')"
            >
              <span class="git-scm-file-status is-conflicted">C</span>
              <span class="git-scm-file-main">
                <span class="git-scm-file-dir">{{ fileDir(file.path) }}</span><span class="git-scm-file-name">{{ fileName(file.path) }}</span>
              </span>
              <div class="git-scm-file-actions">
                <button type="button" class="is-success" :title="t('git.stage')" @click.stop="stageFile(file)">
                  <div class="i-mdi-plus text-xs" />
                </button>
              </div>
            </div>
          </div>
        </template>

        <div class="git-scm-section-header is-unstaged">
          <span class="flex-1 min-w-0 truncate">
            {{ t('git.unstagedChanges') }}
            <span class="git-scm-count">{{ unstagedFiles.length }}</span>
            <template v-if="selectedUnstagedCount > 0">
              <span class="font-normal opacity-80"> · {{ t('git.selectedCount', { count: selectedUnstagedCount }) }}</span>
            </template>
          </span>
          <div class="git-scm-actions">
            <template v-if="selectedUnstagedCount > 1">
              <button type="button" class="git-scm-chip-btn" :title="t('git.batchStage')" @click="handleBatchStage">
                {{ t('git.batchStage') }}
              </button>
              <button type="button" class="git-scm-chip-btn" :title="t('git.batchDiscard')" @click="handleBatchDiscard">
                {{ t('git.batchDiscard') }}
              </button>
              <button type="button" class="git-scm-icon-btn" :title="t('git.clearSelection')" @click="selectedFiles.clear()">
                <div class="i-mdi-close-circle-outline" />
              </button>
            </template>
            <button
              v-else-if="unstagedFiles.length > 0"
              type="button"
              class="git-scm-icon-btn"
              :title="t('git.stageAll')"
              @click="handleStageAll"
            >
              <div class="i-mdi-plus-circle-outline" />
            </button>
          </div>
        </div>
        <div class="git-scm-list">
          <div v-if="unstagedFiles.length === 0" class="git-scm-list-empty">
            {{ t('git.noChanges') }}
          </div>
          <div
            v-for="file in unstagedFiles"
            :key="'u:' + file.path"
            class="git-scm-file-row"
            :class="{ 'is-selected': isFileSelected(file, 'unstaged') }"
            @click="handleFileClick($event, file, 'unstaged')"
            @contextmenu="handleFileContextMenu($event, file, 'unstaged')"
          >
            <span class="git-scm-file-status" :class="`is-${file.status}`">{{ statusIcon(file.status) }}</span>
            <span class="git-scm-file-main">
              <span class="git-scm-file-dir">{{ fileDir(file.path) }}</span><span class="git-scm-file-name">{{ fileName(file.path) }}</span>
            </span>
            <div class="git-scm-file-actions">
              <button type="button" class="is-success" :title="t('git.stage')" @click.stop="stageFile(file)">
                <div class="i-mdi-plus text-xs" />
              </button>
              <button type="button" class="is-danger" :title="t('git.discard')" @click.stop="discardFile(file)">
                <div class="i-mdi-undo text-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <GitFileContextMenu
        v-if="contextMenu"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :target-path="contextMenu.targetPath"
        :files="contextMenu.files"
        @action="handleContextAction"
        @close="closeContextMenu"
      />
    </template>
  </div>
</template>
