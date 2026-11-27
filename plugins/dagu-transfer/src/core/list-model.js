// 列表的纯逻辑：排序、过滤、高亮移动。

import { targetDestination } from './targets.js';

// 列表默认高亮第一项，所以把上次使用的目标排在第一位，其余保持配置顺序。
export function orderTargets(targets, lastUsedId) {
  const last = targets.find((target) => target.id === lastUsedId);
  if (!last) return [...targets];
  return [last, ...targets.filter((target) => target.id !== last.id)];
}

// 按名称或目标位置过滤，不区分大小写。
export function filterTargets(targets, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [...targets];
  return targets.filter((target) => `${target.name}\n${targetDestination(target)}`.toLowerCase().includes(needle));
}

// 高亮在首尾之间移动，到头就停住。
export function moveHighlight(index, delta, length) {
  if (length <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}
