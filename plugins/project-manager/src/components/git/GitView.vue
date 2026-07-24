<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import { useProjectStore } from '../../stores/project';
import { useGitStore } from '../../stores/git';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { useSplitPane } from '../../composables/useSplitPane';
import { api } from '../../api';
import GitToolbar from './GitToolbar.vue';
import GitStatusPanel from './GitStatusPanel.vue';
import GitCommitArea from './GitCommitArea.vue';
import GitDiffView from './GitDiffView.vue';
import GitHistory from './GitHistory.vue';
import GitBranchDialog from './GitBranchDialog.vue';
import GitCommitFileList from './GitCommitFileList.vue';
import GitRemoteSettingsDialog from './GitRemoteSettingsDialog.vue';
import { showPersistentGitError } from './message';

const { t } = useI18n();
const projectStore = useProjectStore();
const gitStore = useGitStore();
const settingsStore = useSettingsStore();

const activeTab = ref<'changes' | 'history'>('changes');
const showBranchDialog = ref(false);
const showSettingsDialog = ref(false);

const activeProject = computed(() =>
  projectStore.projects.find(p => p.id === projectStore.activeProjectId)
);

const isGitRepo = computed(() => {
  if (!activeProject.value) return false;
  return gitStore.isGitRepo[activeProject.value.id] || false;
});

// Draggable split panes for changes tab
function getSavedLayoutNumber(storageKey: string, fallback: number, min: number, max: number) {
  const value = settingsStore.settings.layoutState?.[storageKey];
  if (typeof value !== 'number') return fallback;
  return Math.min(max, Math.max(min, value));
}

function persistLayoutNumber(storageKey: string, value: number) {
  if (!settingsStore.settings.layoutState) {
    settingsStore.settings.layoutState = {};
  }
  settingsStore.settings.layoutState[storageKey] = value;
}

const leftPaneContainerRef = ref<HTMLElement | null>(null);
const leftContainerWidth = ref(0);
let leftResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!leftPaneContainerRef.value) return;
  leftResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) leftContainerWidth.value = entry.contentRect.width;
  });
  leftResizeObserver.observe(leftPaneContainerRef.value);
});

onUnmounted(() => {
  leftResizeObserver?.disconnect();
});

const leftPaneMax = computed(() => leftContainerWidth.value > 0 ? leftContainerWidth.value * 0.5 : 500);
const leftPane = useSplitPane({
  initial: 280,
  min: 180,
  max: leftPaneMax,
  direction: 'horizontal',
  storageKey: 'git.changes.leftPane',
});
const commitPane = useSplitPane({
  initial: 180,
  min: 120,
  max: 400,
  direction: 'vertical',
  reverse: true,
  storageKey: 'git.changes.commitPane',
});
const historyTopPane = useSplitPane({
  initial: 250,
  min: 140,
  max: 820,
  direction: 'vertical',
  storageKey: 'git.history.topPane',
});
const historyLeftPane = useSplitPane({
  initial: 360,
  min: 260,
  max: 700,
  direction: 'horizontal',
  storageKey: 'git.history.leftPane',
});
const historyDetailPane = useSplitPane({
  initial: 170,
  min: 110,
  max: 420,
  direction: 'vertical',
  storageKey: 'git.history.detailPane',
});
// For the staged/unstaged vertical split inside status panel, we use a percentage-based approach
const stagedRatio = ref(getSavedLayoutNumber('git.changes.stagedRatio', 50, 15, 85)); // percentage of staged area height
let stagedDragStart = 0;
let stagedRatioStart = 0;
const isDraggingStagedSplit = ref(false);
const statusPanelRef = ref<HTMLElement | null>(null);
const isViewActive = ref(false);
let refreshTimer: number | null = null;

function onStagedSplitMouseDown(e: MouseEvent) {
  e.preventDefault();
  isDraggingStagedSplit.value = true;
  stagedDragStart = e.clientY;
  stagedRatioStart = stagedRatio.value;
  document.addEventListener('mousemove', onStagedSplitMouseMove);
  document.addEventListener('mouseup', onStagedSplitMouseUp);
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
}

function onStagedSplitMouseMove(e: MouseEvent) {
  if (!statusPanelRef.value) return;
  const panelHeight = statusPanelRef.value.clientHeight;
  if (panelHeight <= 0) return;
  const delta = e.clientY - stagedDragStart;
  const deltaPercent = (delta / panelHeight) * 100;
  const newRatio = Math.min(85, Math.max(15, stagedRatioStart + deltaPercent));
  stagedRatio.value = newRatio;
}

