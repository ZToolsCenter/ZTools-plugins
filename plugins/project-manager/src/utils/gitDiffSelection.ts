/***********************Git diff 选中态（按项目分桶）*********************/

/** diff 的来源：工作区改动，或某个提交里的文件 */
export type GitDiffSource = 'worktree' | { commit: string };

/** 单个项目当前正在查看的 diff */
export interface GitDiffSelection {
  /** diff 正文 */
  content: string;
  /** 相对路径；空串表示没有选中文件 */
  file: string;
  /** 是否在看已暂存的差异 */
  staged: boolean;
  /** 重命名提交或状态的旧路径，用于读取正确的 before blob */
  oldPath?: string;
  /**
   * 来源。changes 与 history 两个页签共用同一个桶，
   * 靠这个字段区分「工作区 diff」与「某次提交里的 diff」——
   * 否则实例被 KeepAlive 淘汰重建后页签回到 changes，
   * 桶里却可能是提交内的 diff，而左侧文件列表没有任何高亮可供判断。
   */
  source: GitDiffSource;
}

export type GitDiffSelectionByProject = Record<string, GitDiffSelection>;

/**
 * 共享的空桶。
 * 返回同一个常量而不是每次新建 `{}`，避免下游 computed 因引用变化而无谓失效。
 * 所有写入都产生新对象，所以它永远不会被改写。
 */
export const EMPTY_DIFF_SELECTION: GitDiffSelection = Object.freeze({
  content: '',
  file: '',
  staged: false,
  source: 'worktree',
}) as GitDiffSelection;

/**
 * 桶数上限。
 * 单个 diff 最坏可达数 MB（src-tauri/src/git.rs 的 DIFF_MAX_FILE_SIZE 是
 * 5MB 的**源文件**上限，diff 输出可能更大），长会话逛过几十个子项目
 * 会把内存钉住，所以要按「最近使用」淘汰。
 */
export const MAX_DIFF_SELECTION_BUCKETS = 3;

/** 读取某项目的 diff 选中态；没有则返回共享空桶 */
export function readDiffSelection(
  buckets: GitDiffSelectionByProject,
  projectId: string,
): GitDiffSelection {
  return buckets[projectId] ?? EMPTY_DIFF_SELECTION;
}

/**
 * 写入某项目的 diff 选中态（与既有值合并），并把它标记为最近使用。
 *
 * 超出上限时淘汰最久未用的桶，但**只丢 content、保留 file/staged/source**：
 * 用户切回那个项目时左侧仍能高亮他刚才看的文件，由 GitDiffView 按需重取正文，
 * 而不是显示成「什么都没选」。
 */
export function writeDiffSelection(
  buckets: GitDiffSelectionByProject,
  order: string[],
  projectId: string,
  patch: Partial<GitDiffSelection>,
): void {
  const current = buckets[projectId] ?? EMPTY_DIFF_SELECTION;
  buckets[projectId] = { ...current, ...patch };

  touchDiffSelection(order, projectId);

  // 淘汰最久未用的：只清正文，留下「看的是哪个文件」
  while (order.length > MAX_DIFF_SELECTION_BUCKETS) {
    const staleId = order.shift();
    if (!staleId || staleId === projectId) continue;
    const stale = buckets[staleId];
    if (stale && stale.content) {
      buckets[staleId] = { ...stale, content: '' };
    }
  }
}

/** 把项目移到「最近使用」队尾 */
function touchDiffSelection(order: string[], projectId: string): void {
  const index = order.indexOf(projectId);
  if (index !== -1) order.splice(index, 1);
  order.push(projectId);
}

/**
 * 清空某项目的 diff 选中态。
 * 用 delete 而不是写空对象，桶不会因为「清过一次」而长期占键。
 */
export function clearDiffSelection(
  buckets: GitDiffSelectionByProject,
  order: string[],
  projectId: string,
): void {
  delete buckets[projectId];
  const index = order.indexOf(projectId);
  if (index !== -1) order.splice(index, 1);
}

/**
 * 裁掉已删除项目的桶。
 * 形状与 stores/usage.ts 的 cleanupRemovedProjects 一致：传存活 id，删其余。
 */
export function pruneDiffSelections(
  buckets: GitDiffSelectionByProject,
  order: string[],
  activeProjectIds: string[],
): void {
  const alive = new Set(activeProjectIds);
  for (const projectId of Object.keys(buckets)) {
    if (!alive.has(projectId)) delete buckets[projectId];
  }
  for (let i = order.length - 1; i >= 0; i--) {
    if (!alive.has(order[i])) order.splice(i, 1);
  }
}

/** 两个 diff 来源是否指向同一处（用于判断桶里的内容是否属于当前页签） */
export function isSameDiffSource(a: GitDiffSource, b: GitDiffSource): boolean {
  if (a === 'worktree' || b === 'worktree') return a === b;
  return a.commit === b.commit;
}
