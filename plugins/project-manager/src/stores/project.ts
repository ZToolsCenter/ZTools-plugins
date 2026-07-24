import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type { Project } from '../types';
import type { PackageManagerResolveResult } from '../api/types';
import { useNodeStore } from './node';
import { useSettingsStore } from './settings';
import { useUsageStore } from './usage';
import { getCustomCommandDisplayNameByLocale } from '../utils/projectCommands';
import { resolveNodePathFromVersion, resolveProjectNodePath, isExplicitNodeVersion } from '../utils/nodeRuntime';
import { normalizeNvmVersion } from '../utils/nvm';
import { ElMessage } from 'element-plus';

type WorkspaceTab = 'console' | 'git' | 'files' | 'memo';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([]);
  const runningStatus = ref<Record<string, boolean>>({});
  const runningProjectCount = ref<Record<string, number>>({});
  const logs = ref<Record<string, string[]>>({});
  const activeProjectId = ref<string | null>(null);
  const requestedRightTab = ref<WorkspaceTab | null>(null);
  const requestedRightTabToken = ref(0);

  // Load from local storage removed in favor of persistence.ts

  // Log buffering mechanism to optimize rendering performance
  const logBuffer: Record<string, string[]> = {};
  let logFlushTimer: number | null = null;

  function getProjectIdFromRunId(runId: string) {
    const separatorIndex = runId.indexOf(':');
    return separatorIndex === -1 ? runId : runId.slice(0, separatorIndex);
  }

  function setRunningState(runId: string, nextRunning: boolean) {
    const prevRunning = !!runningStatus.value[runId];
    if (prevRunning === nextRunning) return;

    runningStatus.value[runId] = nextRunning;

    const projectId = getProjectIdFromRunId(runId);
    const currentCount = runningProjectCount.value[projectId] || 0;
    const nextCount = nextRunning ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (nextCount === 0) {
      delete runningProjectCount.value[projectId];
    } else {
      runningProjectCount.value[projectId] = nextCount;
    }
  }

  function flushLogs() {
    for (const id in logBuffer) {
      if (logBuffer[id].length > 0) {
        if (!logs.value[id]) logs.value[id] = [];
        // Use spread to push multiple items at once, reducing reactivity triggers
        logs.value[id].push(...logBuffer[id]);

        // Keep logs within limit (e.g., 2000 lines to allow scrolling back a bit, ConsoleView shows 500)
        if (logs.value[id].length > 2000) {
          logs.value[id] = logs.value[id].slice(-2000);
        }

        logBuffer[id] = [];
      }
    }
    logFlushTimer = null;
  }

  // Setup listeners
  api.onProjectOutput(({ id, data }) => {
    if (!logBuffer[id]) logBuffer[id] = [];
    logBuffer[id].push(data);

    if (!logFlushTimer) {
      // Use requestAnimationFrame for smooth UI updates, or setTimeout for throttling
      // requestAnimationFrame might pause in background tabs, but that's usually fine
      logFlushTimer = requestAnimationFrame(flushLogs);
    }
  });

  api.onProjectExit(({ id }) => {
    setRunningState(id, false);
    // Ensure any buffered logs are flushed first
    if (logBuffer[id] && logBuffer[id].length > 0) {
      if (!logs.value[id]) logs.value[id] = [];
      logs.value[id].push(...logBuffer[id]);
      logBuffer[id] = [];
    }
    if (!logs.value[id]) logs.value[id] = [];
    logs.value[id].push('[Process exited]');
  });

  function addProject(project: Project) {
    projects.value.unshift(project);
    try { useUsageStore().markAdded(project.id); } catch {}
  }

  function updateProject(project: Project) {
    const index = projects.value.findIndex((p) => p.id === project.id);
    if (index !== -1) {
      projects.value[index] = project;
    }
  }

  function removeProject(id: string) {
    projects.value = projects.value.filter((p) => p.id !== id);
    if (activeProjectId.value === id) activeProjectId.value = null;
    try { useUsageStore().cleanupRemovedProjects(projects.value.map(p => p.id)); } catch {}
  }

  function requestRightTab(tab: WorkspaceTab) {
    requestedRightTab.value = tab;
    requestedRightTabToken.value += 1;
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
      await nodeStore.loadNvmNodes();
    }

    const nodePath = resolveProjectNodePath(project, nodeStore.versions);
    let defaultNodePath = '';
    try {
      defaultNodePath = await api.getSystemNodePath();
    } catch (_) {}

    const source = project.packageManagerSource || 'project';

    try {
      return await api.resolvePackageManager(nodePath, defaultNodePath, project.packageManager, source);
    } catch (_) {
      return { available: false, reason: 'unknown' };
    }
  }

  async function runProject(project: Project, script: string) {
    const runId = `${project.id}:${script}`;

    if (runningStatus.value[runId]) return;

    const nodeStore = useNodeStore();

    // Ensure node versions are loaded
    if (project.type === 'node') {
      await nodeStore.loadNvmNodes();
    }

    let nodePath = resolveProjectNodePath(project, nodeStore.versions);

    // If a specific version is configured but not installed, auto-install it
    if (!nodePath && isExplicitNodeVersion(project.nodeVersion)) {
      const version = normalizeNvmVersion(project.nodeVersion!)!;
      try {
        ElMessage.info({ message: `正在自动安装 Node ${version}...`, duration: 3000 });
        await nodeStore.installNode(version);
        ElMessage.success({ message: `Node ${version} 自动安装完成`, duration: 3000 });
        nodePath = resolveProjectNodePath(project, nodeStore.versions);
      } catch (installError) {
        ElMessage.error(`Node ${version} 自动安装失败: ${String(installError)}`);
        console.error('Failed to auto-install node version for project run', installError);
      }
    }

    if (!nodePath && project.type === 'node') {
      try {
        const info: any = await api.scanProject(project.path);
        nodePath = resolveNodePathFromVersion(info.nvmVersion, nodeStore.versions);
        if (nodePath && info.nvmVersion) {
          project.nodeVersion = info.nvmVersion;
        }
      } catch (error) {
        console.warn('Failed to rescan project node version before running project', error);
      }
    }

    // 解析包管理器可用性
    let pmCommandPath: string | undefined;
    let pmNodePath: string | undefined;
    if (project.type === 'node' && project.packageManager) {
      const pmResult = await resolvePmForProject(project);
      if (!pmResult.available) {
        // 构建禁用原因日志
        ElMessage.error(`命令不可用：${pmResult.reason || '包管理器不可用'}`);
        return;
      }
      pmCommandPath = pmResult.commandPath;

      // 当来源为 default 时，需要将默认 Node 目录传给后端加入 PATH
      const source = project.packageManagerSource || 'project';
      if (source === 'default') {
        try {
          const defaultNodePath = await api.getSystemNodePath();
          if (defaultNodePath) {
            pmNodePath = defaultNodePath;
          }
        } catch (_) {}
      }
    }

    try {
      logs.value[runId] = [];

      activeProjectId.value = project.id;
      requestRightTab('console');
      setRunningState(runId, true);
      try { useUsageStore().recordUsage(project.id); } catch {}

      logs.value[runId].push(`[Runner] Starting script: ${script}`);
      logs.value[runId].push(`[Runner] Project: ${project.name}`);
      logs.value[runId].push(`[Runner] Package Manager: ${project.packageManager || 'npm'}`);
      logs.value[runId].push(`[Runner] Node Version: ${project.nodeVersion || 'Default'}`);
      logs.value[runId].push(`[Runner] Node Path: ${nodePath || 'System Default'}`);
      if (pmCommandPath) {
        logs.value[runId].push(`[Runner] PM Command Path: ${pmCommandPath}`);
      }

      await api.runProjectCommand(
        runId,
        project.path,
        script,
        project.packageManager || 'npm',
        nodePath,
        pmCommandPath,
        pmNodePath
      );
    } catch (e) {
      console.error(e);
      setRunningState(runId, false);
      logs.value[runId].push(`Error starting project: ${e}`);
    }
  }

  async function runCustomCommand(project: Project, commandId: string) {
    const cmd = project.customCommands?.find((c) => c.id === commandId);
    if (!cmd) return;
    const settingsStore = useSettingsStore();

    const runId = `${project.id}:${cmd.id}`;

    if (runningStatus.value[runId]) return;

    // Node 项目只要 PM 不可用，项目内所有命令都禁用
    if (project.type === 'node' && project.packageManager) {
      const pmResult = await resolvePmForProject(project);
      if (!pmResult.available) {
        ElMessage.error(`命令不可用：${pmResult.reason || '包管理器不可用'}`);
        return;
      }
    }

    try {
      logs.value[runId] = [];
      activeProjectId.value = project.id;
      requestRightTab('console');
      setRunningState(runId, true);
      try { useUsageStore().recordUsage(project.id); } catch {}

      logs.value[runId].push(
        `[Runner] Starting custom command: ${getCustomCommandDisplayNameByLocale(cmd, settingsStore.settings.locale)}`
      );
      logs.value[runId].push(`[Runner] Command: ${cmd.command}`);
      logs.value[runId].push(`[Runner] Project: ${project.name}`);

      await api.runCustomCommand(runId, project.path, cmd.command);
    } catch (e) {
      console.error(e);
      setRunningState(runId, false);
      logs.value[runId].push(`Error starting command: ${e}`);
    }
  }

  async function stopProject(project: Project, script: string) {
    const runId = `${project.id}:${script}`;
    try {
      await api.stopProjectCommand(runId);
    } catch (e) {
      console.error(e);
    }
  }

  function clearLog(runId: string) {
    logs.value[runId] = [];
  }

  async function refreshAll() {
    const updates = await Promise.all(
      projects.value.map(async (p) => {
        try {
          const info: any = await api.scanProject(p.path);
          if (p.type === 'node') {
            return { ...p, scripts: info.scripts || [] };
          }
          return p;
        } catch (e) {
          console.error(`Failed to refresh project ${p.name}`, e);
          return p;
        }
      })
    );
    projects.value = updates;
  }

  function pinProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    // Bump all existing pinned projects down by 1
    for (const p of projects.value) {
      if (p.pinned && p.id !== id) {
        p.pinOrder = (p.pinOrder ?? 0) + 1;
      }
    }
    project.pinned = true;
    project.pinOrder = 0; // Top position
  }

  function unpinProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.pinned = false;
    project.pinOrder = undefined;
  }

  return {
    projects,
    runningStatus,
    runningProjectCount,
    logs,
    activeProjectId,
    requestedRightTab,
    requestedRightTabToken,
    addProject,
    updateProject,
    removeProject,
    requestRightTab,
    runProject,
    runCustomCommand,
    stopProject,
    resolvePmForProject,
    clearLog,
    refreshAll,
    pinProject,
    unpinProject,
  };
});
