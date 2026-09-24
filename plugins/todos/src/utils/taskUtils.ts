/**
 * 任务操作工具函数
 */

import { Task, TaskStatus, Priority } from '../types';
import { formatDate, isOverdue, generateId } from './dateUtils';

/**
 * 创建新任务
 * @param title 任务标题
 * @param description 任务描述（可选）
 * @returns 新创建的任务对象
 */
export function createTask(title: string, description?: string): Task {
  const now = formatDate(new Date());
  return {
    id: generateId(),
    title,
    description,
    priority: 'medium',
    dates: [],
    status: 'todo',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取任务状态（根据日期判断是否逾期）
 * @param task 任务对象
 * @returns 任务状态
 */
export function getTaskStatus(task: Task): TaskStatus {
  if (task.status === 'done') {
    return 'done';
  }

  if (task.dates.length === 0) {
    return 'todo';
  }

  const lastDate = [...task.dates].sort().pop();
  if (lastDate && isOverdue(lastDate)) {
    return 'overdue';
  }

  return 'todo';
}

/**
 * 格式化任务日期列表（智能合并连续日期）
 * @param dates 日期数组（YYYY-MM-DD 格式）
 * @returns 格式化后的日期字符串
 */
export function formatTaskDates(dates: string[]): string {
  if (dates.length === 0) {
    return '';
  }

  const sorted = [...dates].sort();
  const groups: string[][] = [];
  let currentGroup: string[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(sorted[i - 1]);
    const currDate = new Date(sorted[i]);
    const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  return groups
    .map(group => {
      if (group.length === 1) {
        return formatSingleDate(group[0]);
      }
      const start = formatSingleDate(group[0]);
      const endDay = new Date(group[group.length - 1]).getDate();
      return `${start}-${endDay}`;
    })
    .join(', ');
}

/**
 * 格式化单个日期（如 "1/15"）
 * @param dateStr YYYY-MM-DD 格式的日期字符串
 * @returns 短格式日期字符串
 */
function formatSingleDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${month}/${day}`;
}

/**
 * 按优先级排序任务（high > medium > low）
 * @param tasks 任务数组
 * @returns 排序后的任务数组
 */
export function sortTasksByPriority(tasks: Task[]): Task[] {
  const priorityOrder: Record<Priority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return [...tasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * 搜索任务（全文检索标题和描述）
 * @param tasks 任务数组
 * @param query 搜索关键词
 * @returns 匹配的任务数组
 */
export function searchTasks(tasks: Task[], query: string): Task[] {
  if (!query.trim()) {
    return tasks;
  }

  const lowerQuery = query.toLowerCase();
  return tasks.filter(task =>
    task.title.toLowerCase().includes(lowerQuery) ||
    (task.description && task.description.toLowerCase().includes(lowerQuery))
  );
}
