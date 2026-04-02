import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type { Project } from '../types';
import { useNodeStore } from './node';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([]);
  const runningStatus = ref<Record<string, boolean>>({});
  const logs = ref<Record<string, string[]>>({});
  const activeProjectId = ref<string | null>(null);

  // Load from local storage removed in favor of persistence.ts
  
  // Log buffering mechanism to optimize rendering performance
  const logBuffer: Record<string, string[]> = {};
  let logFlushTimer: number | null = null;

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
      runningStatus.value[id] = false;
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
    const index = projects.value.findIndex(p => p.id === project.id);
    if (index !== -1) {
      projects.value[index] = project;
    }
  }

  function removeProject(id: string) {
    projects.value = projects.value.filter(p => p.id !== id);
    if (activeProjectId.value === id) activeProjectId.value = null;
  }

  async function runProject(project: Project, script: string) {
    const runId = `${project.id}:${script}`;
    
    if (runningStatus.value[runId]) return;

    const nodeStore = useNodeStore();
    
    // Ensure node versions are loaded
    if (nodeStore.versions.length === 0) {
        await nodeStore.loadNvmNodes();
    }
    
    let nodePath = '';
    
    // Find matching node version
    if (project.nodeVersion) {
        // If it's a version string like "v18.0.0", find it
        const node = nodeStore.versions.find(v => v.version === project.nodeVersion);
        if (node) {
            nodePath = node.path;
        } else if (project.nodeVersion === '默认' || project.nodeVersion === 'Default') {
             // System default
             const systemNode = nodeStore.versions.find(v => v.source === 'system');
             if (systemNode) nodePath = systemNode.path;
        }
    }
    
    if (nodePath === 'System Default') nodePath = '';

    try {
        logs.value[runId] = []; 
        
        activeProjectId.value = project.id;
        runningStatus.value[runId] = true;
        
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
        runningStatus.value[runId] = false;
        logs.value[runId].push(`Error starting project: ${e}`);
    }
  }

  async function runCustomCommand(project: Project, commandId: string) {
    const cmd = project.customCommands?.find(c => c.id === commandId);
    if (!cmd) return;

    const runId = `${project.id}:${cmd.id}`;

    if (runningStatus.value[runId]) return;

    try {
        logs.value[runId] = [];
        activeProjectId.value = project.id;
        runningStatus.value[runId] = true;

        logs.value[runId].push(`[Runner] Starting custom command: ${cmd.name}`);
        logs.value[runId].push(`[Runner] Command: ${cmd.command}`);
        logs.value[runId].push(`[Runner] Project: ${project.name}`);

        await api.runCustomCommand(runId, project.path, cmd.command);
    } catch (e) {
        console.error(e);
        runningStatus.value[runId] = false;
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
    const updates = await Promise.all(projects.value.map(async (p) => {
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
    }));
    projects.value = updates;
  }

  function pinProject(id: string) {
    const project = projects.value.find(p => p.id === id);
    if (!project) return;
    project.pinned = true;
    // Set pinOrder to be the max + 1 among pinned projects
    const maxOrder = projects.value
      .filter(p => p.pinned && p.id !== id)
      .reduce((max, p) => Math.max(max, p.pinOrder ?? 0), 0);
    project.pinOrder = maxOrder + 1;
  }

  function unpinProject(id: string) {
    const project = projects.value.find(p => p.id === id);
    if (!project) return;
    project.pinned = false;
    project.pinOrder = undefined;
  }

  return {
    projects,
    runningStatus,
    logs,
    activeProjectId,
    addProject,
    updateProject,
    removeProject,
    runProject,
    runCustomCommand,
    stopProject,
    clearLog,
    refreshAll,
    pinProject,
    unpinProject
  };
});
