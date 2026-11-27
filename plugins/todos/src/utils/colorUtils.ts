import { Priority, Task, TaskColorMode, TaskStatus } from '../types';
import { getTaskStatus } from './taskUtils';

/**
 * 任务颜色工具
 *
 * 支持两种取色方式（可在设置里切换）：
 * - status：按完成状态取色，用来一眼分出未完成 / 逾期 / 已完成
 * - random：按任务 ID 稳定映射到调色板，用来在大量任务里区分不同任务
 */
const taskColors = [
  '#7DD3FC', // sky
  '#FDE68A', // yellow
  '#C4B5FD', // violet
  '#FCA5A5', // red
  '#93C5FD', // blue
  '#86EFAC', // green
  '#F9A8D4', // pink
  '#FDBA74', // orange
  '#A5B4FC', // indigo
  '#6EE7B7', // emerald
  '#FDA4AF', // rose
  '#D8B4FE', // purple
  '#5EEAD4', // teal
  '#FCD34D', // amber
];

const statusColors: Record<TaskStatus, string> = {
  todo: '#0F766E', // 未完成：主线青绿
  overdue: '#DC2626', // 逾期：警示红
  done: '#A8A29E', // 已完成：退到灰色
};

/**
 * 根据任务 ID 生成一致的颜色
 * @param taskId 任务 ID
 * @returns HEX 颜色值
 */
export function getRandomTaskColor(taskId: string): string {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = taskId.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % taskColors.length;
  return taskColors[index];
}

/**
 * 按任务当前状态取色
 * @param task 任务对象
 * @returns HEX 颜色值
 */
export function getStatusTaskColor(task: Task): string {
  return statusColors[getTaskStatus(task)] || statusColors.todo;
}

/**
 * 按设置里的取色方式返回任务色条颜色
 * @param task 任务对象
 * @param mode 取色方式，默认按任务随机配色
 */
export function getTaskColor(task: Task, mode: TaskColorMode = 'random'): string {
  return mode === 'status' ? getStatusTaskColor(task) : getRandomTaskColor(task.id);
}

const priorityLabels: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export function getPriorityLabel(priority: Priority): string {
  return priorityLabels[priority] || priorityLabels.medium;
}
