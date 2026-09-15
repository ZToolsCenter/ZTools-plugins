<script setup lang="ts">
import { computed, onActivated, onMounted, ref, shallowRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { useCommitCalendar } from '../composables/useCommitCalendar';
import { formatCommitCalendarEntry, hasWeekendCommits } from '../utils/commitCalendar';
import type { CommitCalendarItem } from '../utils/commitCalendar';

const { t, locale } = useI18n();

/***********************提交日历数据*********************/

const {
  loading,
  loaded,
  range,
  skippedProjects,
  calendarDays,
  totalCommits,
  canGoNextMonth,
  isViewingCurrentMonth,
  refresh,
  goPrevMonth,
  goNextMonth,
  goCurrentMonth,
} = useCommitCalendar();

const weekdays = computed(() => {
  if (locale.value.startsWith('zh')) {
    return ['一', '二', '三', '四', '五', '六', '日'];
  }
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
});

const skippedSummary = computed(() => {
  if (skippedProjects.value.length === 0) return '';
  return t('commitCalendar.skippedSummary', { count: skippedProjects.value.length });
});
const skippedExpanded = ref(false);
const SKIPPED_PREVIEW_LIMIT = 8;
const visibleSkippedProjects = computed(() => (
  skippedExpanded.value ? skippedProjects.value : skippedProjects.value.slice(0, SKIPPED_PREVIEW_LIMIT)
));
const hiddenSkippedCount = computed(() => Math.max(0, skippedProjects.value.length - visibleSkippedProjects.value.length));
watch(skippedProjects, () => { skippedExpanded.value = false; });

const shouldCompressWeekend = computed(() => !hasWeekendCommits(calendarDays.value));

const calendarGridColumns = computed(() => (
  shouldCompressWeekend.value
    ? 'repeat(5, minmax(160px, 1fr)) 56px 56px'
    : 'repeat(7, minmax(0, 1fr))'
));

const calendarGridStyle = computed(() => {
  const weekCount = Math.max(1, Math.ceil(calendarDays.value.length / 7));
  const minRowHeight = 112;
  return {
    gridTemplateColumns: calendarGridColumns.value,
    gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`,
    minHeight: `${weekCount * minRowHeight}px`,
  };
});

function getSkipReasonText(reason: string): string {
  return t(`commitCalendar.skipReasons.${reason}`);
}

function formatCommitTime(date: string): string {
  return new Date(date).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatCommitDateTime(date: string): string {
  return new Date(date).toLocaleString('zh-CN', { hour12: false });
}

/***********************提交详情与复制*********************/

const selectedCommit = shallowRef<CommitCalendarItem | null>(null);
const selectedCommitDetailMessage = shallowRef('');
const detailLoading = shallowRef(false);
let detailRequestId = 0;

const detailVisible = computed({
  get: () => selectedCommit.value !== null,
  set: (value: boolean) => {
    if (!value) {
      detailRequestId += 1;
      selectedCommit.value = null;
      selectedCommitDetailMessage.value = '';
      detailLoading.value = false;
    }
  },
});

const selectedCommitMessageText = computed(() => {
  if (!selectedCommit.value) return '';
  return selectedCommitDetailMessage.value || selectedCommit.value.message;
});

function openCommitDetail(item: CommitCalendarItem): void {
  selectedCommit.value = item;
  selectedCommitDetailMessage.value = '';
  void loadCommitDetail(item);
}

async function loadCommitDetail(item: CommitCalendarItem): Promise<void> {
  const requestId = detailRequestId + 1;
  detailRequestId = requestId;
  detailLoading.value = true;

  try {
    const detail = await api.gitCommitDetail(item.projectPath, item.hash);
    if (detailRequestId === requestId && selectedCommit.value?.hash === item.hash) {
      selectedCommitDetailMessage.value = detail.message;
    }
  } catch (error) {
    if (detailRequestId === requestId) {
      ElMessage.error(t('commitCalendar.loadDetailFailed', { error: String(error) }));
    }
  } finally {
    if (detailRequestId === requestId) {
      detailLoading.value = false;
    }
  }
}

async function copySelectedCommit(): Promise<void> {
  if (!selectedCommitMessageText.value) return;
  try {
    await navigator.clipboard.writeText(selectedCommitMessageText.value);
    ElMessage.success(t('commitCalendar.copySuccess'));
  } catch (error) {
    ElMessage.error(t('commitCalendar.copyFailed', { error: String(error) }));
  }
}

/***********************生命周期加载*********************/

function refreshIfNeeded(): void {
  if (!loaded.value && !loading.value) {
    void refresh();
  }
}

onMounted(refreshIfNeeded);
onActivated(refreshIfNeeded);
</script>

<template>
  <div class="app-page">
    <div class="app-page-header">
      <div class="app-content-container">
      <div class="app-page-header-main">
        <div class="app-page-heading">
          <div class="flex items-center gap-2">
            <div class="i-mdi-calendar-month text-xl text-blue-500" />
            <h2 class="app-page-title !mt-0">
              {{ t('commitCalendar.title') }}
            </h2>
          </div>
          <p class="app-page-description">
            {{ t('commitCalendar.subtitle', { month: range.title, count: totalCommits }) }}
          </p>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <!-- 月份切换：仅允许当前月及之前 -->
          <div class="commit-calendar-month-nav flex items-center gap-0.5 rounded-md border border-slate-200/70 dark:border-slate-700/50 bg-white/60 dark:bg-slate-900/40 p-0.5">
            <button
              type="button"
              class="month-nav-btn"
              :disabled="loading"
              :title="t('commitCalendar.prevMonth')"
              @click="goPrevMonth"
            >
              <div class="i-mdi-chevron-left text-base" />
            </button>
            <span class="app-text-control min-w-18 px-1 text-center font-semibold tabular-nums text-slate-700 dark:text-slate-200">
              {{ range.title }}
            </span>
            <button
              type="button"
              class="month-nav-btn"
              :disabled="loading || !canGoNextMonth"
              :title="canGoNextMonth ? t('commitCalendar.nextMonth') : t('commitCalendar.nextMonthDisabled')"
              @click="goNextMonth"
            >
              <div class="i-mdi-chevron-right text-base" />
            </button>
          </div>

          <button
            v-if="!isViewingCurrentMonth"
            type="button"
            class="month-current-btn"
            :disabled="loading"
            :title="t('commitCalendar.backToCurrentMonth')"
            @click="goCurrentMonth"
          >
            <span>{{ t('commitCalendar.thisMonth') }}</span>
          </button>

          <button
            class="app-primary-action !min-h-8 !rounded-md !px-3 !py-1.5"
            :disabled="loading"
            @click="refresh()"
          >
            <div class="i-mdi-refresh text-sm" :class="{ 'animate-spin': loading }" />
            <span>{{ t('common.refresh') }}</span>
          </button>
        </div>
      </div>

      <div
        v-if="skippedSummary"
        class="app-alert-warning app-page-header-extra app-text-control px-3 py-2"
      >
        <div class="font-medium">{{ skippedSummary }}</div>
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 overflow-hidden">
          <span v-for="project in visibleSkippedProjects" :key="project.projectId" class="max-w-56 truncate" :title="`${project.projectName}：${getSkipReasonText(project.reason)}`">
            {{ project.projectName }}：{{ getSkipReasonText(project.reason) }}
          </span>
        </div>
        <button
          v-if="skippedProjects.length > SKIPPED_PREVIEW_LIMIT"
          type="button"
          class="app-text-control mt-2 font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
          :aria-expanded="skippedExpanded"
          @click="skippedExpanded = !skippedExpanded"
        >
          {{ skippedExpanded ? t('commitCalendar.collapseSkipped') : t('commitCalendar.expandSkipped', { count: hiddenSkippedCount }) }}
        </button>
      </div>
      </div>
    </div>

    <div
      class="app-card-soft shrink-0 grid !rounded-none border-x-0 border-t-0"
      :style="{ gridTemplateColumns: calendarGridColumns }"
    >
      <div
        v-for="day in weekdays"
        :key="day"
        class="h-8 flex items-center justify-center app-text-meta font-semibold text-slate-500 dark:text-slate-400"
      >
        {{ day }}
      </div>
    </div>

    <div v-if="loading && !loaded" class="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
      <div class="i-mdi-loading animate-spin text-xl mr-2" />
      {{ t('common.loading') }}
    </div>

    <div v-else class="relative flex-1 min-h-0 overflow-auto">
      <div
        class="commit-calendar-grid grid gap-px p-px"
        :style="calendarGridStyle"
      >
        <div
          v-for="day in calendarDays"
          :key="day.date"
          class="flex min-w-0 flex-col overflow-hidden p-2"
          :class="day.inCurrentMonth ? 'commit-day-current' : 'commit-day-muted'"
        >
          <div class="flex items-center justify-between gap-2">
            <span
              class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 app-text-caption font-semibold"
              :class="day.inCurrentMonth ? 'text-slate-600 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600'"
            >
              {{ day.day }}
            </span>
            <span
              v-if="day.items.length > 0"
              class="shrink-0 rounded-full bg-blue-500/10 px-1.5 py-0.5 app-text-caption font-semibold text-blue-600 dark:text-blue-300"
            >
              {{ day.items.length }}
            </span>
          </div>

          <div class="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 commit-day-scroll">
            <button
              v-for="item in day.items"
              :key="item.projectId + item.hash"
              type="button"
              class="commit-entry-btn"
              :title="formatCommitCalendarEntry(item)"
              @click="openCommitDetail(item)"
            >
              <span class="commit-entry-project">{{ item.projectName }}</span>
              <span class="commit-entry-message">{{ item.message }}</span>
              <span class="commit-entry-time">（{{ formatCommitTime(item.date) }}）</span>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="loaded && totalCommits === 0"
        class="pointer-events-none absolute inset-0 flex items-center justify-center text-center"
      >
        <div class="app-card px-5 py-4">
          <div class="i-mdi-calendar-blank-outline text-3xl mx-auto mb-2 text-slate-300 dark:text-slate-600" />
          <div class="text-sm font-medium text-slate-500 dark:text-slate-300">{{ t('commitCalendar.empty') }}</div>
          <div class="app-text-meta mt-1 text-slate-400 dark:text-slate-500">{{ t('commitCalendar.emptyHint') }}</div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="detailVisible"
      :title="t('commitCalendar.detailTitle')"
      width="560px"
      append-to-body
      align-center
      class="commit-calendar-dialog"
    >
      <div v-if="selectedCommit" class="app-text-body space-y-3 text-slate-600 dark:text-slate-300">
        <div class="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2">
          <span class="app-text-meta text-slate-400 dark:text-slate-500">{{ t('commitCalendar.project') }}</span>
          <span class="font-medium text-slate-700 dark:text-slate-100">{{ selectedCommit.projectName }}</span>
          <span class="app-text-meta text-slate-400 dark:text-slate-500">{{ t('commitCalendar.time') }}</span>
          <span>{{ formatCommitDateTime(selectedCommit.date) }}</span>
          <span class="app-text-meta text-slate-400 dark:text-slate-500">{{ t('git.hash') }}</span>
          <span class="font-mono">{{ selectedCommit.shortHash }}</span>
        </div>

        <div>
          <div class="app-text-meta mb-1 text-slate-400 dark:text-slate-500">{{ t('git.commitMessage') }}</div>
          <div
            v-if="detailLoading"
            class="app-code-block app-text-code flex min-h-24 items-center justify-center"
          >
            <div class="i-mdi-loading animate-spin mr-1.5" />
            {{ t('common.loading') }}
          </div>
          <pre v-else class="app-code-block app-text-code m-0 max-h-60 overflow-auto whitespace-pre-wrap px-3 py-2">{{ selectedCommitMessageText }}</pre>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="detailVisible = false">{{ t('common.close') }}</el-button>
          <el-button type="primary" :loading="detailLoading" @click="copySelectedCommit">
            {{ t('commitCalendar.copy') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.month-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--app-text-secondary, #64748b);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.month-nav-btn:hover:not(:disabled) {
  background: var(--app-primary-soft, #dbeafe);
  color: var(--app-primary, #2563eb);
}

.month-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.month-current-btn {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--app-border, #e2e8f0);
  background: var(--app-surface-soft, #f8fafc);
  color: var(--app-text-secondary, #475569);
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  cursor: pointer;
}

.month-current-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--app-primary, #2563eb) 30%, transparent);
  color: var(--app-primary, #2563eb);
  background: var(--app-primary-soft, #dbeafe);
}

.month-current-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.commit-calendar-grid {
  height: 100%;
  background: var(--app-border);
}

.commit-day-current {
  background: var(--app-surface);
}

.commit-day-muted {
  background: var(--app-surface-soft);
  color: var(--app-text-muted);
}

.commit-entry-btn {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  padding: 2px 4px;
  text-align: left;
  font-size: var(--app-font-control);
  line-height: 18px;
  color: var(--app-text-secondary);
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease);
}

.commit-entry-btn:hover {
  background: var(--app-primary-soft);
  color: var(--app-primary);
}

.commit-entry-project {
  max-width: 36%;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.commit-entry-message {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-entry-time {
  flex: 0 0 auto;
  color: var(--app-text-muted);
}

.commit-day-scroll::-webkit-scrollbar {
  width: 4px;
}

.commit-day-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-text-muted) 56%, transparent);
  border-radius: 999px;
}
</style>
