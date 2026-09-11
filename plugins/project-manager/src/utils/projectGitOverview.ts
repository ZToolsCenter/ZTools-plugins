import type { GitFileStatus, GitStatusResult } from '../types';

/***********************Git 一级页汇总类型*********************/
export interface ProjectGitOverview {
  isGitRepo: boolean;
  modified: number;
  added: number;
  deleted: number;
  conflicted: number;
  total: number;
  clean: boolean;
}

const STATUS_PRIORITY: Record<GitFileStatus['status'], number> = {
  modified: 1,
  renamed: 1,
  copied: 1,
  added: 2,
  untracked: 2,
  deleted: 3,
  conflicted: 4,
};

function mergeStatus(current: GitFileStatus['status'] | undefined, next: GitFileStatus['status']) {
  if (!current || STATUS_PRIORITY[next] > STATUS_PRIORITY[current]) return next;
  return current;
}

/***********************按路径去重并聚合*********************/
/**
 * 将 GitStatusResult 的多个 bucket 合并为「每个路径一条最终状态」。
 * 同一路径同时 staged + unstaged 时只计一次，冲突优先级最高。
 */
export function summarizeGitStatus(
  status: GitStatusResult | undefined,
  isGitRepo: boolean | undefined,
): ProjectGitOverview | undefined {
  if (isGitRepo === undefined && !status) return undefined;
  if (isGitRepo === false) {
    return { isGitRepo: false, modified: 0, added: 0, deleted: 0, conflicted: 0, total: 0, clean: true };
  }

  if (!status) return undefined;

  const byPath = new Map<string, GitFileStatus['status']>();
  const buckets: GitFileStatus[][] = [status.staged, status.unstaged, status.untracked, status.conflicted];
  for (const bucket of buckets) {
    for (const file of bucket) {
      byPath.set(file.path, mergeStatus(byPath.get(file.path), file.status));
    }
  }

  let modified = 0;
  let added = 0;
  let deleted = 0;
  let conflicted = 0;
  for (const fileStatus of byPath.values()) {
    if (fileStatus === 'conflicted') conflicted += 1;
    else if (fileStatus === 'deleted') deleted += 1;
    else if (fileStatus === 'added' || fileStatus === 'untracked') added += 1;
    else modified += 1;
  }

  const total = modified + added + deleted + conflicted;
  return { isGitRepo: true, modified, added, deleted, conflicted, total, clean: total === 0 };
}
