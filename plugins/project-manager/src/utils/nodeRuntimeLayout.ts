export type NodeRuntimeListMode = 'table' | 'compact-table' | 'card';

export function getRuntimeListMode(width: number): NodeRuntimeListMode {
  if (width >= 1350) return 'table';
  if (width >= 760) return 'compact-table';
  return 'card';
}
