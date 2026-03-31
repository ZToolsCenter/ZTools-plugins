<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import type { Project, GitCommit } from '../../types';

const props = defineProps<{
  project: Project;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

const selectedHash = computed(() => gitStore.selectedCommitHash[props.project.id] || '');
const commits = computed(() => gitStore.history[props.project.id] || []);
const headerRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const loadingMore = ref(false);
const hasMore = ref(true);
const requestedCount = ref(100);

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
  gitStore.selectedCommitHash[props.project.id] = commit.hash;
  gitStore.clearDiff();
  await gitStore.refreshCommitFiles(props.project.id, props.project.path, commit.hash);
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  const current = commits.value.length;
  const next = current + 100;
  requestedCount.value = next;
  await gitStore.refreshHistory(props.project.id, props.project.path, next);
  const latest = (gitStore.history[props.project.id] || []).length;
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

// Clear selection on project change
watch(() => props.project.id, () => {
  gitStore.selectedCommitHash[props.project.id] = '';
  gitStore.clearDiff();
  hasMore.value = true;
  requestedCount.value = 100;
});

watch(commits, (newCommits, oldCommits) => {
  if (newCommits.length < 100) {
    hasMore.value = false;
    return;
  }
  if (oldCommits.length === 0 && newCommits.length >= 100) {
    hasMore.value = true;
  }
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden text-[11px]">
    <!-- No commits -->
    <div v-if="commits.length === 0" class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1 p-4">
      <div class="i-mdi-source-commit text-2xl" />
      <span>{{ t('git.noCommits') }}</span>
    </div>

    <template v-else>
      <!-- Column header — syncs horizontal scroll with body -->
      <div
        ref="headerRef"
        class="shrink-0 overflow-hidden border-b border-slate-300 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-800/50"
      >
        <div
          class="flex items-center text-[10px] font-medium text-slate-500 dark:text-slate-400 select-none h-6"
          :style="{ minWidth: minRowWidth + 'px' }"
        >
          <div class="shrink-0 flex items-center relative border-r border-slate-200 dark:border-slate-700" :style="{ width: colWidths[0] + 'px' }">
            <span class="px-2 truncate">图谱</span>
            <div class="absolute right-0 top-0 h-full w-2 -mr-1 cursor-col-resize hover:bg-blue-400/30 z-10" @mousedown="onColMouseDown(0, $event)" />
          </div>
          <div class="shrink-0 flex items-center relative border-r border-slate-200 dark:border-slate-700" :style="{ width: colWidths[1] + 'px' }">
            <span class="px-2 truncate">描述</span>
            <div class="absolute right-0 top-0 h-full w-2 -mr-1 cursor-col-resize hover:bg-blue-400/30 z-10" @mousedown="onColMouseDown(1, $event)" />
          </div>
          <div class="shrink-0 flex items-center relative border-r border-slate-200 dark:border-slate-700" :style="{ width: colWidths[2] + 'px' }">
            <span class="px-2 truncate">日期</span>
            <div class="absolute right-0 top-0 h-full w-2 -mr-1 cursor-col-resize hover:bg-blue-400/30 z-10" @mousedown="onColMouseDown(2, $event)" />
          </div>
          <div class="shrink-0 flex items-center relative border-r border-slate-200 dark:border-slate-700" :style="{ width: colWidths[3] + 'px' }">
            <span class="px-2 truncate">作者</span>
            <div class="absolute right-0 top-0 h-full w-2 -mr-1 cursor-col-resize hover:bg-blue-400/30 z-10" @mousedown="onColMouseDown(3, $event)" />
          </div>
          <div class="shrink-0 flex items-center" :style="{ width: colWidths[4] + 'px' }">
            <span class="px-2 truncate">提交</span>
          </div>
        </div>
      </div>

      <!-- Commit list — scrolls both X and Y, header syncs X -->
      <div ref="listRef" class="flex-1 overflow-auto" @scroll="onBodyScroll">
        <div
          v-for="(commit, rowIdx) in commits"
          :key="commit.hash"
          @click="selectCommit(commit)"
          class="flex items-center cursor-pointer border-b border-slate-200/20 dark:border-slate-700/15 transition-colors"
          :style="{ height: ROW_HEIGHT + 'px', minWidth: minRowWidth + 'px' }"
          :class="[
            selectedHash === commit.hash ? 'bg-blue-500/8' : 'hover:bg-slate-100/50 dark:hover:bg-slate-800/20',
            isHeadCommit(commit) ? 'font-bold' : '',
          ]"
        >
          <!-- Graph column -->
          <div class="shrink-0 overflow-hidden" :style="{ width: colWidths[0] + 'px', height: ROW_HEIGHT + 'px' }">
            <svg
              v-if="graphData.rows[rowIdx]"
              :width="Math.min(colWidths[0], graphSvgWidth)"
              :height="ROW_HEIGHT"
              class="block"
            >
              <!-- Vertical lane lines (pass-through) -->
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
              <!-- Merge/branch connection lines -->
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
              <!-- Commit dot -->
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

          <!-- Description column -->
          <div class="shrink-0 flex items-center gap-1.5 overflow-hidden px-2 box-border" :style="{ width: colWidths[1] + 'px' }">
            <span class="truncate" :class="isHeadCommit(commit) ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'">{{ commit.message }}</span>
            <span
              v-if="isMergeCommit(commit)"
              class="text-[9px] px-1.5 py-0 rounded-full font-medium shrink-0"
              :style="{ backgroundColor: refColor(rowIdx) + '18', color: refColor(rowIdx) }"
            >merge</span>
            <span
              v-for="ref in shortRefs(commit.refs).slice(0, 2)"
              :key="ref"
              class="text-[9px] px-1.5 py-0 rounded-full font-medium shrink-0 truncate max-w-24"
              :style="{ backgroundColor: refColor(rowIdx) + '18', color: refColor(rowIdx) }"
            >{{ ref }}</span>
          </div>

          <!-- Date column -->
          <div class="shrink-0 px-2 truncate box-border" :class="isHeadCommit(commit) ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'" :style="{ width: colWidths[2] + 'px' }">
            {{ formatDate(commit.date) }}
          </div>

          <!-- Author column -->
          <div class="shrink-0 px-2 truncate box-border" :class="isHeadCommit(commit) ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'" :style="{ width: colWidths[3] + 'px' }">
            {{ commit.author }} &lt;{{ commit.email }}&gt;
          </div>

          <!-- Hash column -->
          <div class="shrink-0 px-2 font-mono truncate box-border" :class="isHeadCommit(commit) ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'" :style="{ width: colWidths[4] + 'px' }">
            {{ commit.short_hash }}
          </div>
        </div>
      </div>

      <!-- Auto-loading indicator -->
      <div v-if="loadingMore" class="px-3 py-1.5 shrink-0 text-center text-[10px] text-slate-400 dark:text-slate-500">
        加载中...
      </div>
    </template>
  </div>
</template>
