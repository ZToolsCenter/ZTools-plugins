<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onUnmounted, nextTick, useTemplateRef } from 'vue';
import { useGitStore } from '../../stores/git';
import { useSettingsStore } from '../../stores/settings';
import type { Project } from '../../types';
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
import GitRepoCenterDialog from './GitRepoCenterDialog.vue';
import { showPersistentGitError } from './message';

const { t } = useI18n();
const gitStore = useGitStore();
const settingsStore = useSettingsStore();

/**
 * 由父组件显式传入当前项目。
 *
 * 之前读全局 projectStore.activeProjectId —— 但本组件被 KeepAlive 缓存，
 * 缓存里的每个实例都会跟着全局值一起变成**新**项目，导致被停用的实例也去
 * 清 diff、清提交选中态，清掉的恰恰是即将要显示的那一份。
 * 改成 props 后，外层的 `:key` 把实例与项目绑定，props 在实例生命周期内恒定。
 */
const props = defineProps<{ project: Project }>();

const activeTab = ref<'changes' | 'history'>('changes');
const fileHistoryPath = ref('');
const showBranchDialog = ref(false);
const showSettingsDialog = ref(false);
const showRepoCenter = ref(false);

// 保留 activeProject 这个名字：模板与下方约 20 处引用无需改动
const activeProject = computed(() => props.project);

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

/***********************Changes 左右分栏（百分比，默认 50%）*********************/
// 相对「整个状态+Diff 容器宽度」存比例，窗口缩放时按比例重算，避免大窗像素写死、小窗挤爆右侧

const LEFT_PANE_DEFAULT_RATIO = 0.5;
const LEFT_PANE_MAX_RATIO = 0.5;
const LEFT_PANE_MIN_PX = 180;
const LEFT_PANE_STORAGE_KEY = 'git.changes.leftPane';

const leftPaneContainerRef = useTemplateRef<HTMLElement>('leftPaneContainerRef');
const leftContainerWidth = ref(0);
const isDraggingLeftPane = ref(false);
let leftResizeObserver: ResizeObserver | null = null;
let leftPaneDragStartX = 0;
let leftPaneDragStartRatio = LEFT_PANE_DEFAULT_RATIO;

/** 读取已存比例：0~1 为相对全宽；>1 为旧版像素，待有容器宽后换算 */
function readLeftPaneRatioFromStorage(): number {
  const stored = settingsStore.settings.layoutState?.[LEFT_PANE_STORAGE_KEY];
  if (typeof stored !== 'number' || !Number.isFinite(stored) || stored <= 0) {
    return LEFT_PANE_DEFAULT_RATIO;
  }
  // 新格式：相对容器全宽的比例
  if (stored <= 1) {
    return Math.min(LEFT_PANE_MAX_RATIO, Math.max(0.05, stored));
  }
  // 旧格式像素：尚无容器宽度时先回默认，测量后再迁移
  return LEFT_PANE_DEFAULT_RATIO;
}

const leftPaneRatio = ref(readLeftPaneRatioFromStorage());
/** 旧版像素值，等 ResizeObserver 量到宽度后一次性迁成比例 */
let leftPaneLegacyPixels: number | null = (() => {
  const stored = settingsStore.settings.layoutState?.[LEFT_PANE_STORAGE_KEY];
  if (typeof stored === 'number' && stored > 1) return stored;
  return null;
})();

function clampLeftPaneRatio(ratio: number, containerW: number): number {
  if (containerW <= 0) {
    return Math.min(LEFT_PANE_MAX_RATIO, Math.max(0.05, ratio));
  }
  const minRatio = Math.min(LEFT_PANE_MAX_RATIO, LEFT_PANE_MIN_PX / containerW);
  return Math.min(LEFT_PANE_MAX_RATIO, Math.max(minRatio, ratio));
}

function persistLeftPaneRatio() {
  if (!settingsStore.settings.layoutState) {
    settingsStore.settings.layoutState = {};
  }
  const ratio = Math.round(leftPaneRatio.value * 1000) / 1000;
  settingsStore.settings.layoutState[LEFT_PANE_STORAGE_KEY] = ratio;
}

/** 左侧像素宽：始终由 ratio × 当前容器宽得出；未测量时为 null，样式回退到 50% */
const leftPaneWidthPx = computed((): number | null => {
  const w = leftContainerWidth.value;
  if (w <= 0) return null;
  const ratio = clampLeftPaneRatio(leftPaneRatio.value, w);
  return Math.round(ratio * w);
});

