import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api';
import type { Project, ProjectGroup, RunLogEntry, RunLogStream, RunSession, RunSessionCommandType, WorkspaceTab } from '../types';
import type { PackageManagerResolveResult, ImportNode, ProjectExitPayload } from '../api/types';
import { useNodeStore } from './node';
import { useSettingsStore } from './settings';
import { useUsageStore } from './usage';
import { useGitStore } from './git';
import { useNavMemoryStore } from './navMemory.ts';
import { useWorkspaceEditorStore } from './workspaceEditor';
import { useRunHistoryStore } from './runHistory';
import {
  getCustomCommandDisplayNameByLocale,
  getProjectCommandRunId,
  type ProjectCommandType,
} from '../utils/projectCommands';
import { resolveNodePathFromVersion, resolveProjectNodePath, resolveProjectRuntime, isExplicitNodeVersion, resolveAppDefaultNodePath } from '../utils/nodeRuntime';
import { normalizeNodeVersion, projectNodeVersionHint } from '../utils/nvm';
import { scanFrontendEnvProject } from '../utils/frontendEnvSwitcher';
import { normalizeProjectTags } from '../utils/projectTags';
import { createProjectId } from '../utils/projectId';
import { flattenImportNodeTree } from '../utils/importProjectTree';
import { MAX_PROJECT_DEPTH, normalizeProjectPath, assignSortOrders, aggregateRunningSubtreeCount, compareProjectsByPinnedThenOrder, computeManualOrderAssignments } from '../utils/projectTree';
import { classifyProjectExit, createRunSessionId, formatExitSummary, isActiveRunSession, isRunSessionActive } from '../utils/runSession';
import { MAX_SESSION_LOG_LINES, trimLogEntries } from '../utils/consoleLogs';
import {
  createProjectRunSummaryIndex,
  type ProjectRunSummary,
} from '../utils/projectRunSummary';
import { ElMessage } from 'element-plus';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([]);
  const projectGroups = ref<ProjectGroup[]>([]);
  const runningStatus = ref<Record<string, boolean>>({});
  const runningProjectCount = ref<Record<string, number>>({});
  const logs = ref<Record<string, string[]>>({});
  const partialOutput = ref<Record<string, string>>({});
  const runSessions = ref<Record<string, RunSession>>({});
  const latestSessionIdByCommand = ref<Record<string, string>>({});
  const activeSessionIdByCommand = ref<Record<string, string>>({});
  const sessionLogs = ref<Record<string, string[]>>({});
  const sessionLogEntries = ref<Record<string, RunLogEntry[]>>({});
  const sessionPartialOutput = ref<Record<string, string>>({});
  // activeProjectId 语义为「当前叶子/子项目」：命令运行、git、环境切换绑定它（ConsoleView/GitView 读取此值）
  const activeProjectId = ref<string | null>(null);
  // activeRootId 语义为「当前钻取进入的一级项目」：文件、备忘录绑定它
  const activeRootId = ref<string | null>(null);
  // 外部（如全局搜索）请求打开的根项目工作区；Dashboard 挂载或 watch 时消费并置空
  const pendingWorkspaceRootId = ref<string | null>(null);
  // 外部工作区请求中需要定位的具体项目；可为根项目或任意子项目
  const pendingWorkspaceProjectId = ref<string | null>(null);
  const requestedRightTab = ref<WorkspaceTab | null>(null);
  const requestedRightTabProjectId = ref<string | null>(null);
  const requestedRightTabToken = ref(0);
  const requestedConsoleHistoryProjectId = ref<string | null>(null);
  const requestedConsoleHistoryId = ref<string | null>(null);
  const requestedConsoleHistoryToken = ref(0);
  const runHistoryStore = useRunHistoryStore();

  // Load from local storage removed in favor of persistence.ts

  // Log buffering mechanism to optimize rendering performance
  const logBuffer: Record<string, RunLogEntry[]> = {};
  const nextLogSequence: Record<string, number> = {};
  let logFlushTimer: number | null = null;
  const backendStartedSessionIds = new Set<string>();
  const MAX_RUN_SESSIONS_PER_PROJECT = 50;

  function getProjectIdFromCommandKey(commandKey: string) {
    const separatorIndex = commandKey.indexOf(':');
    return separatorIndex === -1 ? commandKey : commandKey.slice(0, separatorIndex);
  }

  function setRunningState(commandKey: string, nextRunning: boolean) {
    const prevRunning = !!runningStatus.value[commandKey];
    if (prevRunning === nextRunning) return;

    runningStatus.value[commandKey] = nextRunning;

    const projectId = getProjectIdFromCommandKey(commandKey);
    const currentCount = runningProjectCount.value[projectId] || 0;
    const nextCount = nextRunning ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (nextCount === 0) {
      delete runningProjectCount.value[projectId];
    } else {
      runningProjectCount.value[projectId] = nextCount;
    }
  }

  /**
   * 自身 + 全部后代的运行中命令数（key = 项目 id）。
   *
   * runningProjectCount 只按发起命令的项目自身计数，所以父项目卡片看不到
   * 子项目在跑。主页的运行中徽标与「运行中」筛选都读这个聚合值。
   */
  const runningSubtreeCount = computed(() =>
    aggregateRunningSubtreeCount(projects.value, runningProjectCount.value)
  );

  const runSummaryIndex = computed(() => createProjectRunSummaryIndex(
    projects.value,
    runSessions.value,
    runHistoryStore.entries,
  ));

  function getProjectRunSummary(projectId: string): ProjectRunSummary | null {
    return runSummaryIndex.value.getProjectSummary(projectId);
  }

  function getSubtreeRunSummary(projectId: string): ProjectRunSummary | null {
    return runSummaryIndex.value.getSubtreeSummary(projectId);
  }

  function syncLegacyCommandBuckets(session: RunSession): void {
    if (latestSessionIdByCommand.value[session.commandKey] !== session.sessionId) return;
    logs.value[session.commandKey] = sessionLogs.value[session.sessionId] || [];
    if (sessionPartialOutput.value[session.sessionId] !== undefined) {
      partialOutput.value[session.commandKey] = sessionPartialOutput.value[session.sessionId];
    } else {
      delete partialOutput.value[session.commandKey];
    }
  }

  function trimSessionLogs(sessionId: string): void {
    const entries = sessionLogEntries.value[sessionId];
    if (entries && entries.length > MAX_SESSION_LOG_LINES) {
      entries.splice(0, entries.length, ...trimLogEntries(entries));
    }
    const current = sessionLogs.value[sessionId];
    if (current && current.length > MAX_SESSION_LOG_LINES) {
      current.splice(0, current.length - MAX_SESSION_LOG_LINES);
    }
  }

  function flushSessionLogBuffer(sessionId: string): void {
    const buffered = logBuffer[sessionId];
    if (!buffered?.length) return;

    const current = sessionLogs.value[sessionId];
    const entries = sessionLogEntries.value[sessionId];
    if (current && entries) {
      entries.push(...buffered);
      current.push(...buffered.map(entry => entry.text));
      trimSessionLogs(sessionId);
      const session = runSessions.value[sessionId];
      if (session) syncLegacyCommandBuckets(session);
    }
    logBuffer[sessionId] = [];
  }

  function flushLogs() {
    for (const sessionId in logBuffer) {
      flushSessionLogBuffer(sessionId);
    }
    logFlushTimer = null;
  }

  function appendSessionLogEntry(sessionId: string, text: string, stream: RunLogStream): void {
    // Runner 自身的 system 行必须排在已收到的 stdout/stderr 前面，避免
    // requestAnimationFrame 缓冲让失败摘要插到尚未刷出的输出之前。
    flushSessionLogBuffer(sessionId);
    const current = sessionLogs.value[sessionId];
    const entries = sessionLogEntries.value[sessionId];
    if (!current || !entries) return;
    const sequence = nextLogSequence[sessionId] || 0;
    nextLogSequence[sessionId] = sequence + 1;
    entries.push({ sequence, stream, text });
    current.push(text);
    trimSessionLogs(sessionId);
    const session = runSessions.value[sessionId];
    if (session) syncLegacyCommandBuckets(session);
  }

  function appendSessionLog(sessionId: string, line: string, stream: RunLogStream = 'system'): void {
    appendSessionLogEntry(sessionId, line, stream);
  }

  function pruneRunSessions(projectId: string): void {
    const activeIdSet = new Set(Object.values(activeSessionIdByCommand.value));
    const latestIdSet = new Set(Object.values(latestSessionIdByCommand.value));
    const candidates = Object.values(runSessions.value)
      .filter(session => session.projectId === projectId)
      .filter(session => !activeIdSet.has(session.sessionId) && !latestIdSet.has(session.sessionId))
      .sort((left, right) => left.startedAt - right.startedAt);

    const projectSessionCount = Object.values(runSessions.value).filter(session => session.projectId === projectId).length;
    const removeCount = Math.max(0, projectSessionCount - MAX_RUN_SESSIONS_PER_PROJECT);
    for (const session of candidates.slice(0, removeCount)) {
      delete runSessions.value[session.sessionId];
      delete sessionLogs.value[session.sessionId];
      delete sessionLogEntries.value[session.sessionId];
      delete sessionPartialOutput.value[session.sessionId];
      delete logBuffer[session.sessionId];
      delete nextLogSequence[session.sessionId];
      backendStartedSessionIds.delete(session.sessionId);
    }
  }

  function updateRunSession(sessionId: string, patch: Partial<RunSession>): RunSession | undefined {
    const session = runSessions.value[sessionId];
    if (!session) return undefined;
    Object.assign(session, patch);
    return session;
  }

  function createRunSession(
    project: Project,
    commandType: RunSessionCommandType,
    commandId: string,
    displayName: string,
  ): RunSession | null {
    const commandKey = getProjectCommandRunId(project.id, commandType, commandId);
    const currentId = activeSessionIdByCommand.value[commandKey];
    const current = currentId ? runSessions.value[currentId] : undefined;
    if (runningStatus.value[commandKey] || (current && isRunSessionActive(current.status))) return null;

    const previousLatestId = latestSessionIdByCommand.value[commandKey];
    if (previousLatestId) {
      delete sessionLogs.value[previousLatestId];
      delete sessionLogEntries.value[previousLatestId];
      delete sessionPartialOutput.value[previousLatestId];
      delete logBuffer[previousLatestId];
      delete nextLogSequence[previousLatestId];
      backendStartedSessionIds.delete(previousLatestId);
    }

    const session: RunSession = {
      sessionId: createRunSessionId(),
      commandKey,
      projectId: project.id,
      commandType,
      commandId,
      displayName,
      cwd: project.path,
      status: 'starting',
      startedAt: Date.now(),
      nodeRuntimeId: project.nodeRuntimeId,
      nodeVersion: project.nodeVersion,
      packageManager: project.packageManager,
    };

    runSessions.value[session.sessionId] = session;
    latestSessionIdByCommand.value[commandKey] = session.sessionId;
    activeSessionIdByCommand.value[commandKey] = session.sessionId;
    sessionLogs.value[session.sessionId] = [];
    sessionLogEntries.value[session.sessionId] = [];
    nextLogSequence[session.sessionId] = 0;
    logs.value[commandKey] = sessionLogs.value[session.sessionId];
    delete partialOutput.value[commandKey];

    activeProjectId.value = project.id;
    requestRightTab('console', project.id);
    setRunningState(commandKey, true);
    try { useUsageStore().recordUsage(project.id); } catch {}
    return session;
  }

  function finishRunSession(sessionId: string, payload: ProjectExitPayload): void {
    const session = runSessions.value[sessionId];
    if (!session || session.commandKey !== payload.commandKey || !isRunSessionActive(session.status)) return;

    flushSessionLogBuffer(sessionId);
    delete sessionPartialOutput.value[sessionId];

    const status = classifyProjectExit(payload);
    updateRunSession(sessionId, {
      status,
      endedAt: Date.now(),
      durationMs: Math.max(0, payload.durationMs),
      exitCode: payload.exitCode,
      errorMessage: payload.waitError,
    });
    appendSessionLog(sessionId, formatExitSummary(payload));
    backendStartedSessionIds.delete(sessionId);

    if (isActiveRunSession(activeSessionIdByCommand.value, session.commandKey, sessionId)) {
      delete activeSessionIdByCommand.value[session.commandKey];
      setRunningState(session.commandKey, false);
    }
    syncLegacyCommandBuckets(session);
    try {
      useRunHistoryStore().recordCompletedSession(session);
    } catch (error) {
      console.warn(`Failed to record run history for ${session.sessionId}`, error);
    }
    pruneRunSessions(session.projectId);
  }

  function failRunSession(sessionId: string, error: unknown): void {
    const session = runSessions.value[sessionId];
    if (!session || !isRunSessionActive(session.status)) return;
    const message = String(error);
    appendSessionLog(sessionId, `[Runner] ${message}`);
    finishRunSession(sessionId, {
      commandKey: session.commandKey,
      sessionId,
      exitCode: null,
      stopped: false,
      durationMs: Date.now() - session.startedAt,
      waitError: message,
    });
  }

  // Setup listeners. New events are routed by sessionId; an unknown/old session is ignored.
  api.onProjectOutput(({ commandKey, sessionId, stream, data, partial }) => {
    const session = runSessions.value[sessionId];
    if (!session || session.commandKey !== commandKey || !isRunSessionActive(session.status) || !sessionLogs.value[sessionId]) return;
    if (partial) {
      sessionPartialOutput.value[sessionId] = data;
      syncLegacyCommandBuckets(session);
      return;
    }
    delete sessionPartialOutput.value[sessionId];
    syncLegacyCommandBuckets(session);
    if (!logBuffer[sessionId]) logBuffer[sessionId] = [];
    const sequence = nextLogSequence[sessionId] || 0;
    nextLogSequence[sessionId] = sequence + 1;
    logBuffer[sessionId].push({
      sequence,
      stream: stream === 'stderr' ? 'stderr' : 'stdout',
      text: data,
    });

    if (!logFlushTimer) {
      logFlushTimer = requestAnimationFrame(flushLogs);
    }
  });

  api.onProjectExit((payload) => {
    finishRunSession(payload.sessionId, payload);
  });

  function addProject(project: Project) {
    projects.value.unshift(project);
    try { useUsageStore().markAdded(project.id); } catch {}
    void scanFrontendEnvForProject(project.id).catch((error) => {
      console.error(`Failed to scan frontend env for added project ${project.name}`, error);
    });
  }

  function updateProject(project: Project) {
    const index = projects.value.findIndex((p) => p.id === project.id);
    if (index !== -1) {
      projects.value[index] = project;
    }
  }

  function removeProject(id: string) {
    // 级联删除：收集自身 + 所有后代项目 id 一并移除
    const idsToRemove = collectDescendantIds(id);
    idsToRemove.add(id);

    const commandPrefixes = new Set(Array.from(idsToRemove, projectId => `${projectId}:`));
    for (const session of Object.values(runSessions.value)) {
      if (!idsToRemove.has(session.projectId)) continue;
      if (isRunSessionActive(session.status)) {
        void api.stopProjectCommand(session.commandKey).catch(error => {
          console.warn(`Failed to stop removed project session ${session.sessionId}`, error);
        });
        if (runningStatus.value[session.commandKey]) setRunningState(session.commandKey, false);
      }
      delete runSessions.value[session.sessionId];
      delete sessionLogs.value[session.sessionId];
      delete sessionLogEntries.value[session.sessionId];
      delete sessionPartialOutput.value[session.sessionId];
      delete logBuffer[session.sessionId];
      delete nextLogSequence[session.sessionId];
      backendStartedSessionIds.delete(session.sessionId);
    }
    for (const commandKey of Object.keys(latestSessionIdByCommand.value)) {
      if (Array.from(commandPrefixes).some(prefix => commandKey.startsWith(prefix))) {
        delete latestSessionIdByCommand.value[commandKey];
        delete activeSessionIdByCommand.value[commandKey];
        delete runningStatus.value[commandKey];
        delete logs.value[commandKey];
        delete partialOutput.value[commandKey];
      }
    }
    for (const commandKey of Object.keys(runningStatus.value)) {
      if (Array.from(commandPrefixes).some(prefix => commandKey.startsWith(prefix))) {
        delete runningStatus.value[commandKey];
      }
    }
    for (const projectId of idsToRemove) delete runningProjectCount.value[projectId];

    projects.value = projects.value.filter((p) => !idsToRemove.has(p.id));
    if (activeProjectId.value && idsToRemove.has(activeProjectId.value)) activeProjectId.value = null;
    if (activeRootId.value && idsToRemove.has(activeRootId.value)) activeRootId.value = null;
    try { useUsageStore().cleanupRemovedProjects(projects.value.map(p => p.id)); } catch {}
    // git store 的按项目分桶缓存（status/history/diff 等）同样要裁掉，
    // 否则删完项目它们会永久驻留。批量删除也走本函数，一处即全覆盖。
    try { useGitStore().cleanupRemovedProjects(projects.value.map(p => p.id)); } catch {}
    // 工作区导航记忆同样按项目 id 存，删完项目要一并裁掉
    try { useNavMemoryStore().cleanupRemovedProjects(projects.value.map(p => p.id)); } catch {}
    try { useWorkspaceEditorStore().cleanupRemovedProjects(projects.value.map(p => p.id)); } catch {}
    try { useRunHistoryStore().cleanupRemovedProjects(projects.value.map(p => p.id)); } catch {}
  }

  /***********************项目嵌套（多级）辅助*********************/

  /**
   * 获取指定父项目的直接子项目。
   *
   * 排序规则与一级项目列表共用 compareProjectsByPinnedThenOrder：
   * 置顶优先 → pinOrder → sortOrder。原先只按 sortOrder 排，导致子项目上的
   * 置顶按钮点了没有任何效果。
   */
  function getChildren(parentId: string): Project[] {
    return projects.value
      .filter((p) => p.parentId === parentId)
      .sort(compareProjectsByPinnedThenOrder);
  }

  /** 获取所有一级项目（无 parentId 的根项目） */
  function getRootProjects(): Project[] {
    return projects.value.filter((p) => !p.parentId);
  }

  /** 是否存在直接子项目 */
  function hasChildren(id: string): boolean {
    return projects.value.some((p) => p.parentId === id);
  }

  /** 计算项目深度：一级项目为 1，其子为 2，以此类推（含循环保护） */
  function getProjectDepth(id: string): number {
    let depth = 1;
    const seen = new Set<string>();
    let current = projects.value.find((p) => p.id === id);
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      const parentId: string = current.parentId;
      current = projects.value.find((p) => p.id === parentId);
    }
    return depth;
  }

  /** 向上回溯到最顶层的根项目 id（含循环保护）；找不到时返回入参本身 */
  function getRootProjectId(id: string): string {
    const seen = new Set<string>();
    let current = projects.value.find((p) => p.id === id);
    if (!current) return id;
    while (current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = projects.value.find((p) => p.id === current!.parentId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  }

  /** 递归收集某项目的所有后代 id（不含自身） */
  function collectDescendantIds(id: string): Set<string> {
    const result = new Set<string>();
    const walk = (parentId: string) => {
      for (const p of projects.value) {
        if (p.parentId === parentId && !result.has(p.id)) {
          result.add(p.id);
          walk(p.id);
        }
      }
    };
    walk(id);
    return result;
  }

  /** 批量创建子项目（挂到指定父项目下），跳过路径重复的项 */
  function addSubProjects(parentId: string, children: Omit<Project, 'id' | 'parentId'>[]): Project[] {
    const existingPaths = new Set(projects.value.map((p) => p.path));
    const created: Project[] = [];
    let order = getChildren(parentId).length;
    for (const child of children) {
      if (existingPaths.has(child.path)) continue;
      const newProject: Project = {
        ...child,
        id: createProjectId(),
        parentId,
        sortOrder: order++,
      };
      projects.value.push(newProject);
      existingPaths.add(newProject.path);
      created.push(newProject);
      try { useUsageStore().markAdded(newProject.id); } catch {}
      void scanFrontendEnvForProject(newProject.id).catch((error) => {
        console.error(`Failed to scan frontend env for added sub project ${newProject.name}`, error);
      });
    }
    // 更新父项目扫描时间戳
    const parent = projects.value.find((p) => p.id === parentId);
    if (parent) parent.subScannedAt = Date.now();
    return created;
  }

  /**
   * 将一棵扫描出的项目树按**真实层级**挂到指定父项目下
   * （`parentId` 为空表示作为一级项目导入）。
   *
   * 与只处理单层的 `addSubProjects` 不同：孙级会挂到它真实的父节点上，
   * 而不是被平铺成同一个父项目的直接子级。路径已存在的节点复用既有项目
   * 作为其后代的父级，超过 `MAX_PROJECT_DEPTH` 的节点直接截断丢弃。
   */
  function addProjectTree(parentId: string | undefined, nodes: ImportNode[]): Project[] {
    if (nodes.length === 0) return [];

    // 父项目自身占一层，故其子节点从 parentDepth + 1 起算。
    const parentDepth = parentId ? getProjectDepth(parentId) : 0;
    const remainingDepth = MAX_PROJECT_DEPTH - parentDepth;
    if (remainingDepth <= 0) return [];

    const existingByPath = new Map<string, string>();
    for (const project of projects.value) {
      existingByPath.set(normalizeProjectPath(project.path), project.id);
    }

    const flattened = flattenImportNodeTree(nodes, parentId, {
      resolveExistingId: (path) => existingByPath.get(normalizeProjectPath(path)),
      maxDepth: remainingDepth,
    });

    // sortOrder 按父级分桶：每个父级下的子项目各自从已有数量续号。
    const ordered = assignSortOrders(flattened, (id) => getChildren(id).length);

    const created: Project[] = [];
    const touchedParentIds = new Set<string>();
    for (const newProject of ordered) {
      const key = normalizeProjectPath(newProject.path);
      // flattenImportNodeTree 已跳过入库前就存在的路径；这里再挡一次
      // 同批次内部可能出现的重复路径。
      if (existingByPath.has(key)) continue;

      projects.value.push(newProject);
      existingByPath.set(key, newProject.id);
      created.push(newProject);
      if (newProject.parentId) touchedParentIds.add(newProject.parentId);

      try { useUsageStore().markAdded(newProject.id); } catch {}
      void scanFrontendEnvForProject(newProject.id).catch((error) => {
        console.error(`Failed to scan frontend env for added sub project ${newProject.name}`, error);
      });
    }

    // 更新所有被挂载了子项目的父项目扫描时间戳
    if (parentId) touchedParentIds.add(parentId);
    for (const id of touchedParentIds) {
      const parent = projects.value.find((p) => p.id === id);
      if (parent) parent.subScannedAt = Date.now();
    }

    return created;
  }

  /***********************收藏*********************/

  function favoriteProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (project) project.favorite = true;
  }

  function unfavoriteProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (project) project.favorite = false;
  }

  function toggleFavorite(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (project) project.favorite = !project.favorite;
  }

  function requestRightTab(tab: WorkspaceTab, projectId = activeProjectId.value) {
    requestedRightTab.value = tab;
    requestedRightTabProjectId.value = projectId;
    requestedRightTabToken.value += 1;
  }

  function requestConsoleHistory(projectId: string, historyId?: string): void {
    requestedConsoleHistoryProjectId.value = projectId;
    requestedConsoleHistoryId.value = historyId || null;
    requestedConsoleHistoryToken.value += 1;
    requestRightTab('console', projectId);
  }

  function consumeConsoleHistoryRequest(): { projectId: string | null; historyId: string | null } {
    const request = {
      projectId: requestedConsoleHistoryProjectId.value,
      historyId: requestedConsoleHistoryId.value,
    };
    requestedConsoleHistoryProjectId.value = null;
    requestedConsoleHistoryId.value = null;
    return request;
  }

  /**
   * 解析项目的包管理器可用性。
   * 返回解析结果（包含 available、commandPath、reason）。
   * 供 ProjectListItem 等组件在渲染时调用，用于判断是否禁用命令按钮。
   */
  async function resolvePmForProject(project: Project): Promise<PackageManagerResolveResult> {
    if (project.type !== 'node' || !project.packageManager) {
      return { available: true };
    }

    const nodeStore = useNodeStore();
    if (!nodeStore.versions.length) {
      await nodeStore.loadRuntimes();
    }

    const nodePath = resolveProjectNodePath(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
    const defaultNodePath = resolveAppDefaultNodePath(nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);

    const source = project.packageManagerSource || 'project';

    try {
      return await api.resolvePackageManager(nodePath, defaultNodePath, project.packageManager, source);
    } catch (_) {
      return { available: false, reason: 'unknown' };
    }
  }

  async function runProject(project: Project, script: string) {
    const commandKey = getProjectCommandRunId(project.id, 'script', script);
    if (runningStatus.value[commandKey]) return;

    const session = createRunSession(project, 'script', script, script);
    if (!session) return;
    const sessionId = session.sessionId;

    try {
      const nodeStore = useNodeStore();

      if (project.type === 'node') {
        await nodeStore.loadRuntimes();
      }
      if (runSessions.value[sessionId]?.status !== 'starting') return;

      const initialResolution = resolveProjectRuntime(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
      let nodePath = initialResolution.runtime?.path || '';

      if (initialResolution.unavailable && project.nodeRuntimeId) {
        const message = '项目绑定的 Node Runtime 不可用，请重新选择 Runtime 后再运行。';
        ElMessage.error(message);
        failRunSession(sessionId, message);
        return;
      }

      // If a specific version is configured but not installed, auto-install managed runtime
      if (!nodePath && isExplicitNodeVersion(project.nodeVersion) && nodeStore.managedSupported) {
        const version = normalizeNodeVersion(project.nodeVersion!)!;
        try {
          ElMessage.info({ message: `正在自动安装 Node ${version}...`, duration: 3000 });
          await nodeStore.installManagedNode(version);
          ElMessage.success({ message: `Node ${version} 自动安装完成`, duration: 3000 });
          nodePath = resolveProjectNodePath(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
        } catch (installError) {
          ElMessage.error(`Node ${version} 自动安装失败: ${String(installError)}`);
          console.error('Failed to auto-install node version for project run', installError);
        }
      }

      if (runSessions.value[sessionId]?.status !== 'starting') return;

      if (!nodePath && project.type === 'node') {
        try {
          const info = await api.scanProject(project.path);
          const hint = projectNodeVersionHint(info);
          nodePath = resolveNodePathFromVersion(hint, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
          if (nodePath && hint) {
            const runtime = nodeStore.versions.find(item => item.path === nodePath);
            project.nodeVersion = runtime?.version || hint;
            if (runtime) project.nodeRuntimeId = runtime.runtimeId;
          }
        } catch (error) {
          console.warn('Failed to rescan project node version before running project', error);
        }
      }

      if (runSessions.value[sessionId]?.status !== 'starting') return;

      // 解析包管理器可用性
      let pmCommandPath: string | undefined;
      let pmNodePath: string | undefined;
      if (project.type === 'node' && project.packageManager) {
        const pmResult = await resolvePmForProject(project);
        if (!pmResult.available) {
          const message = `命令不可用：${pmResult.reason || '包管理器不可用'}`;
          ElMessage.error(message);
          failRunSession(sessionId, message);
          return;
        }
        pmCommandPath = pmResult.commandPath;

        // 当来源为 default 时，需要将默认 Node 目录传给后端加入 PATH
        const source = project.packageManagerSource || 'project';
        if (source === 'default') {
          pmNodePath = resolveAppDefaultNodePath(nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime) || undefined;
        }
      }

      if (runSessions.value[sessionId]?.status !== 'starting') return;

      const runtime = nodeStore.versions.find(item => item.path === nodePath || item.runtimeId === project.nodeRuntimeId);
      updateRunSession(sessionId, {
        nodePath: nodePath || undefined,
        nodeRuntimeId: runtime?.runtimeId || project.nodeRuntimeId,
        nodeVersion: runtime?.version || project.nodeVersion,
        packageManager: project.packageManager,
      });
      appendSessionLog(sessionId, `[Runner] Starting script: ${script}`);
      appendSessionLog(sessionId, `[Runner] Project: ${project.name}`);
      appendSessionLog(sessionId, `[Runner] Package Manager: ${project.packageManager || 'npm'}`);
      appendSessionLog(sessionId, `[Runner] Node Version: ${project.nodeVersion || 'Default'}`);
      appendSessionLog(sessionId, `[Runner] Node Path: ${nodePath || 'System Default'}`);
      if (pmCommandPath) {
        appendSessionLog(sessionId, `[Runner] PM Command Path: ${pmCommandPath}`);
      }

      backendStartedSessionIds.add(sessionId);
      await api.runProjectCommand(
        commandKey,
        sessionId,
        project.path,
        script,
        project.packageManager || 'npm',
        nodePath,
        pmCommandPath,
        pmNodePath,
      );

      if (runSessions.value[sessionId]?.status === 'starting') {
        updateRunSession(sessionId, { status: 'running' });
      }
    } catch (error) {
      console.error(error);
      failRunSession(sessionId, error);
      ElMessage.error(`命令启动失败：${String(error)}`);
    }
  }

  async function runCustomCommand(project: Project, commandId: string) {
    const cmd = project.customCommands?.find((c) => c.id === commandId);
    if (!cmd) return;
    const settingsStore = useSettingsStore();

    const commandKey = getProjectCommandRunId(project.id, 'custom', cmd.id);
    if (runningStatus.value[commandKey]) return;

    const displayName = getCustomCommandDisplayNameByLocale(cmd, settingsStore.settings.locale);
    const session = createRunSession(project, 'custom', cmd.id, displayName);
    if (!session) return;
    const sessionId = session.sessionId;

    try {
      // Node 项目只要 PM 不可用，项目内所有命令都禁用
      if (project.type === 'node' && project.packageManager) {
        const pmResult = await resolvePmForProject(project);
        if (!pmResult.available) {
          const message = `命令不可用：${pmResult.reason || '包管理器不可用'}`;
          ElMessage.error(message);
          failRunSession(sessionId, message);
          return;
        }
      }
      if (runSessions.value[sessionId]?.status !== 'starting') return;

      appendSessionLog(sessionId, `[Runner] Starting custom command: ${displayName}`);
      appendSessionLog(sessionId, `[Runner] Command: ${cmd.command}`);
      appendSessionLog(sessionId, `[Runner] Project: ${project.name}`);

      backendStartedSessionIds.add(sessionId);
      await api.runCustomCommand(commandKey, sessionId, project.path, cmd.command);
      if (runSessions.value[sessionId]?.status === 'starting') {
        updateRunSession(sessionId, { status: 'running' });
      }
    } catch (error) {
      console.error(error);
      failRunSession(sessionId, error);
      ElMessage.error(`命令启动失败：${String(error)}`);
    }
  }

  async function stopProject(project: Project, commandId: string, type?: ProjectCommandType) {
    // 旧调用方只传 id 时继续按既有规则推断；新调用方传 type 后可安全处理同名命令。
    const commandType = type
      ?? (project.customCommands?.some(command => command.id === commandId) ? 'custom' : 'script');
    const commandKey = getProjectCommandRunId(project.id, commandType, commandId);
    const sessionId = activeSessionIdByCommand.value[commandKey];
    const session = sessionId ? runSessions.value[sessionId] : undefined;

    if (!session || !isRunSessionActive(session.status)) {
      if (!runningStatus.value[commandKey]) return;
      try {
        await api.stopProjectCommand(commandKey);
      } catch (error) {
        console.error(error);
        ElMessage.error(`停止失败：${String(error)}`);
      }
      return;
    }

    const previousStatus = session.status;
    updateRunSession(sessionId, { status: 'stopping' });

    // 还没进入 backend 时，直接结束本地 starting session；runProject 会在异步预检返回后放弃 spawn。
    if (!backendStartedSessionIds.has(sessionId)) {
      finishRunSession(sessionId, {
        commandKey,
        sessionId,
        exitCode: null,
        stopped: true,
        durationMs: Date.now() - session.startedAt,
      });
      return;
    }

    try {
      await api.stopProjectCommand(commandKey);
    } catch (error) {
      console.error(error);
      if (runSessions.value[sessionId]?.status === 'stopping') {
        updateRunSession(sessionId, { status: previousStatus });
      }
      ElMessage.error(`停止失败：${String(error)}`);
    }
  }

  function clearSessionOutput(sessionId: string): void {
    const session = runSessions.value[sessionId];
    if (!session) return;
    sessionLogs.value[sessionId] = [];
    sessionLogEntries.value[sessionId] = [];
    delete sessionPartialOutput.value[sessionId];
    delete logBuffer[sessionId];
    syncLegacyCommandBuckets(session);
  }

  function clearLog(commandKey: string): void {
    const sessionId = runSessions.value[commandKey]
      ? commandKey
      : latestSessionIdByCommand.value[commandKey];
    if (sessionId) {
      clearSessionOutput(sessionId);
      return;
    }
    logs.value[commandKey] = [];
    delete partialOutput.value[commandKey];
  }

  async function refreshAll() {
    const updates = await Promise.all(
      projects.value.map(async (p) => {
        try {
          await api.readDir(p.path);
        } catch {
          return p;
        }

        const [info, frontendEnvGroups] = await Promise.all([
          api.scanProject(p.path).catch((error) => {
            console.error(`Failed to refresh project ${p.name}`, error);
            return null;
          }),
          scanFrontendEnvProject(p.path, api).catch((error) => {
            console.error(`Failed to refresh frontend env for project ${p.name}`, error);
            return undefined;
          }),
        ]);

        const nextProject: Project = {
          ...p,
          frontendEnvGroups: frontendEnvGroups || p.frontendEnvGroups || [],
          frontendEnvScannedAt: frontendEnvGroups ? Date.now() : p.frontendEnvScannedAt,
        };

        if (info && p.type === 'node') {
          return { ...nextProject, scripts: info.scripts || [] };
        }

        // Java：刷新构建工具与 wrapper 状态。
        // 用户后来才 `mvn wrapper:wrapper` 生成 mvnw 的情况很常见，
        // 不刷新的话命令会一直用全局 mvn。已配好的自定义命令不动，
        // 免得覆盖用户手改过的参数。
        if (info && p.type === 'java' && info.buildTool) {
          return { ...nextProject, buildTool: info.buildTool, hasWrapper: !!info.hasWrapper };
        }

        return nextProject;
      })
    );
    projects.value = updates;
  }

  /***********************前端环境扫描*********************/

  async function scanFrontendEnvForProject(projectId: string) {
    const index = projects.value.findIndex((p) => p.id === projectId);
    if (index === -1) {
      return [];
    }

    const project = projects.value[index];
    const groups = await scanFrontendEnvProject(project.path, api);
    projects.value[index] = {
      ...project,
      frontendEnvGroups: groups,
      frontendEnvScannedAt: Date.now(),
    };

    return groups;
  }

  async function scanFrontendEnvForAll() {
    await Promise.all(
      projects.value.map((project) =>
        scanFrontendEnvForProject(project.id).catch((error) => {
          console.error(`Failed to scan frontend env for project ${project.name}`, error);
          return [];
        }),
      ),
    );
  }

  /**
   * 置顶项目：排到**同层级**的最前面。
   *
   * pinOrder 是同一 parentId 作用域内的序号，所以重排只能作用于兄弟节点。
   * 原先会把全局所有 pinned 项目的 pinOrder 一起 +1，让一级项目和各层子项目
   * 挤在同一个序号空间里互相干扰。
   */
  function pinProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    // 同层级已置顶的兄弟统一后移一位，腾出首位
    for (const p of projects.value) {
      if (p.pinned && p.id !== id && p.parentId === project.parentId) {
        p.pinOrder = (p.pinOrder ?? 0) + 1;
      }
    }
    project.pinned = true;
    project.pinOrder = 0; // 同层级首位
  }

  function unpinProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.pinned = false;
    project.pinOrder = undefined;
  }

  /**
   * 把拖拽后的顺序写回项目。
   *
   * 传入的列表必须是**同一层级**的兄弟节点（一级项目列表或某个父项目的子项目
   * 列表），因为 pinOrder / sortOrder 都是同层级内的序号。
   */
  function applyManualOrder(ordered: { id: string; pinned?: boolean }[]) {
    const projectMap = new Map(projects.value.map((p) => [p.id, p]));
    for (const assignment of computeManualOrderAssignments(ordered)) {
      const project = projectMap.get(assignment.id);
      if (!project) continue;
      if (assignment.pinOrder !== undefined) project.pinOrder = assignment.pinOrder;
      if (assignment.sortOrder !== undefined) project.sortOrder = assignment.sortOrder;
    }
  }

  /***********************批量选择状态*********************/

  /** 批量模式：仅在 UI 主动开启时使用，不影响普通选中项目 */
  const batchMode = ref(false);
  const selectedIds = ref<Set<string>>(new Set());

  function enterBatchMode(initialIds: string[] = []) {
    batchMode.value = true;
    selectedIds.value = new Set(initialIds);
  }

  function exitBatchMode() {
    batchMode.value = false;
    selectedIds.value = new Set();
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  }

  function selectAllVisible(ids: string[]) {
    selectedIds.value = new Set(ids);
  }

  function clearSelection() {
    selectedIds.value = new Set();
  }

  /** 对一组项目并发应用 partial 更新；遇失败不抛，返回失败 id 集合 */
  async function batchUpdate(ids: string[], patch: Partial<Project>): Promise<{ updated: string[]; failed: string[] }> {
    const targets = ids
      .map((id) => projects.value.find((p) => p.id === id))
      .filter((p): p is Project => !!p);
    const updated: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      targets.map(async (p) => {
        try {
          Object.assign(p, patch);
          updated.push(p.id);
        } catch (e) {
          console.error('batchUpdate failed for', p.id, e);
          failed.push(p.id);
        }
      })
    );
    return { updated, failed };
  }

  /** 批量添加/删除标签（add=true 添加，否则移除） */
  async function batchSetTags(ids: string[], tags: string[], add: boolean): Promise<void> {
    const normalizedTags = normalizeProjectTags(tags);
    const targets = ids
      .map((id) => projects.value.find((p) => p.id === id))
      .filter((p): p is Project => !!p);
    for (const p of targets) {
      const set = new Set(p.tags ?? []);
      for (const t of normalizedTags) {
        if (add) set.add(t);
        else set.delete(t);
      }
      p.tags = normalizeProjectTags(Array.from(set));
    }
  }

  /** 批量删除项目 */
  async function batchRemove(ids: string[]): Promise<void> {
    for (const id of ids) {
      removeProject(id);
    }
  }

  /***********************项目分组管理*********************/

  /** 新增分组 */
  function addProjectGroup(group: Omit<ProjectGroup, 'id'>) {
    projectGroups.value.push({
      id: crypto.randomUUID(),
      ...group,
    });
  }

  /** 更新分组（合并 patch） */
  function updateProjectGroup(id: string, patch: Partial<Omit<ProjectGroup, 'id'>>) {
    const group = projectGroups.value.find((g) => g.id === id);
    if (!group) return;
    Object.assign(group, patch);
  }

  /** 删除分组，并把该分组下的项目 groupId 清空（不删除项目） */
  function removeProjectGroup(id: string) {
    projectGroups.value = projectGroups.value.filter((g) => g.id !== id);
    for (const p of projects.value) {
      if (p.groupId === id) {
        p.groupId = undefined;
      }
    }
  }

  /** 切换分组折叠状态 */
  function toggleProjectGroupCollapsed(id: string) {
    const group = projectGroups.value.find((g) => g.id === id);
    if (!group) return;
    group.collapsed = !group.collapsed;
  }

  return {
    projects,
    projectGroups,
    runningStatus,
    runningProjectCount,
    runningSubtreeCount,
    logs,
    partialOutput,
    runSessions,
    latestSessionIdByCommand,
    activeSessionIdByCommand,
    sessionLogs,
    sessionLogEntries,
    sessionPartialOutput,
    activeProjectId,
    activeRootId,
    pendingWorkspaceRootId,
    pendingWorkspaceProjectId,
    requestedRightTab,
    requestedRightTabProjectId,
    requestedRightTabToken,
    addProject,
    updateProject,
    removeProject,
    getChildren,
    getRootProjects,
    hasChildren,
    getProjectDepth,
    getRootProjectId,
    collectDescendantIds,
    addSubProjects,
    addProjectTree,
    favoriteProject,
    unfavoriteProject,
    toggleFavorite,
    requestRightTab,
    requestedConsoleHistoryProjectId,
    requestedConsoleHistoryId,
    requestedConsoleHistoryToken,
    requestConsoleHistory,
    consumeConsoleHistoryRequest,
    getProjectRunSummary,
    getSubtreeRunSummary,
    runProject,
    runCustomCommand,
    stopProject,
    resolvePmForProject,
    clearLog,
    clearSessionOutput,
    refreshAll,
    scanFrontendEnvForProject,
    scanFrontendEnvForAll,
    pinProject,
    unpinProject,
    applyManualOrder,
    addProjectGroup,
    updateProjectGroup,
    removeProjectGroup,
    toggleProjectGroupCollapsed,
    batchMode,
    selectedIds,
    enterBatchMode,
    exitBatchMode,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    batchUpdate,
    batchSetTags,
    batchRemove,
  };
});
