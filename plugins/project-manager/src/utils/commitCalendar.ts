import type { GitOwnCommit } from '../types';

export interface CommitCalendarItem extends GitOwnCommit {
  projectId: string;
  projectName: string;
  projectPath: string;
}

export interface CommitCalendarDay {
  date: string;
  day: number;
  inCurrentMonth: boolean;
  items: CommitCalendarItem[];
}

/** 自然月范围（month 为 Date 的 0-based 月份） */
export interface MonthRange {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  title: string;
}

/** @deprecated 使用 MonthRange */
export type CurrentMonthRange = MonthRange;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 解析指定年月的自然月范围。
 * @param year 四位年
 * @param month 0-based 月（与 Date#getMonth 一致）
 */
export function resolveMonthRange(year: number, month: number): MonthRange {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);

  return {
    year: start.getFullYear(),
    month: start.getMonth(),
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    title: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`,
  };
}

/** 当前自然月范围 */
export function resolveCurrentMonthRange(now = new Date()): MonthRange {
  return resolveMonthRange(now.getFullYear(), now.getMonth());
}

/** 月份加减，返回规范化后的 year / month（0-based） */
export function shiftCalendarMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const cursor = new Date(year, month + delta, 1);
  return {
    year: cursor.getFullYear(),
    month: cursor.getMonth(),
  };
}

/**
 * 是否允许切到「下个月」。
 * 规则：下个月不得晚于 now 所在自然月（不能进入未来月）。
 */
export function canGoToNextCalendarMonth(
  year: number,
  month: number,
  now = new Date(),
): boolean {
  const next = shiftCalendarMonth(year, month, 1);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  if (next.year < currentYear) return true;
  if (next.year > currentYear) return false;
  return next.month <= currentMonth;
}

/** 当前查看月是否就是 now 所在自然月 */
export function isCurrentCalendarMonth(
  year: number,
  month: number,
  now = new Date(),
): boolean {
  return year === now.getFullYear() && month === now.getMonth();
}

export function groupCommitCalendarItemsByDate(
  items: CommitCalendarItem[],
  startDate: string,
  endDate: string,
): Record<string, CommitCalendarItem[]> {
  const grouped: Record<string, CommitCalendarItem[]> = {};

  for (const item of items) {
    const date = formatLocalDate(new Date(item.date));
    if (date < startDate || date >= endDate) continue;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(item);
  }

  for (const date of Object.keys(grouped)) {
    grouped[date].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  return grouped;
}

export function buildCommitCalendarDays(
  year: number,
  month: number,
  grouped: Record<string, CommitCalendarItem[]> = {},
): CommitCalendarDay[] {
  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(firstDay);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  gridStart.setDate(firstDay.getDate() - firstWeekday);

  const lastDay = new Date(year, month + 1, 0);
  const gridEnd = new Date(lastDay);
  const lastWeekday = (lastDay.getDay() + 6) % 7;
  gridEnd.setDate(lastDay.getDate() + (6 - lastWeekday));

  const days: CommitCalendarDay[] = [];
  const cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const date = formatLocalDate(cursor);
    days.push({
      date,
      day: cursor.getDate(),
      inCurrentMonth: cursor.getMonth() === month,
      items: grouped[date] || [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export function hasWeekendCommits(days: CommitCalendarDay[]): boolean {
  return days.some((day, index) => index % 7 >= 5 && day.items.length > 0);
}

export function formatCommitCalendarEntry(item: CommitCalendarItem): string {
  const date = new Date(item.date);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${item.projectName}：${item.message}（${time}）`;
}
