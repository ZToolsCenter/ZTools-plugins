import type { GitBranch } from '../../types';

export interface GitBranchGroups {
  current: GitBranch | null;
  locals: GitBranch[];
  remotes: GitBranch[];
}

export type GitBranchAction = 'switch' | 'delete' | 'rename';

/***********************分支名称处理*********************/

export function getRemoteCheckoutName(remoteBranchName: string): string {
  const slashIndex = remoteBranchName.indexOf('/');
  if (slashIndex === -1) return remoteBranchName;
  return remoteBranchName.slice(slashIndex + 1);
}

function matchesBranchSearch(branch: GitBranch, searchQuery: string): boolean {
  const keyword = searchQuery.trim().toLowerCase();
  if (!keyword) return true;
  return branch.name.toLowerCase().includes(keyword) || branch.upstream?.toLowerCase().includes(keyword) === true;
}

function sortBranches(branches: GitBranch[]): GitBranch[] {
  return [...branches].sort((a, b) => a.name.localeCompare(b.name));
}

/***********************分支列表分组*********************/

export function createBranchGroups(branches: GitBranch[], searchQuery: string): GitBranchGroups {
  const visibleBranches = branches.filter(branch => matchesBranchSearch(branch, searchQuery));
  const current = visibleBranches.find(branch => branch.is_current && !branch.is_remote) || null;

  return {
    current,
    locals: sortBranches(visibleBranches.filter(branch => !branch.is_remote && !branch.is_current)),
    remotes: sortBranches(visibleBranches.filter(branch => branch.is_remote)),
  };
}

/***********************分支操作状态*********************/

export function isBranchActionDisabled(branch: GitBranch, action: GitBranchAction): boolean {
  if (action === 'switch') return branch.is_current;
  if (action === 'delete') return branch.is_current || branch.is_remote;
  if (action === 'rename') return branch.is_remote;
  return false;
}
