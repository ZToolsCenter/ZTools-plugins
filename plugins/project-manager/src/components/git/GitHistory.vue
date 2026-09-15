<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted, onMounted } from 'vue';
import { useGitStore } from '../../stores/git';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Project, GitCommit } from '../../types';
import { showPersistentGitError } from './message';
import { clampContextMenuPosition } from '../../utils/contextMenuPosition';

const props = defineProps<{
  project: Project;
  filePath?: string;
}>();

const emit = defineEmits<{
  'clear-file-filter': [];
}>();

const { t } = useI18n();
const gitStore = useGitStore();
const settingsStore = useSettingsStore();
const filePath = computed(() => props.filePath || '');

const selectedHash = computed(() => gitStore.selectedCommitHash[props.project.id] || '');
const allCommits = computed(() => props.filePath
  ? gitStore.getFileHistory(props.project.id, props.filePath)
  : (gitStore.history[props.project.id] || []));
const headerRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const loadingMore = ref(false);
const hasMore = ref(true);
const requestedCount = ref(100);

/***********************筛选*********************/
const searchQuery = ref('');
const commits = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return allCommits.value;
  return allCommits.value.filter((c) => {
    const hay = `${c.hash} ${c.short_hash} ${c.message} ${c.author} ${c.email} ${c.refs.join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
});

/***********************右键菜单*********************/
const ctxMenu = ref<{ x: number; y: number; commit: GitCommit } | null>(null);
const ctxMenuRef = ref<HTMLElement | null>(null);
const ctxMenuStyle = ref({ left: '0px', top: '0px' });

function openContextMenu(e: MouseEvent, commit: GitCommit) {
  e.preventDefault();
  ctxMenu.value = { x: e.clientX, y: e.clientY, commit };
  void nextTick(updateContextMenuPosition);
}

function closeContextMenu() {
  ctxMenu.value = null;
}

function updateContextMenuPosition(): void {
  if (!ctxMenu.value || !ctxMenuRef.value) return;
  const position = clampContextMenuPosition(
    ctxMenu.value.x,
    ctxMenu.value.y,
    ctxMenuRef.value.offsetWidth || 190,
    ctxMenuRef.value.offsetHeight || 260,
    { width: window.innerWidth, height: window.innerHeight },
  );
  ctxMenuStyle.value = { left: `${position.left}px`, top: `${position.top}px` };
}

function isContextMenuElement(target: EventTarget | null): boolean {
  return target instanceof Node && Boolean(ctxMenuRef.value?.contains(target));
}

function closeOnDocumentMouseDown(event: MouseEvent): void {
  if (!isContextMenuElement(event.target)) closeContextMenu();
}

function closeOnViewportChange(): void {
  closeContextMenu();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && ctxMenu.value) {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
  }
}

onMounted(() => {
  document.addEventListener('mousedown', closeOnDocumentMouseDown, true);
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('wheel', closeOnViewportChange, true);
  document.addEventListener('scroll', closeOnViewportChange, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', closeOnViewportChange);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', closeOnDocumentMouseDown, true);
  document.removeEventListener('click', closeContextMenu);
  document.removeEventListener('wheel', closeOnViewportChange, true);
  document.removeEventListener('scroll', closeOnViewportChange, true);
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', closeOnViewportChange);
});

async function copyText(value: string, successKey: string) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(t(successKey));
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
  closeContextMenu();
}

async function createBranchFromCommit(commit: GitCommit) {
  closeContextMenu();
  try {
    const raw = await ElMessageBox.prompt(
      t('git.branchNamePlaceholder'),
      t('git.createBranch'),
      { inputPattern: /.+/, inputErrorMessage: t('git.branchNameInvalid') },
    );
    const name = String(raw ?? '').trim();
    if (!name) return;
    await gitStore.createAndSwitchBranch(props.project.id, props.project.path, name, commit.hash);
    ElMessage.success(t('git.createBranchSuccess', { name }));
  } catch (e: any) {
    if (e === 'cancel' || String(e).includes('cancel')) return;
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function cherryPickCommit(commit: GitCommit) {
  closeContextMenu();
  try {
    await gitStore.cherryPick(props.project.id, props.project.path, commit.hash);
    ElMessage.success(t('git.cherryPickSuccess'));
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function revertSelectedCommit(commit: GitCommit) {
  closeContextMenu();
  try {
    await ElMessageBox.confirm(t('git.revertCommitConfirm'), t('common.warning'), { type: 'warning' });
    await gitStore.revertCommit(props.project.id, props.project.path, commit.hash);
    ElMessage.success(t('git.revertCommitSuccess'));
  } catch (e: any) {
    if (e === 'cancel' || String(e).includes('cancel')) return;
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function resetToCommit(commit: GitCommit, mode: 'soft' | 'mixed' | 'hard') {
  closeContextMenu();
  try {
    if (mode === 'hard' || settingsStore.settings.gitConfirmDestructive !== false) {
      await ElMessageBox.confirm(
        t(mode === 'hard' ? 'git.resetHardConfirm' : 'git.resetConfirm', { hash: commit.short_hash, mode }),
        t('common.warning'),
        { type: 'warning' },
      );
    }
    await gitStore.resetTo(props.project.id, props.project.path, mode, commit.hash);
    ElMessage.success(t('git.resetSuccess'));
  } catch (e: any) {
    if (e === 'cancel' || String(e).includes('cancel')) return;
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

// Current branch name to prioritize as lane 0
const currentBranch = computed(() => {
  const s = gitStore.summary[props.project.id];
  return s?.branch || '';
});

// ─── Resizable columns ───────────────────────────────────────────────
const colWidths = ref([140, 400, 170, 260, 90]);
const MIN_COL = 60;
let colDragIdx = -1;
let colDragStartX = 0;
let colDragStartW = 0;

function onColMouseDown(idx: number, e: MouseEvent) {
  e.preventDefault();
  colDragIdx = idx;
  colDragStartX = e.clientX;
  colDragStartW = colWidths.value[idx];
  document.addEventListener('mousemove', onColMouseMove);
  document.addEventListener('mouseup', onColMouseUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}
function onColMouseMove(e: MouseEvent) {
  const delta = e.clientX - colDragStartX;
  colWidths.value[colDragIdx] = Math.max(MIN_COL, colDragStartW + delta);
}
function onColMouseUp() {
  colDragIdx = -1;
  document.removeEventListener('mousemove', onColMouseMove);
  document.removeEventListener('mouseup', onColMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}
onUnmounted(() => {
  document.removeEventListener('mousemove', onColMouseMove);
  document.removeEventListener('mouseup', onColMouseUp);
});

// ─── Horizontal scroll sync + scrollbar compensation ────────────────
function syncHeaderScroll() {
  if (!headerRef.value || !listRef.value) return;
  headerRef.value.scrollLeft = listRef.value.scrollLeft;
  // Compensate for vertical scrollbar width difference
  const scrollbarW = listRef.value.offsetWidth - listRef.value.clientWidth;
  headerRef.value.style.paddingRight = scrollbarW + 'px';
}

function onBodyScroll(e: Event) {
  syncHeaderScroll();
  const el = e.target as HTMLElement;
  // Auto load more when near bottom
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  if (nearBottom) {
    void loadMore();
  }
}

// ─── Commit actions ──────────────────────────────────────────────────

async function selectCommit(commit: GitCommit) {
  if (selectedHash.value === commit.hash) {
    return;
  }

  gitStore.selectedCommitHash[props.project.id] = commit.hash;
  gitStore.clearDiff(props.project.id);

  const tasks: Promise<unknown>[] = [];
  if (gitStore.getCommitFiles(props.project.id, commit.hash).length === 0) {
    tasks.push(gitStore.refreshCommitFiles(props.project.id, props.project.path, commit.hash));
  }
  if (!gitStore.getCommitDetail(props.project.id, commit.hash)) {
    tasks.push(gitStore.refreshCommitDetail(props.project.id, props.project.path, commit.hash));
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  // 有筛选时不靠滚动加载（前端过滤子集）
  if (searchQuery.value.trim()) return;
  loadingMore.value = true;
  const current = allCommits.value.length;
  const next = current + 100;
  requestedCount.value = next;
  if (props.filePath) {
    await gitStore.refreshFileHistory(props.project.id, props.project.path, props.filePath, next);
  } else {
    await gitStore.refreshHistory(props.project.id, props.project.path, next);
  }
  const latest = props.filePath
    ? gitStore.getFileHistory(props.project.id, props.filePath).length
    : (gitStore.history[props.project.id] || []).length;
  if (latest <= current || latest < next) {
    hasMore.value = false;
  }
  loadingMore.value = false;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return dateStr;
  }
}

function isMergeCommit(commit: GitCommit): boolean {
  return commit.parents.length > 1;
}

function isHeadCommit(commit: GitCommit): boolean {
  return commit.refs.some(r => r.startsWith('HEAD'));
}

function shortRefs(refs: string[]): string[] {
  return refs
    .map(r => r.replace('HEAD -> ', '').replace('origin/', ''))
    .filter(r => r && r !== 'HEAD');
}

// ─── SVG Lane-based graph ────────────────────────────────────────────
const LANE_WIDTH = 14;
const ROW_HEIGHT = 28;
const DOT_RADIUS = 4;

const lanePalette = [
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#f59e0b', // amber
  '#d946ef', // fuchsia
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
];

interface GraphRow {
  lane: number;
  color: string;
  activeLanes: number[];
  connections: Array<[number, number]>;
  laneColors: Map<number, string>;
}

const graphData = computed(() => {
  const cList = commits.value;
  if (!cList.length) return { rows: [] as GraphRow[], maxLane: 0, commitColorMap: new Map<string, string>() };

  const branch = currentBranch.value;
  const lanes: (string | null)[] = [];
  const laneColorMap = new Map<number, string>();
  let colorIdx = 0;
  const rows: GraphRow[] = [];
  let maxLane = 0;
  // Map: commit hash -> color (for ref badge coloring)
  const commitColorMap = new Map<string, string>();

  function nextColor(): string {
    return lanePalette[colorIdx++ % lanePalette.length];
  }

  function findLane(hash: string): number {
    return lanes.indexOf(hash);
  }

  function allocLane(): number {
    const idx = lanes.indexOf(null);
    if (idx >= 0) return idx;
    lanes.push(null);
    return lanes.length - 1;
  }

  // Pre-seed lane 0 for the current branch HEAD.
  // The first commit whose refs include the current branch name gets lane 0.
  if (branch) {
    for (const c of cList) {
      const isOnCurrentBranch = c.refs.some(r => {
        const clean = r.replace('HEAD -> ', '').trim();
        return clean === branch || clean === `origin/${branch}`;
      });
      if (isOnCurrentBranch) {
        lanes.push(c.hash); // lane 0
        laneColorMap.set(0, nextColor());
        break;
      }
    }
  }

  for (let i = 0; i < cList.length; i++) {
    const commit = cList[i];
    let myLane = findLane(commit.hash);

    if (myLane < 0) {
      myLane = allocLane();
      lanes[myLane] = commit.hash;
      laneColorMap.set(myLane, nextColor());
    }

    const myColor = laneColorMap.get(myLane) || nextColor();
    commitColorMap.set(commit.hash, myColor);

    const activeLanes: number[] = [];
    const rowLaneColors = new Map<number, string>();
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] !== null) {
        activeLanes.push(l);
        rowLaneColors.set(l, laneColorMap.get(l) || myColor);
      }
    }

    const connections: Array<[number, number]> = [];
    lanes[myLane] = null;

    const parents = commit.parents;
    if (parents.length > 0) {
      const p0Lane = findLane(parents[0]);
      if (p0Lane >= 0) {
        connections.push([myLane, p0Lane]);
      } else {
        lanes[myLane] = parents[0];
        laneColorMap.set(myLane, myColor);
      }

      for (let p = 1; p < parents.length; p++) {
        const existingLane = findLane(parents[p]);
        if (existingLane >= 0) {
          connections.push([myLane, existingLane]);
        } else {
          const newLane = allocLane();
          lanes[newLane] = parents[p];
          laneColorMap.set(newLane, nextColor());
          connections.push([myLane, newLane]);
        }
      }
    }

    if (myLane > maxLane) maxLane = myLane;
    for (const l of activeLanes) {
      if (l > maxLane) maxLane = l;
    }

    rows.push({ lane: myLane, color: myColor, activeLanes, connections, laneColors: rowLaneColors });
  }

  return { rows, maxLane, commitColorMap };
});

const graphSvgWidth = computed(() => {
  return (graphData.value.maxLane + 1) * LANE_WIDTH + 10;
});

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
}

// Get the color for a ref badge based on the commit's lane color
function refColor(rowIdx: number): string {
  const row = graphData.value.rows[rowIdx];
  return row ? row.color : '#3b82f6';
}

// Minimum content width to avoid column collapse
const minRowWidth = computed(() => {
  return colWidths.value[0] + colWidths.value[1] + colWidths.value[2] + colWidths.value[3] + colWidths.value[4];
});

// 注：原先这里有一个 watch(() => props.project.id) 在切项目时清提交选中态与 diff。
// GitView 已改为 props 驱动、且外层 `:key` 含项目 id，所以 props.project.id
// 在实例生命周期内恒定，该 watcher 永不触发。更重要的是它**有害**：
// 缓存实例跟着全局值一起变时，它清掉的是新项目的 selectedCommitHash。故整段删除。

watch(allCommits, (newCommits, oldCommits) => {
  if (newCommits.length < 100) {
    hasMore.value = false;
    return;
  }
  if (oldCommits.length === 0 && newCommits.length >= 100) {
    hasMore.value = true;
  }
});

watch(() => props.filePath, () => {
  hasMore.value = true;
  requestedCount.value = 100;
  searchQuery.value = '';
});
</script>

<template>
  <div class="git-history app-text-control">
    <!-- 搜索筛选 -->
    <div class="git-history-search">
      <div class="i-mdi-magnify text-sm opacity-60" />
      <input
        v-model="searchQuery"
        type="search"
        :placeholder="t('git.historySearchPlaceholder')"
      />
      <span v-if="searchQuery.trim()" class="app-text-meta shrink-0">
        {{ commits.length }}/{{ allCommits.length }}
      </span>
      <button
        v-if="filePath"
        type="button"
        class="git-history-file-filter"
        :title="t('git.clearFileHistoryFilter')"
        @click="emit('clear-file-filter')"
      >
        <span class="i-mdi-file-search-outline" />
        <span class="truncate max-w-[180px]">{{ filePath }}</span>
        <span class="i-mdi-close text-xs" />
      </button>
    </div>

    <!-- No commits -->
    <div v-if="allCommits.length === 0" class="git-empty">
      <div class="i-mdi-source-commit git-empty-icon" />
      <span>{{ t('git.noCommits') }}</span>
    </div>
    <div v-else-if="commits.length === 0" class="git-empty">
      <div class="i-mdi-filter-off-outline git-empty-icon" />
      <span>{{ t('git.historyFilterEmpty') }}</span>
    </div>

    <template v-else>
      <!-- Column header — syncs horizontal scroll with body -->
      <div ref="headerRef" class="git-history-header">
        <div
          class="git-history-header-row"
          :style="{ minWidth: minRowWidth + 'px' }"
        >
          <div class="git-history-col" :style="{ width: colWidths[0] + 'px' }">
            <span>图谱</span>
            <div class="git-history-col-resizer" @mousedown="onColMouseDown(0, $event)" />
          </div>
          <div class="git-history-col" :style="{ width: colWidths[1] + 'px' }">
            <span>描述</span>
            <div class="git-history-col-resizer" @mousedown="onColMouseDown(1, $event)" />
          </div>
          <div class="git-history-col" :style="{ width: colWidths[2] + 'px' }">
            <span>日期</span>
            <div class="git-history-col-resizer" @mousedown="onColMouseDown(2, $event)" />
          </div>
          <div class="git-history-col" :style="{ width: colWidths[3] + 'px' }">
            <span>作者</span>
            <div class="git-history-col-resizer" @mousedown="onColMouseDown(3, $event)" />
          </div>
          <div class="git-history-col" :style="{ width: colWidths[4] + 'px' }">
            <span>提交</span>
          </div>
        </div>
      </div>

      <!-- Commit list — scrolls both X and Y, header syncs X -->
      <div ref="listRef" class="git-history-list" @scroll="onBodyScroll">
        <div
          v-for="(commit, rowIdx) in commits"
          :key="commit.hash"
          class="git-commit-row"
          :class="{
            'is-active': selectedHash === commit.hash,
            'is-head': isHeadCommit(commit),
          }"
          :style="{ height: ROW_HEIGHT + 'px', minWidth: minRowWidth + 'px' }"
          @click="selectCommit(commit)"
          @contextmenu="openContextMenu($event, commit)"
        >
            <!-- Graph column -->
            <div class="shrink-0 overflow-hidden" :style="{ width: colWidths[0] + 'px', height: ROW_HEIGHT + 'px' }">
              <svg
                v-if="graphData.rows[rowIdx]"
                :width="Math.min(colWidths[0], graphSvgWidth)"
                :height="ROW_HEIGHT"
                class="block"
              >
                <line
                  v-for="activeLane in graphData.rows[rowIdx].activeLanes"
                  :key="'v' + activeLane"
                  :x1="laneX(activeLane)"
                  y1="0"
                  :x2="laneX(activeLane)"
                  :y2="ROW_HEIGHT"
                  :stroke="graphData.rows[rowIdx].laneColors.get(activeLane) || '#94a3b8'"
                  stroke-width="2"
                  stroke-opacity="0.6"
                />
                <line
                  v-for="(conn, ci) in graphData.rows[rowIdx].connections"
                  :key="'c' + ci"
                  :x1="laneX(conn[0])"
                  :y1="ROW_HEIGHT / 2"
                  :x2="laneX(conn[1])"
                  :y2="ROW_HEIGHT"
                  :stroke="graphData.rows[rowIdx].color"
                  stroke-width="2"
                  stroke-opacity="0.7"
                />
                <circle
                  :cx="laneX(graphData.rows[rowIdx].lane)"
                  :cy="ROW_HEIGHT / 2"
                  :r="DOT_RADIUS"
                  :fill="isHeadCommit(commit) ? 'white' : graphData.rows[rowIdx].color"
                  :stroke="graphData.rows[rowIdx].color"
                  :stroke-width="isHeadCommit(commit) ? 2.5 : 1.5"
                />
              </svg>
            </div>

            <div class="shrink-0 flex items-center gap-1.5 overflow-hidden px-2 box-border" :style="{ width: colWidths[1] + 'px' }">
              <span class="git-commit-msg">{{ commit.message }}</span>
              <span
                v-if="isMergeCommit(commit)"
                class="git-ref-badge"
                :style="{ backgroundColor: refColor(rowIdx) + '18', color: refColor(rowIdx) }"
              >merge</span>
              <span
                v-for="ref in shortRefs(commit.refs).slice(0, 2)"
                :key="ref"
                class="git-ref-badge"
                :style="{ backgroundColor: refColor(rowIdx) + '18', color: refColor(rowIdx) }"
              >{{ ref }}</span>
            </div>

            <div class="git-history-meta shrink-0" :style="{ width: colWidths[2] + 'px' }">
              {{ formatDate(commit.date) }}
            </div>

            <div class="git-history-meta shrink-0" :style="{ width: colWidths[3] + 'px' }">
              {{ commit.author }} &lt;{{ commit.email }}&gt;
            </div>

            <div class="git-history-meta git-history-hash shrink-0" :style="{ width: colWidths[4] + 'px' }">
              {{ commit.short_hash }}
            </div>
        </div>
      </div>

      <!-- Auto-loading indicator -->
      <div v-if="loadingMore" class="px-3 py-1.5 shrink-0 text-center app-text-meta text-slate-400 dark:text-slate-500">
        加载中...
      </div>
    </template>

    <!-- 提交右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="git-history-ctx app-text-control fixed z-50 min-w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1"
        ref="ctxMenuRef"
        :style="ctxMenuStyle"
        @mousedown.stop
        @click.stop
      >
        <button type="button" class="ctx-item" @click="copyText(ctxMenu.commit.hash, 'git.copyHashSuccess')">
          <span>{{ t('git.copyHash') }}</span>
        </button>
        <button type="button" class="ctx-item" @click="copyText(ctxMenu.commit.message, 'git.copyCommitMessageSuccess')">
          <span>{{ t('git.copyCommitMessage') }}</span>
        </button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="createBranchFromCommit(ctxMenu.commit)">
          <span>{{ t('git.createBranch') }}</span>
        </button>
        <button type="button" class="ctx-item" @click="cherryPickCommit(ctxMenu.commit)">
          <span>{{ t('git.cherryPick') }}</span>
        </button>
        <button type="button" class="ctx-item" @click="revertSelectedCommit(ctxMenu.commit)">
          <span>{{ t('git.revertCommit') }}</span>
        </button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="resetToCommit(ctxMenu.commit, 'soft')">
          <span>{{ t('git.resetSoft') }}</span>
        </button>
        <button type="button" class="ctx-item" @click="resetToCommit(ctxMenu.commit, 'mixed')">
          <span>{{ t('git.resetMixed') }}</span>
        </button>
        <button type="button" class="ctx-item danger" @click="resetToCommit(ctxMenu.commit, 'hard')">
          <span>{{ t('git.resetHard') }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  text-align: left;
  border: none;
  background: transparent;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--app-text-secondary, #475569);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.git-history-ctx {
  width: max-content;
  min-width: 220px;
  max-width: min(320px, calc(100vw - 16px));
  overflow: hidden;
}
.ctx-item > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-item:hover {
  background: var(--app-primary-soft, #dbeafe);
  color: var(--app-primary, #2563eb);
}
.ctx-item.danger:hover {
  background: color-mix(in srgb, var(--app-danger, #dc2626) 12%, transparent);
  color: var(--app-danger, #dc2626);
}
.ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--app-border, #e2e8f0);
}
</style>
