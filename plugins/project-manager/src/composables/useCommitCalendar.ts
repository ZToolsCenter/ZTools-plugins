import { computed, shallowRef } from 'vue';
import { api } from '../api/index.ts';
import { useProjectStore } from '../stores/project.ts';
import {
  buildCommitCalendarDays,
  canGoToNextCalendarMonth,
  groupCommitCalendarItemsByDate,
  isCurrentCalendarMonth,
  resolveCurrentMonthRange,
  resolveMonthRange,
  shiftCalendarMonth,
  type CommitCalendarDay,
  type CommitCalendarItem,
  type MonthRange,
} from '../utils/commitCalendar.ts';
import type { Project } from '../types.ts';

export interface CommitCalendarSkippedProject {
  projectId: string;
  projectName: string;
  reason: 'not_git' | 'identity_missing' | 'load_failed';
}

function normalizeSkipReason(error: unknown): CommitCalendarSkippedProject['reason'] {
  const message = String(error || '').toLowerCase();
  if (message.includes('identity') || message.includes('user.name') || message.includes('user.email')) {
    return 'identity_missing';
  }
  return 'load_failed';
}

export function useCommitCalendar() {
  const projectStore = useProjectStore();
  const loading = shallowRef(false);
  const loaded = shallowRef(false);
  const items = shallowRef<CommitCalendarItem[]>([]);
  const skippedProjects = shallowRef<CommitCalendarSkippedProject[]>([]);
  /** 当前查看的月份范围（默认为本月，可切换到历史月） */
  const range = shallowRef<MonthRange>(resolveCurrentMonthRange());

  const groupedItems = computed(() =>
    groupCommitCalendarItemsByDate(items.value, range.value.startDate, range.value.endDate)
  );

  const calendarDays = computed<CommitCalendarDay[]>(() =>
    buildCommitCalendarDays(range.value.year, range.value.month, groupedItems.value)
  );

  const totalCommits = computed(() => items.value.length);

  /** 下月按钮：仅当下一月不晚于「今天所在月」时可点 */
  const canGoNextMonth = computed(() =>
    canGoToNextCalendarMonth(range.value.year, range.value.month)
  );

  const isViewingCurrentMonth = computed(() =>
    isCurrentCalendarMonth(range.value.year, range.value.month)
  );

  /***********************跨项目提交加载*********************/

  async function loadProjectCommits(
    project: Project,
    monthRange: MonthRange,
  ): Promise<CommitCalendarItem[]> {
    let isGitRepo = false;
    try {
      isGitRepo = await api.gitCheck(project.path);
    } catch {
      skippedProjects.value = [
        ...skippedProjects.value,
        { projectId: project.id, projectName: project.name, reason: 'not_git' },
      ];
      return [];
    }

    if (!isGitRepo) {
      skippedProjects.value = [
        ...skippedProjects.value,
        { projectId: project.id, projectName: project.name, reason: 'not_git' },
      ];
      return [];
    }

    try {
      const result = await api.gitOwnCommits(
        project.path,
        monthRange.startDate,
        monthRange.endDate,
      );
      return result.commits.map(commit => ({
        ...commit,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
      }));
    } catch (error) {
      skippedProjects.value = [
        ...skippedProjects.value,
        { projectId: project.id, projectName: project.name, reason: normalizeSkipReason(error) },
      ];
      return [];
    }
  }

  /**
   * 按指定月份拉取数据。不传则刷新当前 range。
   * 注意：不会自动跳回「本月」，便于在历史月点刷新。
   */
  async function refresh(target?: { year: number; month: number }): Promise<void> {
    loading.value = true;
    skippedProjects.value = [];

    if (target) {
      range.value = resolveMonthRange(target.year, target.month);
    }

    const monthRange = range.value;

    try {
      const results = await Promise.all(
        projectStore.projects.map(project => loadProjectCommits(project, monthRange)),
      );
      items.value = results
        .flat()
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  /***********************月份切换*********************/

  async function goPrevMonth(): Promise<void> {
    if (loading.value) return;
    const prev = shiftCalendarMonth(range.value.year, range.value.month, -1);
    await refresh(prev);
  }

  async function goNextMonth(): Promise<void> {
    if (loading.value || !canGoNextMonth.value) return;
    const next = shiftCalendarMonth(range.value.year, range.value.month, 1);
    // 双保险：目标月若已超过当前自然月则忽略
    if (!canGoToNextCalendarMonth(range.value.year, range.value.month)) return;
    await refresh(next);
  }

  /** 一键回到本月 */
  async function goCurrentMonth(): Promise<void> {
    if (loading.value) return;
    if (isViewingCurrentMonth.value) {
      await refresh();
      return;
    }
    const current = resolveCurrentMonthRange();
    await refresh({ year: current.year, month: current.month });
  }

  return {
    loading,
    loaded,
    range,
    items,
    skippedProjects,
    calendarDays,
    totalCommits,
    canGoNextMonth,
    isViewingCurrentMonth,
    refresh,
    goPrevMonth,
    goNextMonth,
    goCurrentMonth,
  };
}