function onStagedSplitMouseUp() {
  isDraggingStagedSplit.value = false;
  document.removeEventListener('mousemove', onStagedSplitMouseMove);
  document.removeEventListener('mouseup', onStagedSplitMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  persistLayoutNumber('git.changes.stagedRatio', stagedRatio.value);
}

function clearScheduledRefresh() {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh(options: { force?: boolean; includeHistory?: boolean; delayMs?: number } = {}) {
  clearScheduledRefresh();

  const delayMs = options.delayMs ?? 120;
  refreshTimer = window.setTimeout(async () => {
    refreshTimer = null;

    if (!isViewActive.value || gitStore.coldStorage || !activeProject.value) {
      return;
    }

    const project = activeProject.value;
    const isRepo = await gitStore.checkGitRepo(project.id, project.path, { force: options.force });
    if (!isRepo) return;

    await gitStore.ensureSummaryAndStatus(project.id, project.path, { force: options.force });
    if (options.includeHistory) {
      await gitStore.ensureHistory(project.id, project.path, { force: options.force });
    }
  }, delayMs);
}

function enterActiveMode() {
  isViewActive.value = true;
  gitStore.setColdStorage(false);
  scheduleRefresh({
    includeHistory: activeTab.value === 'history',
    delayMs: 60,
  });
}

function enterColdStorage() {
  isViewActive.value = false;
  clearScheduledRefresh();
  gitStore.setColdStorage(true);
}

// Watch project changes — refresh lazily after the selection UI settles
watch(activeProject, (newProject, oldProject) => {
  if (oldProject?.id !== newProject?.id) {
    gitStore.clearDiff();
  }
  if (!newProject || !isViewActive.value) return;
  scheduleRefresh({
    includeHistory: activeTab.value === 'history',
    delayMs: 140,
  });
}, { immediate: true });

// Auto-refresh when window regains focus (e.g. after alt-tab)
let unlistenFocus: (() => void) | null = null;
api.onWindowFocus(() => {
  if (!isViewActive.value || !activeProject.value || gitStore.coldStorage) return;
  scheduleRefresh({
    includeHistory: activeTab.value === 'history',
    delayMs: 180,
  });
}).then(unlisten => { unlistenFocus = unlisten; });
onUnmounted(() => {
  clearScheduledRefresh();
  unlistenFocus?.();
  persistLayoutNumber('git.changes.stagedRatio', stagedRatio.value);
});

onActivated(enterActiveMode);
onDeactivated(enterColdStorage);

// Clear diff when switching tabs; history is loaded only when the tab is used
watch(activeTab, (tab) => {
  gitStore.clearDiff();
  if (tab === 'history' && activeProject.value && isViewActive.value) {
    scheduleRefresh({
      includeHistory: true,
      delayMs: 0,
    });
  }
});

async function handleInitRepo() {
  if (!activeProject.value) return;
  try {
    await gitStore.initRepo(activeProject.value.id, activeProject.value.path);
    ElMessage.success(t('git.initSuccess'));
  } catch (e: any) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleRefresh() {
  if (!activeProject.value) return;
  await gitStore.refreshSummaryAndStatus(activeProject.value.id, activeProject.value.path);
  if (activeTab.value === 'history') {
    await gitStore.refreshHistory(activeProject.value.id, activeProject.value.path);
  }
}

const tabs = computed(() => [
  { value: 'changes' as const, label: t('git.fileStatus') },
  { value: 'history' as const, label: t('git.commitHistory') },
]);

// History tab helpers
const selectedHistoryHash = computed(() => {
  if (!activeProject.value) return '';
  return gitStore.selectedCommitHash[activeProject.value.id] || '';
});

const selectedHistoryCommit = computed(() => {
  if (!activeProject.value || !selectedHistoryHash.value) return null;
  const detail = gitStore.getCommitDetail(activeProject.value.id, selectedHistoryHash.value);
  if (detail) return detail;
  const commits = gitStore.history[activeProject.value.id] || [];
  return commits.find(c => c.hash === selectedHistoryHash.value) || null;
});

function shortHistoryRefs(refs: string[]): string[] {
  return refs
    .map(r => r.replace('HEAD -> ', '').replace('origin/', ''))
    .filter(r => r && r !== 'HEAD');
}

function formatHistoryDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return dateStr;
  }
}

const selectedHistoryParent = computed(() => {
  if (!selectedHistoryCommit.value) return '-';
  return selectedHistoryCommit.value.parents[0] || '-';
});

function closeHistoryDetail() {
  if (!activeProject.value) return;
  gitStore.selectedCommitHash[activeProject.value.id] = '';
  gitStore.clearDiff();
}

async function copyText(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(successMessage);
  } catch (error) {
    showPersistentGitError(t('git.operationFailed', { error: String(error) }));
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Not a git repo -->
    <div v-if="!isGitRepo" class="flex-1 flex flex-col items-center justify-center gap-3">
      <div class="i-mdi-source-branch text-4xl text-slate-300 dark:text-slate-600" />
      <p class="text-sm text-slate-500 dark:text-slate-400">{{ t('git.notGitRepo') }}</p>
      <button @click="handleInitRepo"
        class="px-4 py-1.5 rounded-md text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors cursor-pointer">
        {{ t('git.initRepo') }}
      </button>
    </div>

    <!-- Git view -->
    <template v-else-if="activeProject">
      <!-- Toolbar -->
      <GitToolbar
        :project="activeProject"
        @open-branch-dialog="showBranchDialog = true"
        @open-settings-dialog="showSettingsDialog = true"
        @refresh="handleRefresh"
      />

      <!-- Tab bar -->
      <div class="flex border-b border-slate-200/40 dark:border-slate-700/30 shrink-0 px-2">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          @click="activeTab = tab.value"
          class="px-3 py-1.5 text-[11px] font-medium transition-colors border-b-2 -mb-px cursor-pointer"
          :class="activeTab === tab.value
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-700/40'"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ===== CHANGES TAB: SourceTree-style layout ===== -->
      <div v-if="activeTab === 'changes'" class="flex-1 flex flex-col min-h-0">
        <!-- Top area: status panel (left) + diff view (right) -->
        <div ref="leftPaneContainerRef" class="flex-1 flex min-h-0">
          <!-- Left: file status panel (staged top / unstaged bottom) -->
          <div class="flex flex-col shrink-0 border-r border-slate-200/40 dark:border-slate-700/30" :style="{ width: leftPane.size.value + 'px' }">
            <div ref="statusPanelRef" class="flex-1 flex flex-col min-h-0 overflow-hidden">
              <GitStatusPanel
                :project="activeProject"
                :staged-ratio="stagedRatio"
                @staged-split-mousedown="onStagedSplitMouseDown"
              />
            </div>
          </div>

          <!-- Vertical drag handle: left ↔ right -->
          <div
            class="w-1 hover:w-1.5 shrink-0 cursor-col-resize transition-all group relative"
            :class="leftPane.isDragging.value ? 'bg-blue-500/40 w-1.5' : 'hover:bg-blue-500/20'"
            @mousedown="leftPane.onMouseDown"
          >
            <div class="absolute inset-y-0 -left-1 -right-1" />
          </div>

          <!-- Right: diff view -->
          <div class="flex-1 min-w-0">
            <GitDiffView :project="activeProject" />
          </div>
        </div>

        <!-- Horizontal drag handle: workspace ↔ commit -->
        <div
          class="h-1 hover:h-1.5 shrink-0 cursor-row-resize transition-all"
          :class="commitPane.isDragging.value ? 'bg-blue-500/40 h-1.5' : 'hover:bg-blue-500/20'"
          @mousedown="commitPane.onMouseDown"
        >
          <div class="absolute inset-x-0 -top-1 -bottom-1 relative" />
        </div>

        <!-- Bottom: commit area spanning full width -->
        <div class="shrink-0 border-t border-slate-200/40 dark:border-slate-700/30" :style="{ height: commitPane.size.value + 'px' }">
          <GitCommitArea :project="activeProject" class="h-full" />
        </div>
      </div>

      <!-- ===== HISTORY TAB: top-bottom layout ===== -->
      <div v-else class="flex-1 flex flex-col min-h-0">
        <!-- Top: commit list -->
        <div
          class="shrink-0 overflow-hidden border-b border-slate-200/40 dark:border-slate-700/30"
          :class="selectedHistoryHash ? '' : 'flex-1'"
          :style="selectedHistoryHash ? { height: historyTopPane.size.value + 'px' } : undefined"
        >
          <GitHistory :project="activeProject" />
        </div>

        <!-- Drag handle: history list ↕ detail workspace -->
        <div
          v-if="selectedHistoryHash"
          class="h-1 hover:h-1.5 shrink-0 cursor-row-resize transition-all"
          :class="historyTopPane.isDragging.value ? 'bg-blue-500/40 h-1.5' : 'hover:bg-blue-500/20'"
          @mousedown="historyTopPane.onMouseDown"
        >
          <div class="absolute inset-x-0 -top-1 -bottom-1 relative" />
        </div>

        <!-- Bottom: commit detail (info + files | diff) -->
        <div v-if="selectedHistoryHash" class="flex-1 flex min-h-0">
          <!-- Left: commit info + file list -->
          <div
            class="flex flex-col border-r border-slate-200/40 dark:border-slate-700/30 shrink-0 min-w-0"
            :style="{ width: historyLeftPane.size.value + 'px' }"
          >
            <!-- Commit info header -->
            <div
              v-if="selectedHistoryCommit"
              class="px-3 py-2 border-b border-slate-200/40 dark:border-slate-700/20 shrink-0 text-[11px] space-y-2 overflow-auto select-text"
              :style="{ height: historyDetailPane.size.value + 'px' }"
            >
              <div class="flex items-center justify-between gap-2 pb-1 border-b border-slate-200/40 dark:border-slate-700/20">
                <span class="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {{ t('git.commitDetail') }}
                </span>
                <button
                  class="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors"
                  @click="closeHistoryDetail"
                >
                  {{ t('common.close') }}
                </button>
              </div>
              <div class="leading-relaxed text-slate-600 dark:text-slate-300">
                <div class="flex items-center gap-2">
                  <span class="text-slate-400 dark:text-slate-500">提交：</span>
                  <span class="font-mono break-all flex-1">{{ selectedHistoryCommit.hash }} [{{ selectedHistoryCommit.short_hash }}]</span>
                </div>
              </div>
              <div class="leading-relaxed text-slate-600 dark:text-slate-300">
                <span class="text-slate-400 dark:text-slate-500">父级：</span>
                <span class="font-mono break-all whitespace-pre-wrap">{{ selectedHistoryParent }}</span>
              </div>
              <div class="leading-relaxed text-slate-600 dark:text-slate-300">
                <span class="text-slate-400 dark:text-slate-500">作者：</span>
                <span>{{ selectedHistoryCommit.author }} &lt;{{ selectedHistoryCommit.email }}&gt;</span>
              </div>
              <div class="leading-relaxed text-slate-600 dark:text-slate-300">
                <span class="text-slate-400 dark:text-slate-500">日期：</span>
                <span>{{ formatHistoryDate(selectedHistoryCommit.date) }}</span>
              </div>
              <div class="leading-relaxed text-slate-600 dark:text-slate-300">
                <span class="text-slate-400 dark:text-slate-500">提交者：</span>
                <span>{{ selectedHistoryCommit.committer || selectedHistoryCommit.author }}</span>
              </div>
              <div class="leading-relaxed text-slate-600 dark:text-slate-300 space-y-1">
                <div class="flex items-center gap-2">
                  <span class="text-slate-400 dark:text-slate-500">提交信息：</span>
                  <button
                    class="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors"
                    @click="copyText(selectedHistoryCommit.message, t('git.copyCommitMessageSuccess'))"
                  >
                    {{ t('git.copyCommitMessage') }}
                  </button>
                </div>
                <pre class="m-0 whitespace-pre-wrap break-words font-sans leading-relaxed text-slate-700 dark:text-slate-200">{{ selectedHistoryCommit.message }}</pre>
              </div>
              <div class="pt-1 flex items-center gap-1.5 overflow-hidden">
                <span
                  v-for="ref in shortHistoryRefs(selectedHistoryCommit.refs).slice(0, 5)"
                  :key="ref"
                  class="text-[9px] px-1.5 py-0 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium truncate max-w-26"
                >{{ ref }}</span>
              </div>
            </div>

            <!-- Drag handle: commit detail ↕ files -->
            <div
              class="h-1 hover:h-1.5 shrink-0 cursor-row-resize transition-all"
              :class="historyDetailPane.isDragging.value ? 'bg-blue-500/40 h-1.5' : 'hover:bg-blue-500/20'"
              @mousedown="historyDetailPane.onMouseDown"
            >
              <div class="absolute inset-x-0 -top-1 -bottom-1 relative" />
            </div>

            <!-- File list -->
            <div class="flex-1 min-h-0">
              <GitCommitFileList :project="activeProject" />
            </div>
          </div>

          <!-- Drag handle: left panel ↔ diff -->
          <div
            class="w-1 hover:w-1.5 shrink-0 cursor-col-resize transition-all group relative"
            :class="historyLeftPane.isDragging.value ? 'bg-blue-500/40 w-1.5' : 'hover:bg-blue-500/20'"
            @mousedown="historyLeftPane.onMouseDown"
          >
            <div class="absolute inset-y-0 -left-1 -right-1" />
          </div>

          <!-- Right: diff view -->
          <div class="flex-1 min-w-0">
            <GitDiffView :project="activeProject" />
          </div>
        </div>

        <!-- Empty state when no commit selected -->
        <div v-else class="hidden" />
      </div>

      <!-- Branch dialog -->
      <GitBranchDialog
        v-model="showBranchDialog"
        :project="activeProject"
      />

      <!-- Remote settings dialog -->
      <GitRemoteSettingsDialog
        v-model="showSettingsDialog"
        :project="activeProject"
      />
    </template>
  </div>
</template>
