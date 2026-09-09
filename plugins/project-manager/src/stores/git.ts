import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import { requestAiTextWithFallback, type AiFallbackResult } from '../utils/aiFallback.ts';
import {
  readDiffSelection,
  writeDiffSelection,
  clearDiffSelection,
  pruneDiffSelections,
  type GitDiffSelection,
  type GitDiffSelectionByProject,
} from '../utils/gitDiffSelection.ts';
import type {
  AiAttempt,
  GitStatusResult,
  GitBranch,
  GitCommit,
  GitCommitFile,
  GitSummary,
  GitStashEntry,
  GitTag,
  GitResetMode,
  GitPullStrategy,
} from '../types';
import { summarizeGitStatus } from '../utils/projectGitOverview.ts';

const REPO_CHECK_MAX_AGE = 60_000;
const SUMMARY_STATUS_MAX_AGE = 15_000;
const HISTORY_MAX_AGE = 45_000;
type GitOperationKind =
  | 'stage'
  | 'unstage'
  | 'stageAll'
  | 'unstageAll'
  | 'commit'
  | 'amend'
  | 'pull'
  | 'push'
  | 'fetch'
  | 'switchBranch'
  | 'createBranch'
  | 'deleteBranch'
  | 'renameBranch'
  | 'merge'
  | 'rebase'
  | 'reset'
  | 'cherryPick'
  | 'revertCommit'
  | 'stash'
  | 'tag'
  | 'stageHunk'
  | 'unstageHunk'
  | 'discardHunk'
  | 'ignore'
  | 'stopTracking'
  | 'revertHunk'
  | 'discard'
  | 'discardUntracked';

