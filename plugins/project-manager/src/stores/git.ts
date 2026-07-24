import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import { requestAiChatCompletion, requestAiText } from '../utils/ai';
import type {
  AiServiceConfig,
  GitStatusResult,
  GitBranch,
  GitCommit,
  GitCommitFile,
  GitSummary,
} from '../types';

const REPO_CHECK_MAX_AGE = 60_000;
const SUMMARY_STATUS_MAX_AGE = 15_000;
const HISTORY_MAX_AGE = 45_000;
type GitOperationKind =
  | 'stage'
  | 'unstage'
  | 'stageAll'
  | 'unstageAll'
  | 'commit'
  | 'pull'
  | 'push'
  | 'fetch'
  | 'switchBranch'
  | 'createBranch'
  | 'deleteBranch'
  | 'renameBranch'
  | 'revertHunk'
  | 'discard'
  | 'discardUntracked';

export const useGitStore = defineStore('git', () => {
  // ─── State ───────────────────────────────────────────────────────────────
  const isGitRepo = ref<Record<string, boolean>>({});
  const summary = ref<Record<string, GitSummary>>({});
  const status = ref<Record<string, GitStatusResult>>({});
  const history = ref<Record<string, GitCommit[]>>({});
  const branches = ref<Record<string, GitBranch[]>>({});
  const commitDetails = ref<Record<string, Record<string, GitCommit>>>({});

  // Current diff (not project-scoped – just the currently viewed diff)
  const selectedDiff = ref('');
  const selectedDiffFile = ref('');
  const selectedDiffStaged = ref(false);

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
  let loadingCount = 0;

  // ─── Getters ─────────────────────────────────────────────────────────────

  function getSummary(projectId: string): GitSummary | undefined {
    return summary.value[projectId];
  }

  function getStatus(projectId: string): GitStatusResult | undefined {
    return status.value[projectId];
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
    if (!s) return 0;
    return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length;
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
    kind: GitOperationKind,
    task: (operationId?: string) => Promise<T>,
    options: { cancellable?: boolean } = {},
  ): Promise<T> {
    operationLoading.value = true;
    activeOperationKind.value = kind;
    operationCancellable.value = options.cancellable ?? false;
    operationCancelling.value = false;
    activeOperationId.value = operationCancellable.value ? crypto.randomUUID() : null;
    await waitForUiPaint();
    try {
      return await task(activeOperationId.value || undefined);
    } finally {
      operationLoading.value = false;
      activeOperationKind.value = null;
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
      // Clear diff if the selected file no longer exists in the status
      if (selectedDiffFile.value) {
        const s = status.value[projectId];
        const fileStillExists = s && [
          ...s.staged,
          ...s.unstaged,
          ...s.untracked,
          ...s.conflicted,
        ].some(f => f.path === selectedDiffFile.value);
        if (!fileStillExists) {
          clearDiff();
        }
      }
    } catch (e) {
      console.error('Failed to get git status:', e);
    }
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

  async function refreshBranches(projectId: string, path: string): Promise<void> {
    try {
      branches.value[projectId] = await api.gitListBranches(path);
    } catch (e) {
      console.error('Failed to get branches:', e);
    }
  }

  // ─── Git Operations ──────────────────────────────────────────────────────

  async function stageFiles(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading('stage', async () => {
      await api.gitStage(path, files);
      await refreshStatus(projectId, path);
    });
  }

  async function unstageFiles(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading('unstage', async () => {
      await api.gitUnstage(path, files);
      await refreshStatus(projectId, path);
    });
  }

  async function stageAll(projectId: string, path: string): Promise<void> {
    await withOperationLoading('stageAll', async () => {
      await api.gitStageAll(path);
      await refreshStatus(projectId, path);
    });
  }

  async function unstageAll(projectId: string, path: string): Promise<void> {
    await withOperationLoading('unstageAll', async () => {
      await api.gitUnstageAll(path);
      await refreshStatus(projectId, path);
    });
  }

  async function commit(projectId: string, path: string, message: string): Promise<string> {
    return withOperationLoading('commit', async () => {
      const result = await api.gitCommit(path, message);
      clearDiff();
      await refreshSummaryAndStatus(projectId, path);
      return result;
    });
  }

  async function pull(projectId: string, path: string, remote?: string, branch?: string): Promise<string> {
    return withOperationLoading('pull', async (operationId) => {
      const result = await api.gitPull(path, remote, branch, operationId);
      await refreshSummaryAndStatus(projectId, path);
      return result;
    }, { cancellable: true });
  }

  async function push(projectId: string, path: string, remote?: string, branch?: string, force?: boolean, setUpstream?: boolean): Promise<string> {
    return withOperationLoading('push', async (operationId) => {
      const result = await api.gitPush(path, remote, branch, force, setUpstream, operationId);
      await refreshSummary(projectId, path);
      return result;
    }, { cancellable: true });
  }

  async function fetch(projectId: string, path: string, remote?: string): Promise<string> {
    return withOperationLoading('fetch', async (operationId) => {
      const result = await api.gitFetch(path, remote, operationId);
      await refreshSummary(projectId, path);
      return result;
    }, { cancellable: true });
  }

  async function switchBranch(projectId: string, path: string, branch: string): Promise<string> {
    return withOperationLoading('switchBranch', async () => {
      const result = await api.gitSwitchBranch(path, branch);
      await refreshSummaryAndStatus(projectId, path);
      return result;
    });
  }

  async function createAndSwitchBranch(projectId: string, path: string, name: string, startPoint?: string): Promise<string> {
    return withOperationLoading('createBranch', async () => {
      const result = await api.gitCreateAndSwitchBranch(path, name, startPoint);
      await refreshSummaryAndStatus(projectId, path);
      return result;
    });
  }

  async function deleteBranch(projectId: string, path: string, name: string, force?: boolean): Promise<string> {
    return withOperationLoading('deleteBranch', async () => {
      const result = await api.gitDeleteBranch(path, name, force);
      await refreshBranches(projectId, path);
      return result;
    });
  }

  async function renameBranch(projectId: string, path: string, oldName: string, newName: string): Promise<string> {
    return withOperationLoading('renameBranch', async () => {
      const result = await api.gitRenameBranch(path, oldName, newName);
      await refreshSummary(projectId, path);
      return result;
    });
  }

  async function getDiff(path: string, file?: string, staged?: boolean): Promise<string> {
    const result = await api.gitDiff(path, file, staged);
    selectedDiff.value = result;
    selectedDiffFile.value = file || '';
    selectedDiffStaged.value = staged || false;
    return result;
  }

  async function getDiffCommit(path: string, hash: string): Promise<string> {
    const result = await api.gitDiffCommit(path, hash);
    selectedDiff.value = result;
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

  async function getDiffCommitFile(path: string, hash: string, file: string): Promise<string> {
    const result = await api.gitDiffCommitFile(path, hash, file);
    selectedDiff.value = result;
    selectedDiffFile.value = file;
    return result;
  }

  async function revertHunk(projectId: string, path: string, patch: string, staged?: boolean): Promise<string> {
    return withOperationLoading('revertHunk', async () => {
      const result = await api.gitRevertHunk(path, patch, staged);
      await refreshStatus(projectId, path);
      if (selectedDiffFile.value) {
        await getDiff(path, selectedDiffFile.value, selectedDiffStaged.value);
      }
      return result;
    });
  }

  async function generateAiCommitMessage(
    projectId: string,
    path: string,
    settings: {
      baseUrl: string;
      apiKey: string;
      model: string;
      promptTemplate?: string;
    }
  ): Promise<string> {
    // Get staged diff
    const diff = await api.gitDiff(path, undefined, true);
    if (!diff.trim()) {
      throw new Error('no_staged');
    }

    const systemPrompt = settings.promptTemplate?.trim() ||
      `生成提交信息时，请遵循以下规范：
1. 第一行使用 Conventional Commits 格式：<type>(<scope>): <简短描述>，type 为 feat/fix/refactor/chore/docs/style/test/perf 之一，scope 为本次改动涉及的模块或文件名。
2. 第一行之后空一行，然后写正文（body），正文要简略说明：做了哪些具体改动。
3. 使用中文撰写正文，第一行可用中文或英文。
4. 正文每行不超过 72 个字符。
5. 只输出提交信息本身，不要输出额外解释文字。`;

    const data = await requestAiChatCompletion({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Git diff:\n\`\`\`\n${diff}\n\`\`\`` },
      ],
      maxTokens: 200,
      temperature: 0.3,
      stream: true,
    });
    void projectId; // suppress unused warning
    return data;
  }

  void generateAiCommitMessage;

  async function discardFiles(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading('discard', async () => {
      await api.gitDiscard(path, files);
      await refreshStatus(projectId, path);
    });
  }

  async function generateAiCommitMessageV2(
    projectId: string,
    path: string,
    settings: {
      baseUrl: string;
      apiKey: string;
      model: string;
      promptTemplate?: string;
    }
  ): Promise<string> {
    const diff = await api.gitDiff(path, undefined, true);
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

    const content = await requestAiChatCompletion({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Git diff:\n\`\`\`\n${diff}\n\`\`\`` },
      ],
      maxTokens: 200,
      temperature: 0.3,
    });

    void projectId;
    return content;
  }

  void generateAiCommitMessageV2;

  async function generateAiCommitMessageV3(
    projectId: string,
    path: string,
    settings: {
      service: Partial<AiServiceConfig> | null | undefined;
      promptTemplate?: string;
      stream?: boolean;
    }
  ): Promise<string> {
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

    const service = settings.service;
    if (!service?.baseUrl?.trim() || !service?.apiKey?.trim() || !service?.model?.trim()) {
      throw new Error('No configured AI service is available.');
    }

    const content = await requestAiText({
      apiType: service.apiType,
      baseUrl: service.baseUrl,
      apiKey: service.apiKey,
      model: service.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Git diff:\n\`\`\`\n${diff}\n\`\`\`` },
      ],
      maxTokens: 200,
      temperature: 0.3,
      stream: settings.stream,
    });

    void projectId;
    return content;
  }

  async function discardUntracked(projectId: string, path: string, files: string[]): Promise<void> {
    await withOperationLoading('discardUntracked', async () => {
      await api.gitDiscardUntracked(path, files);
      await refreshStatus(projectId, path);
    });
  }

  function clearDiff(): void {
    selectedDiff.value = '';
    selectedDiffFile.value = '';
    selectedDiffStaged.value = false;
  }

  return {
    // State
    isGitRepo,
    summary,
    status,
    history,
    branches,
    commitDetails,
    selectedDiff,
    selectedDiffFile,
    selectedDiffStaged,
    commitFiles,
    selectedCommitHash,
    commitMessage,
    loading,
    operationLoading,
    activeOperationKind,
    operationCancellable,
    operationCancelling,
    coldStorage,

    // Getters
    getSummary,
    getStatus,
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
    ensureSummaryAndStatus,
    ensureHistory,
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
    pull,
    push,
    fetch,
    switchBranch,
    createAndSwitchBranch,
    deleteBranch,
    renameBranch,
    getDiff,
    getDiffCommit,
    getDiffCommitFile,
    revertHunk,
    discardFiles,
    discardUntracked,
    cancelActiveOperation,
    clearDiff,
    generateAiCommitMessage: generateAiCommitMessageV3,
  };
});