const leftPaneStyle = computed(() => {
  const px = leftPaneWidthPx.value;
  if (px != null && px > 0) {
    return { width: `${px}px`, maxWidth: `${LEFT_PANE_MAX_RATIO * 100}%` };
  }
  // 首帧未测量：默认一半，不写死像素
  return { width: `${LEFT_PANE_DEFAULT_RATIO * 100}%`, maxWidth: `${LEFT_PANE_MAX_RATIO * 100}%` };
});

function applyLeftContainerWidth(w: number) {
  if (w <= 0) return;
  leftContainerWidth.value = w;

  // 旧像素 → 相对全宽比例（并封顶 50%）
  if (leftPaneLegacyPixels !== null) {
    leftPaneRatio.value = clampLeftPaneRatio(leftPaneLegacyPixels / w, w);
    leftPaneLegacyPixels = null;
    persistLeftPaneRatio();
    return;
  }

  if (!isDraggingLeftPane.value) {
    leftPaneRatio.value = clampLeftPaneRatio(leftPaneRatio.value, w);
  }
}

function measureLeftContainerWidth() {
  const el = leftPaneContainerRef.value;
  if (!el) return;
  applyLeftContainerWidth(el.getBoundingClientRect().width);
}

function bindLeftPaneResizeObserver(el: HTMLElement) {
  leftResizeObserver?.disconnect();
  leftResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    applyLeftContainerWidth(entry.contentRect.width);
  });
  leftResizeObserver.observe(el);
  nextTick(() => measureLeftContainerWidth());
}

// Changes 页 v-if 挂载/卸载时重绑，保证切回 Tab 与窗口缩放都能更新
watch(leftPaneContainerRef, (el) => {
  if (!el) {
    leftResizeObserver?.disconnect();
    leftResizeObserver = null;
    leftContainerWidth.value = 0;
    return;
  }
  bindLeftPaneResizeObserver(el);
});