export const useGitStore = defineStore('git', () => {
  // ─── State ───────────────────────────────────────────────────────────────
  const isGitRepo = ref<Record<string, boolean>>({});
  const summary = ref<Record<string, GitSummary>>({});
  const status = ref<Record<string, GitStatusResult>>({});
  const history = ref<Record<string, GitCommit[]>>({});
  const fileHistory = ref<Record<string, Record<string, GitCommit[]>>>({});
  const branches = ref<Record<string, GitBranch[]>>({});
  const commitDetails = ref<Record<string, Record<string, GitCommit>>>({});

  // 当前正在查看的 diff：**按 projectId 分桶**。
  // 原先是三个全局单值 ref，配合被 KeepAlive 缓存的多个 GitView 实例
  // 会互相清掉对方的 diff（缓存实例跟着全局 activeProjectId 一起变，
  // 清的正是即将要显示的那一份）。分桶后各项目互不可见、互不干扰。
  const diffSelections = ref<GitDiffSelectionByProject>({});
  // 最近使用顺序，用于超限淘汰；非响应式，与上面的 *Tasks 容器同一风格
  const diffSelectionOrder: string[] = [];

  // Commit file lists cached by projectId -> hash -> files
  const commitFiles = ref<Record<string, Record<string, GitCommitFile[]>>>({});
  // Currently selected commit hash in history
  const selectedCommitHash = ref<Record<string, string>>({});

  // Commit message per project (survives tab switches)
  const commitMessage = ref<Record<string, string>>({});

  // Loading states
  const loading = ref(false);
  const operationLoading = ref(false);
  const activeOperationKind = ref<GitOperationKind | null>(null);
  const activeOperationId = ref<string | null>(null);
  // projectId that owns the in-flight operation; UI gates loading display by
  // comparing this to the currently viewed project so a long-running pull/push
  // on project A does not paint a fake loading state onto project B when the
  // user switches projects mid-operation.
  const activeOperationProjectId = ref<string | null>(null);
  const operationCancellable = ref(false);
  const operationCancelling = ref(false);
  const coldStorage = ref(false);

  // Cache timestamps
  const repoCheckedAt = ref<Record<string, number>>({});
  const summaryStatusLoadedAt = ref<Record<string, number>>({});
  const historyLoadedAt = ref<Record<string, number>>({});

  // In-flight request dedupe
  const repoCheckTasks = new Map<string, Promise<boolean>>();
  const summaryStatusTasks = new Map<string, Promise<void>>();
  const historyTasks = new Map<string, Promise<void>>();
  const fileHistoryTasks = new Map<string, Promise<void>>();
  let loadingCount = 0;

  // ─── Getters ─────────────────────────────────────────────────────────────

  function getSummary(projectId: string): GitSummary | undefined {
    return summary.value[projectId];
  }

  function getStatus(projectId: string): GitStatusResult | undefined {
    return status.value[projectId];
  }

  function getFileHistory(projectId: string, file: string): GitCommit[] {
    return fileHistory.value[projectId]?.[file] || [];
  }

  /** 该项目当前正在查看的 diff；没有则返回共享空桶 */
  function getDiffSelection(projectId: string): GitDiffSelection {
    return readDiffSelection(diffSelections.value, projectId);
  }

  function getBranches(projectId: string): GitBranch[] {
    return branches.value[projectId] || [];
  }

  function getLocalBranches(projectId: string): GitBranch[] {
    return getBranches(projectId).filter(b => !b.is_remote);
  }

  function getRemoteBranches(projectId: string): GitBranch[] {
    return getBranches(projectId).filter(b => b.is_remote);
  }

  function getTotalChanges(projectId: string): number {
    const s = status.value[projectId];
    return summarizeGitStatus(s, isGitRepo.value[projectId])?.total ?? 0;
  }

  function isFresh(record: Record<string, number>, projectId: string, maxAgeMs: number): boolean {
    const timestamp = record[projectId];
    return typeof timestamp === 'number' && (Date.now() - timestamp) < maxAgeMs;
  }

  function beginLoading() {
    loadingCount += 1;
    loading.value = loadingCount > 0;
  }

  function endLoading() {
    loadingCount = Math.max(0, loadingCount - 1);
    loading.value = loadingCount > 0;
  }

  function setColdStorage(enabled: boolean): void {
    coldStorage.value = enabled;
  }

  function waitForUiPaint(): Promise<void> {
    return new Promise(resolve => {
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        setTimeout(resolve, 0);
        return;
      }
      window.requestAnimationFrame(() => resolve());
    });
  }

  async function withOperationLoading<T>(
    projectId: string | null,
    kind: GitOperationKind,
    task: (operationId?: string) => Promise<T>,
    options: { cancellable?: boolean } = {},
  ): Promise<T> {
    operationLoading.value = true;
    activeOperationKind.value = kind;
    activeOperationProjectId.value = projectId;
    operationCancellable.value = options.cancellable ?? false;
    operationCancelling.value = false;
    activeOperationId.value = operationCancellable.value ? crypto.randomUUID() : null;
    await waitForUiPaint();
    try {
      return await task(activeOperationId.value || undefined);
    } finally {
      operationLoading.value = false;
      activeOperationKind.value = null;
      activeOperationProjectId.value = null;
      activeOperationId.value = null;
      operationCancellable.value = false;
      operationCancelling.value = false;
    }
  }

  async function cancelActiveOperation(): Promise<void> {
    if (!activeOperationId.value || !operationCancellable.value || operationCancelling.value) {
      return;
    }

    operationCancelling.value = true;
    try {
      await api.gitCancelOperation(activeOperationId.value);
    } finally {
      operationCancelling.value = false;
    }
  }

  // ─── Refresh Actions (on-demand) ────────────────────────────────────────

  async function checkGitRepo(
    projectId: string,
    path: string,
    options: { force?: boolean; maxAgeMs?: number } = {},
  ): Promise<boolean> {
    const force = options.force ?? false;
    const maxAgeMs = options.maxAgeMs ?? REPO_CHECK_MAX_AGE;

    if (!force && coldStorage.value) {
      return isGitRepo.value[projectId] || false;
    }

    if (!force && projectId in isGitRepo.value && isFresh(repoCheckedAt.value, projectId, maxAgeMs)) {
      return isGitRepo.value[projectId];
    }

    const pendingTask = repoCheckTasks.get(projectId);
    if (pendingTask) {
      return pendingTask;
    }

    const task = (async () => {
      try {
        const result = await api.gitCheck(path);
        isGitRepo.value[projectId] = result;
        repoCheckedAt.value[projectId] = Date.now();
        return result;
      } catch {
        isGitRepo.value[projectId] = false;
        repoCheckedAt.value[projectId] = Date.now();
        return false;
      }
    })();

    repoCheckTasks.set(projectId, task);

    try {
      return await task;
    } finally {
      if (repoCheckTasks.get(projectId) === task) {
        repoCheckTasks.delete(projectId);
      }
    }
  }

  async function initRepo(projectId: string, path: string): Promise<void> {
    await api.gitInit(path);
    isGitRepo.value[projectId] = true;
    repoCheckedAt.value[projectId] = Date.now();
    await refreshSummaryAndStatus(projectId, path);
  }

  async function refreshSummary(projectId: string, path: string): Promise<void> {
    try {
      summary.value[projectId] = await api.gitSummary(path);
    } catch (e) {
      console.error('Failed to get git summary:', e);
    }
  }

  async function refreshStatus(projectId: string, path: string): Promise<void> {
    try {
      status.value[projectId] = await api.gitStatus(path);
      statusLoadedAt(projectId);
      // 选中的文件已不在 status 里就清掉该项目的 diff。
      // 比对的是**该项目自己**那一桶——原先用全局单值比对，会出现
      // 「在 B 刷新 status 却清掉了 A 正在看的 diff」。
      const selection = getDiffSelection(projectId);
      if (selection.file && selection.source === 'worktree') {
        const s = status.value[projectId];
        const fileStillExists = s && [
          ...s.staged,
          ...s.unstaged,
          ...s.untracked,
          ...s.conflicted,
        ].some(f => f.path === selection.file);
        if (!fileStillExists) {
          clearDiff(projectId);
        }
      }
    } catch (e) {
      console.error('Failed to get git status:', e);
    }
  }

  async function refreshAfterMutation(projectId: string, path: string): Promise<void> {
    await Promise.all([
      refreshSummary(projectId, path),
      refreshStatus(projectId, path),
    ]);
    summaryStatusLoadedAt.value[projectId] = Date.now();
  }

  async function refreshSummaryAndStatus(projectId: string, path: string): Promise<void> {
    if (!(await checkGitRepo(projectId, path, { force: true }))) {
      return;
    }
    beginLoading();
    try {
      await Promise.all([
        refreshSummary(projectId, path),
        refreshStatus(projectId, path),
      ]);
      summaryStatusLoadedAt.value[projectId] = Date.now();
    } finally {
      endLoading();
    }
  }

  async function refreshHistory(projectId: string, path: string, maxCount?: number): Promise<void> {
    try {
      history.value[projectId] = await api.gitHistory(path, maxCount);
      historyLoadedAt.value[projectId] = Date.now();
    } catch (e) {
      console.error('Failed to get git history:', e);
    }
  }

  async function refreshFileHistory(projectId: string, path: string, file: string, maxCount?: number): Promise<void> {
    try {
      const commits = await api.gitFileHistory(path, file, maxCount);
      if (!fileHistory.value[projectId]) fileHistory.value[projectId] = {};
      fileHistory.value[projectId][file] = commits;
    } catch (e) {
      console.error('Failed to get file history:', e);
    }
  }

  function statusLoadedAt(projectId: string): void {
    summaryStatusLoadedAt.value[projectId] = Date.now();
  }

  async function ensureSummaryAndStatus(
    projectId: string,
    path: string,
    options: { force?: boolean; maxAgeMs?: number } = {},
  ): Promise<void> {
    const force = options.force ?? false;
    const maxAgeMs = options.maxAgeMs ?? SUMMARY_STATUS_MAX_AGE;

    if (!force && coldStorage.value) {
      return;
    }

    if (!(await checkGitRepo(projectId, path, { force }))) {
      return;
    }

    if (!force && isFresh(summaryStatusLoadedAt.value, projectId, maxAgeMs)) {
      return;
    }

    const pendingTask = summaryStatusTasks.get(projectId);
    if (pendingTask) {
      return pendingTask;
    }

    const task = (async () => {
      beginLoading();
      try {
        await Promise.all([
          refreshSummary(projectId, path),
          refreshStatus(projectId, path),
        ]);
        summaryStatusLoadedAt.value[projectId] = Date.now();
      } finally {
        endLoading();
      }
    })();

    summaryStatusTasks.set(projectId, task);

    try {
      await task;
    } finally {
      if (summaryStatusTasks.get(projectId) === task) {
        summaryStatusTasks.delete(projectId);
      }
    }
  }

  async function ensureHistory(
    projectId: string,
    path: string,
    options: { force?: boolean; maxAgeMs?: number; maxCount?: number } = {},
  ): Promise<void> {
    const force = options.force ?? false;
    const maxAgeMs = options.maxAgeMs ?? HISTORY_MAX_AGE;
    const maxCount = options.maxCount;

    if (!force && coldStorage.value) {
      return;
    }

    if (!(await checkGitRepo(projectId, path, { force }))) {
      return;
    }

    if (!force && isFresh(historyLoadedAt.value, projectId, maxAgeMs)) {
      return;
    }

    const pendingTask = historyTasks.get(projectId);
    if (pendingTask) {
      return pendingTask;
    }

    const task = refreshHistory(projectId, path, maxCount);
    historyTasks.set(projectId, task);

    try {
      await task;
    } finally {
      if (historyTasks.get(projectId) === task) {
        historyTasks.delete(projectId);
      }
    }
  }

  async function ensureFileHistory(
    projectId: string,
    path: string,
    file: string,
    options: { force?: boolean; maxCount?: number } = {},
  ): Promise<void> {
    if (!options.force && coldStorage.value) return;
    if (!(await checkGitRepo(projectId, path, { force: options.force }))) return;

    const key = `${projectId}:${file}`;
    const existing = fileHistory.value[projectId]?.[file];
    if (!options.force && existing) return;
    const pendingTask = fileHistoryTasks.get(key);
    if (pendingTask) return pendingTask;

    const task = refreshFileHistory(projectId, path, file, options.maxCount);
    fileHistoryTasks.set(key, task);
    try {
      await task;
    } finally {
      if (fileHistoryTasks.get(key) === task) fileHistoryTasks.delete(key);
    }
  }

  async function refreshBranches(projectId: string, path: string): Promise<void> {
    try {
      branches.value[projectId] = await api.gitListBranches(path);
    } catch (e) {
      console.error('Failed to get branches:', e);
    }
  }

  async function refreshRepositoryState(
    projectId: string,
    path: string,
    options: { includeHistory?: boolean; includeBranches?: boolean } = {},
  ): Promise<void> {
    await refreshSummaryAndStatus(projectId, path);

    const tasks: Promise<void>[] = [];
    if (options.includeHistory) {
      tasks.push(refreshHistory(projectId, path));
    }
    if (options.includeBranches) {
      tasks.push(refreshBranches(projectId, path));
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  // ─── Git Operations ──────────────────────────────────────────────────────

  async function stageFiles(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading(projectId, 'stage', async () => {
      await api.gitStage(path, files);
      await refreshAfterMutation(projectId, path);
    });
  }

  async function unstageFiles(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading(projectId, 'unstage', async () => {
      await api.gitUnstage(path, files);
      await refreshAfterMutation(projectId, path);
    });
  }

  async function stageAll(projectId: string, path: string): Promise<void> {
    await withOperationLoading(projectId, 'stageAll', async () => {
      await api.gitStageAll(path);
      await refreshAfterMutation(projectId, path);
    });
  }

  async function unstageAll(projectId: string, path: string): Promise<void> {
    await withOperationLoading(projectId, 'unstageAll', async () => {
      await api.gitUnstageAll(path);
      await refreshAfterMutation(projectId, path);
    });
  }

  async function commit(projectId: string, path: string, message: string): Promise<string> {
    return withOperationLoading(projectId, 'commit', async () => {
      const result = await api.gitCommit(path, message);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  /**
   * 无 staged 时自动 stage 全部再提交；有冲突时拒绝。
   * 供工作区「一键提交」使用。
   */
  async function commitWithAutoStage(
    projectId: string,
    path: string,
    message: string,
  ): Promise<string> {
    const s = status.value[projectId];
    const summaryState = summary.value[projectId];
    if (summaryState?.has_conflicts || (s?.conflicted?.length ?? 0) > 0) {
      throw new Error('has_conflicts');
    }
    const stagedCount = s?.staged?.length ?? 0;
    const dirtyCount =
      (s?.unstaged?.length ?? 0) + (s?.untracked?.length ?? 0);
    if (stagedCount === 0 && dirtyCount > 0) {
      await stageAll(projectId, path);
    }
    return commit(projectId, path, message);
  }

  async function amend(projectId: string, path: string, message?: string): Promise<string> {
    return withOperationLoading(projectId, 'amend', async () => {
      const result = await api.gitAmend(path, message);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function pull(
    projectId: string,
    path: string,
    remote?: string,
    branch?: string,
    strategy?: GitPullStrategy,
  ): Promise<string> {
    return withOperationLoading(projectId, 'pull', async (operationId) => {
      const result = await api.gitPull(path, remote, branch, operationId, strategy);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    }, { cancellable: true });
  }

  async function push(
    projectId: string,
    path: string,
    remote?: string,
    branch?: string,
    force?: boolean,
    setUpstream?: boolean,
    forceWithLease?: boolean,
  ): Promise<string> {
    return withOperationLoading(projectId, 'push', async (operationId) => {
      const result = await api.gitPush(
        path,
        remote,
        branch,
        force,
        setUpstream,
        operationId,
        forceWithLease,
      );
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    }, { cancellable: true });
  }

  async function fetch(projectId: string, path: string, remote?: string): Promise<string> {
    return withOperationLoading(projectId, 'fetch', async (operationId) => {
      const result = await api.gitFetch(path, remote, operationId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    }, { cancellable: true });
  }

  async function switchBranch(projectId: string, path: string, branch: string): Promise<string> {
    return withOperationLoading(projectId, 'switchBranch', async () => {
      const result = await api.gitSwitchBranch(path, branch);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function createAndSwitchBranch(projectId: string, path: string, name: string, startPoint?: string): Promise<string> {
    return withOperationLoading(projectId, 'createBranch', async () => {
      const result = await api.gitCreateAndSwitchBranch(path, name, startPoint);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function deleteBranch(projectId: string, path: string, name: string, force?: boolean): Promise<string> {
    return withOperationLoading(projectId, 'deleteBranch', async () => {
      const result = await api.gitDeleteBranch(path, name, force);
      await refreshRepositoryState(projectId, path, { includeBranches: true });
      return result;
    });
  }

  async function renameBranch(projectId: string, path: string, oldName: string, newName: string): Promise<string> {
    return withOperationLoading(projectId, 'renameBranch', async () => {
      const result = await api.gitRenameBranch(path, oldName, newName);
      await refreshRepositoryState(projectId, path, { includeBranches: true });
      return result;
    });
  }

  async function mergeBranch(projectId: string, path: string, branch: string): Promise<string> {
    return withOperationLoading(projectId, 'merge', async () => {
      const result = await api.gitMerge(path, branch);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function mergeContinue(projectId: string, path: string): Promise<string> {
    return withOperationLoading(projectId, 'merge', async () => {
      const result = await api.gitMergeContinue(path);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function mergeAbort(projectId: string, path: string): Promise<string> {
    return withOperationLoading(projectId, 'merge', async () => {
      const result = await api.gitMergeAbort(path);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function rebaseBranch(projectId: string, path: string, branch: string): Promise<string> {
    return withOperationLoading(projectId, 'rebase', async () => {
      const result = await api.gitRebase(path, branch);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function resetTo(
    projectId: string,
    path: string,
    mode: GitResetMode,
    target?: string,
  ): Promise<string> {
    return withOperationLoading(projectId, 'reset', async () => {
      const result = await api.gitReset(path, mode, target);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function cherryPick(projectId: string, path: string, hash: string): Promise<string> {
    return withOperationLoading(projectId, 'cherryPick', async () => {
      const result = await api.gitCherryPick(path, hash);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  async function revertCommit(projectId: string, path: string, hash: string): Promise<string> {
    return withOperationLoading(projectId, 'revertCommit', async () => {
      const result = await api.gitRevertCommit(path, hash);
      clearDiff(projectId);
      await refreshRepositoryState(projectId, path, { includeHistory: true, includeBranches: true });
      return result;
    });
  }

  // ─── Stash / Tags ───────────────────────────────────────────────────────

  async function listStashes(path: string): Promise<GitStashEntry[]> {
    return api.gitStashList(path);
  }

  async function stashSave(projectId: string, path: string, message?: string): Promise<string> {
    return withOperationLoading(projectId, 'stash', async () => {
      const result = await api.gitStashSave(path, message);
      await refreshStatus(projectId, path);
      return result;
    });
  }

  async function stashPop(projectId: string, path: string, index?: number): Promise<string> {
    return withOperationLoading(projectId, 'stash', async () => {
      const result = await api.gitStashPop(path, index);
      await refreshRepositoryState(projectId, path, { includeHistory: true });
      return result;
    });
  }

  async function stashApply(projectId: string, path: string, index?: number): Promise<string> {
    return withOperationLoading(projectId, 'stash', async () => {
      const result = await api.gitStashApply(path, index);
      await refreshStatus(projectId, path);
      return result;
    });
  }

  async function stashDrop(projectId: string, path: string, index: number): Promise<string> {
    return withOperationLoading(projectId, 'stash', async () => {
      return api.gitStashDrop(path, index);
    });
  }

  async function listTags(path: string): Promise<GitTag[]> {
    return api.gitTags(path);
  }

  async function createTag(
    projectId: string,
    path: string,
    name: string,
    message?: string,
    target?: string,
  ): Promise<string> {
    return withOperationLoading(projectId, 'tag', async () => {
      return api.gitCreateTag(path, name, message, target);
    });
  }

  async function deleteTag(projectId: string, path: string, name: string): Promise<string> {
    return withOperationLoading(projectId, 'tag', async () => {
      return api.gitDeleteTag(path, name);
    });
  }

  async function getDiff(
    projectId: string,
    path: string,
    file?: string,
    staged?: boolean,
    oldPath?: string,
  ): Promise<string> {
    try {
      const result = await api.gitDiff(path, file, staged);
      writeDiffSelection(diffSelections.value, diffSelectionOrder, projectId, {
        content: result,
        file: file || '',
        staged: staged || false,
        oldPath,
        source: 'worktree',
      });
      return result;
    } catch (e) {
      // 加载diff失败时清除当前diff状态，避免显示过期内容
      clearDiff(projectId);
      throw e;
    }
  }

  async function getDiffCommit(projectId: string, path: string, hash: string): Promise<string> {
    const result = await api.gitDiffCommit(path, hash);
    // 显式写全 file/staged，避免只覆盖 content 而留下上一次的文件名（既有脏状态）
    writeDiffSelection(diffSelections.value, diffSelectionOrder, projectId, {
      content: result,
      file: '',
      staged: false,
      source: { commit: hash },
    });
    return result;
  }

  async function refreshCommitFiles(projectId: string, path: string, hash: string): Promise<GitCommitFile[]> {
    try {
      const files = await api.gitCommitFiles(path, hash);
      if (!commitFiles.value[projectId]) {
        commitFiles.value[projectId] = {};
      }
      commitFiles.value[projectId][hash] = files;
      return files;
    } catch {
      return [];
    }
  }

  async function refreshCommitDetail(projectId: string, path: string, hash: string): Promise<GitCommit> {
    const detail = await api.gitCommitDetail(path, hash);
    if (!commitDetails.value[projectId]) {
      commitDetails.value[projectId] = {};
    }
    commitDetails.value[projectId][hash] = detail;
    return detail;
  }

  function getCommitFiles(projectId: string, hash: string): GitCommitFile[] {
    return commitFiles.value[projectId]?.[hash] || [];
  }

  function getCommitDetail(projectId: string, hash: string): GitCommit | undefined {
    return commitDetails.value[projectId]?.[hash];
  }

  async function getDiffCommitFile(
    projectId: string,
    path: string,
    hash: string,
    file: string,
    oldPath?: string,
  ): Promise<string> {
    const result = await api.gitDiffCommitFile(path, hash, file);
    // 显式写 staged: false —— 原先漏写，会留下上一次工作区 diff 的 staged 值
    writeDiffSelection(diffSelections.value, diffSelectionOrder, projectId, {
      content: result,
      file,
      staged: false,
      oldPath,
      source: { commit: hash },
    });
    return result;
  }

  async function getImageDiff(
    projectId: string,
    path: string,
    file: string,
    staged?: boolean,
    commit?: string,
    oldPath?: string,
  ) {
    void projectId;
    return api.gitGetImageDiff(path, file, staged, commit, oldPath);
  }

  async function getBinaryDiffMeta(
    path: string,
    file: string,
    staged?: boolean,
    commit?: string,
    oldPath?: string,
  ) {
    return api.gitGetBinaryDiffMeta(path, file, staged, commit, oldPath);
  }

  async function revertHunk(projectId: string, path: string, patch: string, staged?: boolean): Promise<string> {
    return withOperationLoading(projectId, 'revertHunk', async () => {
      const result = await api.gitRevertHunk(path, patch, staged);
      await refreshAfterMutation(projectId, path);
      const selection = getDiffSelection(projectId);
      if (selection.file && selection.source === 'worktree') {
        await getDiff(projectId, path, selection.file, selection.staged, selection.oldPath);
      }
      return result;
    });
  }

  async function applyHunk(
    projectId: string,
    path: string,
    patch: string,
    mode: 'stage' | 'unstage' | 'discard',
  ): Promise<string> {
    return withOperationLoading(projectId, `${mode}Hunk`, async () => {
      const result = await api.gitApplyHunk(path, patch, mode);
      await refreshAfterMutation(projectId, path);
      const selection = getDiffSelection(projectId);
      if (selection.file && selection.source === 'worktree') {
        await getDiff(projectId, path, selection.file, selection.staged, selection.oldPath);
      }
      return result;
    });
  }

  async function addIgnorePattern(
    projectId: string,
    path: string,
    files: string[],
    kind: 'file' | 'filename' | 'extension' | 'directory',
    local?: boolean,
  ): Promise<string[]> {
    return withOperationLoading(projectId, 'ignore', async () => {
      const patterns = await api.gitAddIgnorePattern(path, files, kind, local);
      await refreshAfterMutation(projectId, path);
      return patterns;
    });
  }

  async function stopTracking(
    projectId: string,
    path: string,
    files: string[],
    kind: 'file' | 'filename' | 'extension' | 'directory',
    local?: boolean,
  ): Promise<string> {
    return withOperationLoading(projectId, 'stopTracking', async () => {
      const result = await api.gitStopTracking(path, files, kind, local);
      await refreshAfterMutation(projectId, path);
      return result;
    });
  }

  async function discardFiles(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading(projectId, 'discard', async () => {
      await api.gitDiscard(path, files);
      await refreshAfterMutation(projectId, path);
    });
  }

  /**
   * 生成 AI 提交信息，按配置的槽位顺序回退。
   *
   * 返回实际生效的那次尝试，调用方可以据此提示用户「用的不是首选渠道」。
   */
  async function generateAiCommitMessageV3(
    projectId: string,
    path: string,
    settings: {
      attempts: AiAttempt[];
      promptTemplate?: string;
      stream?: boolean;
    }
  ): Promise<AiFallbackResult> {
    /***********************AI 提交信息仅使用已暂存内容*********************/
    const diff = await api.gitDiffForAi(path);
    if (!diff.trim()) {
      throw new Error('no_staged');
    }

    const systemPrompt = settings.promptTemplate?.trim() ||
      `Generate a git commit message with these rules:
1. The first line must use Conventional Commits format: <type>(<scope>): <short summary>.
2. Use one of these types: feat, fix, refactor, chore, docs, style, test, perf.
3. Add a blank line after the first line, then write a concise body describing the concrete changes.
4. Write the body in Chinese. The first line may be in Chinese or English.
5. Keep each line within 72 characters.
6. Output only the commit message itself, with no extra explanation.`;

    // 槽位是否可用的判断收敛在 buildAiAttempts 里，这里只负责空列表兜底
    const result = await requestAiTextWithFallback(settings.attempts, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Git diff:\n\`\`\`\n${diff}\n\`\`\`` },
      ],
      maxTokens: 200,
      temperature: 0.3,
      stream: settings.stream,
    });

    void projectId;
    return result;
  }

  async function discardUntracked(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading(projectId, 'discardUntracked', async () => {
      await api.gitDiscardUntracked(path, files);
      await refreshAfterMutation(projectId, path);
    });
  }

  /** 清掉某项目的 diff 选中态（delete 键，不留空对象长期占位） */
  function clearDiff(projectId: string): void {
    clearDiffSelection(diffSelections.value, diffSelectionOrder, projectId);
  }

  /**
   * 裁掉已删除项目的全部缓存。
   *
   * 这些 Record 今天在项目删除后会永久驻留（history/diff 可能很大）。
   * 由 stores/project.ts 的 removeProject 调用，批量删除也走那里，一处即全覆盖。
   */
  function cleanupRemovedProjects(activeProjectIds: string[]): void {
    const alive = new Set(activeProjectIds);
    const prune = (record: Record<string, unknown>) => {
      for (const projectId of Object.keys(record)) {
        if (!alive.has(projectId)) delete record[projectId];
      }
    };

    prune(isGitRepo.value);
    prune(summary.value);
    prune(status.value);
    prune(history.value);
    prune(fileHistory.value);
    prune(branches.value);
    prune(commitDetails.value);
    prune(commitFiles.value);
    prune(selectedCommitHash.value);
    prune(commitMessage.value);
    prune(repoCheckedAt.value);
    prune(summaryStatusLoadedAt.value);
    prune(historyLoadedAt.value);
    pruneDiffSelections(diffSelections.value, diffSelectionOrder, activeProjectIds);
  }

  return {
    // State
    isGitRepo,
    summary,
    status,
    history,
    fileHistory,
    branches,
    commitDetails,
    diffSelections,
    commitFiles,
    selectedCommitHash,
    commitMessage,
    loading,
    operationLoading,
    activeOperationKind,
    activeOperationProjectId,
    operationCancellable,
    operationCancelling,
    coldStorage,

    // Getters
    getSummary,
    getStatus,
    getFileHistory,
    getBranches,
    getLocalBranches,
    getRemoteBranches,
    getTotalChanges,
    getCommitFiles,
    getCommitDetail,

    // Refresh
    checkGitRepo,
    initRepo,
    refreshSummary,
    refreshStatus,
    refreshSummaryAndStatus,
    refreshHistory,
    refreshFileHistory,
    refreshRepositoryState,
    ensureSummaryAndStatus,
    ensureHistory,
    ensureFileHistory,
    refreshBranches,
    refreshCommitFiles,
    refreshCommitDetail,
    setColdStorage,

    // Operations
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    commit,
    commitWithAutoStage,
    amend,
    pull,
    push,
    fetch,
    switchBranch,
    createAndSwitchBranch,
    deleteBranch,
    renameBranch,
    mergeBranch,
    mergeContinue,
    mergeAbort,
    rebaseBranch,
    resetTo,
    cherryPick,
    revertCommit,
    listStashes,
    stashSave,
    stashPop,
    stashApply,
    stashDrop,
    listTags,
    createTag,
    deleteTag,
    getDiff,
    getDiffCommit,
    getDiffCommitFile,
    getImageDiff,
    getBinaryDiffMeta,
    applyHunk,
    addIgnorePattern,
    stopTracking,
    revertHunk,
    discardFiles,
    discardUntracked,
    cancelActiveOperation,
    clearDiff,
    getDiffSelection,
    cleanupRemovedProjects,
    generateAiCommitMessage: generateAiCommitMessageV3,
  };
});
