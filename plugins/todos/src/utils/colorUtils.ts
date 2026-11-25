import { Priority } from '../types';

const priorityColors: Record<Priority, string> = {
  high: '#DC2626',
  medium: '#D97706',
  low: '#16A34A',
};

const priorityLabels: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/**
 * 任务左侧色条使用优先级语义色，而不是随机颜色。
 */
export function getPriorityColor(priority: Priority): string {
  return priorityColors[priority] || priorityColors.medium;
}

export function getPriorityLabel(priority: Priority): string {
  return priorityLabels[priority] || priorityLabels.medium;
}