onMounted(() => {
  enterActiveMode();
  if (leftPaneContainerRef.value) {
    bindLeftPaneResizeObserver(leftPaneContainerRef.value);
  }
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
const statusPanelRef = useTemplateRef<HTMLElement>('statusPanelRef');
const isViewActive = ref(false);
let refreshTimer: number | null = null;
/**
 * 本实例是否真的拖动过分栏。
 *
 * leftPaneRatio / stagedRatio 是每实例私有、创建时从 settings 读取，
 * 而 layoutState 的键是全局共享的。GitView 被 KeepAlive 缓存后会同时存在多个
 * 实例，卸载时无条件回写会让陈旧实例的旧比例覆盖用户最近一次拖动。
 */
let hasDraggedPanes = false;

// 左右分割：拖拽改的是百分比，松手后持久化比例
function onLeftPaneMouseDown(e: MouseEvent) {
  e.preventDefault();
  measureLeftContainerWidth();
  if (leftContainerWidth.value <= 0) return;

  isDraggingLeftPane.value = true;
  leftPaneDragStartX = e.clientX;
  leftPaneDragStartRatio = clampLeftPaneRatio(leftPaneRatio.value, leftContainerWidth.value);
  document.addEventListener('mousemove', onLeftPaneMouseMove);
  document.addEventListener('mouseup', onLeftPaneMouseUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onLeftPaneMouseMove(e: MouseEvent) {
  if (!isDraggingLeftPane.value) return;
  const w = leftContainerWidth.value;
  if (w <= 0) return;
  const deltaRatio = (e.clientX - leftPaneDragStartX) / w;
  leftPaneRatio.value = clampLeftPaneRatio(leftPaneDragStartRatio + deltaRatio, w);
}

function onLeftPaneMouseUp() {
  if (!isDraggingLeftPane.value) return;
  isDraggingLeftPane.value = false;
  document.removeEventListener('mousemove', onLeftPaneMouseMove);
  document.removeEventListener('mouseup', onLeftPaneMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  hasDraggedPanes = true;
  persistLeftPaneRatio();
}

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
  hasDraggedPanes = true;
  persistLayoutNumber('git.changes.stagedRatio', stagedRatio.value);
}

function clearScheduledRefresh() {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh(options: { force?: boolean; includeHistory?: boolean; includeBranches?: boolean; delayMs?: number } = {}) {
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

    if (options.force || options.includeBranches) {
      await gitStore.refreshRepositoryState(project.id, project.path, {
        includeHistory: options.includeHistory,
        includeBranches: options.includeBranches,
      });
      return;
    }

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
    force: true,
    includeHistory: activeTab.value === 'history',
    includeBranches: true,
    delayMs: 60,
  });
}

function enterColdStorage() {
  isViewActive.value = false;
  clearScheduledRefresh();
  // 刷新是否允许由本实例的 isViewActive 控制；不能在这里改写全局 coldStorage，
  // 否则快速管理弹窗和完整工作区同时缓存 GitView 时会互相误伤。
}

async function handleRepositoryChanged() {
  if (!activeProject.value) return;
  await gitStore.refreshRepositoryState(activeProject.value.id, activeProject.value.path, {
    includeHistory: activeTab.value === 'history',
    includeBranches: true,
  });
}

// 注：原先这里有一个 watch(activeProject, …, { immediate: true })，做两件事：
// 切项目时清 diff，以及触发一次刷新。
// props 化后 project 在实例生命周期内恒定，该 watcher 永不触发，故删除。
// - 清 diff 本来就是**有害**的：它清的是新项目那一桶（缓存里每个实例都会跑一次）
// - 刷新已由 onMounted 与 onActivated 的 enterActiveMode（force: true）覆盖

// Auto-refresh when window regains focus (e.g. after alt-tab)
let unlistenFocus: (() => void) | null = null;
api.onWindowFocus(() => {
  if (!isViewActive.value || !activeProject.value || gitStore.coldStorage) return;
  scheduleRefresh({
    force: true,
    includeHistory: activeTab.value === 'history',
    includeBranches: true,
    delayMs: 180,
  });
}).then(unlisten => { unlistenFocus = unlisten; });
onUnmounted(() => {
  clearScheduledRefresh();
  unlistenFocus?.();
  leftResizeObserver?.disconnect();
  leftResizeObserver = null;
  document.removeEventListener('mousemove', onLeftPaneMouseMove);
  document.removeEventListener('mouseup', onLeftPaneMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  // 只有本实例真的拖过才落盘：拖拽途中被卸载时靠这里补上，
  // 而没动过的陈旧缓存实例不许覆盖用户最近一次拖动
  if (hasDraggedPanes) {
    persistLayoutNumber('git.changes.stagedRatio', stagedRatio.value);
    persistLeftPaneRatio();
  }
});

onActivated(enterActiveMode);
onDeactivated(enterColdStorage);

// Clear diff when switching tabs; history is loaded only when the tab is used
watch(activeTab, (tab) => {
  gitStore.clearDiff(props.project.id);
  if (tab === 'history' && activeProject.value && isViewActive.value) {
    scheduleRefresh({
      force: true,
      includeHistory: true,
      includeBranches: true,
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
  await gitStore.refreshRepositoryState(activeProject.value.id, activeProject.value.path, {
    includeHistory: activeTab.value === 'history',
    includeBranches: true,
  });
}

async function handleOpenFileHistory(file: string) {
  fileHistoryPath.value = file;
  activeTab.value = 'history';
  try {
    await gitStore.ensureFileHistory(activeProject.value.id, activeProject.value.path, file, { force: true });
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

function clearFileHistoryFilter() {
  fileHistoryPath.value = '';
  gitStore.clearDiff(props.project.id);
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
  gitStore.clearDiff(props.project.id);
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
  <div class="git-module">
    <!-- Not a git repo -->
    <div v-if="!isGitRepo" class="git-empty">
      <div class="i-mdi-source-branch git-empty-icon" />
      <p>{{ t('git.notGitRepo') }}</p>
      <button type="button" class="git-empty-action" @click="handleInitRepo">
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
        @open-repo-center="showRepoCenter = true"
        @refresh="handleRefresh"
      />

      <!-- Tab bar -->
      <div class="git-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          class="git-tab"
          :class="{ 'is-active': activeTab === tab.value }"
          @click="activeTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ===== CHANGES TAB: SourceTree-style layout ===== -->
      <div v-if="activeTab === 'changes'" class="git-changes-layout flex-1 flex flex-col min-h-0">
        <!-- Top area: status panel (left) + diff view (right) -->
        <div ref="leftPaneContainerRef" class="flex-1 flex min-h-0">
          <!-- Left: file status panel (staged top / unstaged bottom) -->
          <div
            class="git-side-panel flex flex-col shrink-0 min-w-0"
            :style="leftPaneStyle"
          >
            <div ref="statusPanelRef" class="flex-1 flex flex-col min-h-0 overflow-hidden">
              <GitStatusPanel
                :project="activeProject"
                :staged-ratio="stagedRatio"
                @staged-split-mousedown="onStagedSplitMouseDown"
                @open-file-history="handleOpenFileHistory"
              />
            </div>
          </div>

          <!-- Vertical drag handle: left ↔ right（持久化百分比） -->
          <div
            class="git-split-v"
            :class="{ 'is-dragging': isDraggingLeftPane }"
            @mousedown="onLeftPaneMouseDown"
          />

          <!-- Right: diff view -->
          <div class="flex-1 min-w-0">
            <GitDiffView :project="activeProject" />
          </div>
        </div>

        <!-- Horizontal drag handle: workspace ↔ commit -->
        <div
          class="git-split-h"
          :class="{ 'is-dragging': commitPane.isDragging.value }"
          @mousedown="commitPane.onMouseDown"
        />

        <!-- Bottom: commit area spanning full width -->
        <div class="shrink-0" :style="{ height: commitPane.size.value + 'px' }">
          <GitCommitArea :project="activeProject" class="h-full" />
        </div>
      </div>

      <!-- ===== HISTORY TAB: top-bottom layout ===== -->
      <div v-else class="git-history-layout flex-1 flex flex-col min-h-0">
        <!-- Top: commit list -->
        <div
          class="shrink-0 overflow-hidden"
          :class="selectedHistoryHash ? '' : 'flex-1'"
          :style="selectedHistoryHash ? { height: historyTopPane.size.value + 'px' } : undefined"
        >
          <GitHistory
            :project="activeProject"
            :file-path="fileHistoryPath || undefined"
            @clear-file-filter="clearFileHistoryFilter"
          />
        </div>

        <!-- Drag handle: history list ↕ detail workspace -->
        <div
          v-if="selectedHistoryHash"
          class="git-split-h"
          :class="{ 'is-dragging': historyTopPane.isDragging.value }"
          @mousedown="historyTopPane.onMouseDown"
        />

        <!-- Bottom: commit detail (info + files | diff) -->
        <div v-if="selectedHistoryHash" class="flex-1 flex min-h-0">
          <!-- Left: commit info + file list -->
          <div
            class="git-side-panel flex flex-col shrink-0 min-w-0"
            :style="{ width: historyLeftPane.size.value + 'px' }"
          >
            <!-- Commit info header -->
            <div
              v-if="selectedHistoryCommit"
              class="git-history-detail app-text-control px-3 py-2 shrink-0 space-y-2 overflow-auto select-text"
              :style="{ height: historyDetailPane.size.value + 'px' }"
            >
              <div class="flex items-center justify-between gap-2 pb-1 border-b border-[color:var(--git-border)]">
                <span class="git-history-detail-label">
                  {{ t('git.commitDetail') }}
                </span>
                <button
                  type="button"
                  class="git-history-detail-close"
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
                    class="app-text-control rounded px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors"
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
                  class="app-text-caption px-1.5 py-0 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium truncate max-w-26"
                >{{ ref }}</span>
              </div>
            </div>

            <!-- Drag handle: commit detail ↕ files -->
            <div
              class="git-split-h"
              :class="{ 'is-dragging': historyDetailPane.isDragging.value }"
              @mousedown="historyDetailPane.onMouseDown"
            />

            <!-- File list -->
            <div class="flex-1 min-h-0">
              <GitCommitFileList :project="activeProject" />
            </div>
          </div>

          <!-- Drag handle: left panel ↔ diff -->
          <div
            class="git-split-v"
            :class="{ 'is-dragging': historyLeftPane.isDragging.value }"
            @mousedown="historyLeftPane.onMouseDown"
          />

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
        @changed="handleRepositoryChanged"
      />

      <!-- 仓库中心：stash / tags / remotes / branches -->
      <GitRepoCenterDialog
        v-model="showRepoCenter"
        :project="activeProject"
        @open-branches="showBranchDialog = true"
      />
    </template>
  </div>
</template>
