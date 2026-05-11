import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type { Project } from '../types';
import { useNodeStore } from './node';
import { useSettingsStore } from './settings';
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
    projects.value.push(project);
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
  }

  function requestRightTab(tab: WorkspaceTab) {
    requestedRightTab.value = tab;
    requestedRightTabToken.value += 1;
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

    try {
      logs.value[runId] = [];

      activeProjectId.value = project.id;
      requestRightTab('console');
      setRunningState(runId, true);

      logs.value[runId].push(`[Runner] Starting script: ${script}`);
      logs.value[runId].push(`[Runner] Project: ${project.name}`);
      logs.value[runId].push(`[Runner] Package Manager: ${project.packageManager || 'npm'}`);
      logs.value[runId].push(`[Runner] Node Version: ${project.nodeVersion || 'Default'}`);
      logs.value[runId].push(`[Runner] Node Path: ${nodePath || 'System Default'}`);

      await api.runProjectCommand(
        runId,
        project.path,
        script,
        project.packageManager || 'npm',
        nodePath
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

    try {
      logs.value[runId] = [];
      activeProjectId.value = project.id;
      requestRightTab('console');
      setRunningState(runId, true);

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
    project.pinned = true;
    // Set pinOrder to be the max + 1 among pinned projects
    const maxOrder = projects.value
      .filter((p) => p.pinned && p.id !== id)
      .reduce((max, p) => Math.max(max, p.pinOrder ?? 0), 0);
    project.pinOrder = maxOrder + 1;
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
    clearLog,
    refreshAll,
    pinProject,
    unpinProject,
  };
});
