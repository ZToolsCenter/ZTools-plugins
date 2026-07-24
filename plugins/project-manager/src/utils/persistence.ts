import { api } from '../api';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { useNodeStore } from '../stores/node';
import { useUsageStore } from '../stores/usage';
import type { NodeVersion, Project, Settings, UsageData } from '../types';
import { ensureNodeInstallCommand } from './projectCommands';

const FILE_NAME = 'data.json';
const SAVE_DEBOUNCE_MS = 800;
const SAVE_IDLE_TIMEOUT_MS = 2000;

type PersistedData = {
  projects: Project[];
  settings: Settings;
  customNodes: NodeVersion[];
  usageData?: UsageData;
};

type IdleCallbackHandle = number;
type IdleCallbackDeadline = { didTimeout: boolean; timeRemaining: () => number };

let saveTimer: number | null = null;
let saveIdleHandle: IdleCallbackHandle | null = null;
let saveInFlight = false;
let saveQueued = false;
let lastSerializedData = '';

function buildPersistedData(): PersistedData {
  const projectStore = useProjectStore();
  const settingsStore = useSettingsStore();
  const nodeStore = useNodeStore();
  const usageStore = useUsageStore();

  return {
    projects: projectStore.projects,
    settings: settingsStore.settings,
    customNodes: nodeStore.versions.filter(v => v.source === 'custom'),
    usageData: usageStore.usageData,
  };
}

function serializePersistedData(): string {
  return JSON.stringify(buildPersistedData(), null, 2);
}

function clearScheduledSave() {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: (deadline: IdleCallbackDeadline) => void, options?: { timeout?: number }) => IdleCallbackHandle;
    cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
  };

  if (saveIdleHandle !== null) {
    if (idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(saveIdleHandle);
    } else {
      window.clearTimeout(saveIdleHandle);
    }
    saveIdleHandle = null;
  }
}

export async function saveData(force = false) {
  try {
    const serialized = serializePersistedData();
    if (!force && serialized === lastSerializedData) {
      return;
    }

    if (saveInFlight) {
      saveQueued = true;
      return;
    }

    saveInFlight = true;
    await api.writeConfigFile(FILE_NAME, serialized);
    lastSerializedData = serialized;
    console.log('Data saved to', FILE_NAME);
  } catch (e) {
    console.error('Failed to save data:', e);
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      void saveData();
    }
  }
}

export function scheduleSaveData() {
  clearScheduledSave();

  saveTimer = window.setTimeout(() => {
    saveTimer = null;

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: (deadline: IdleCallbackDeadline) => void, options?: { timeout?: number }) => IdleCallbackHandle;
    };

    if (idleWindow.requestIdleCallback) {
      saveIdleHandle = idleWindow.requestIdleCallback(() => {
        saveIdleHandle = null;
        void saveData();
      }, { timeout: SAVE_IDLE_TIMEOUT_MS });
      return;
    }

    saveIdleHandle = window.setTimeout(() => {
      saveIdleHandle = null;
      void saveData();
    }, 200);
  }, SAVE_DEBOUNCE_MS);
}

export async function flushPendingSave() {
  clearScheduledSave();
  await saveData(true);
}

export async function loadData() {
  try {
    const content = await api.readConfigFile(FILE_NAME);
    if (!content) return;
    let normalizedDataChanged = false;

    let data: any;
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse config file:', e);
      return;
    }

    if (data.projects) {
      const projectStore = useProjectStore();
      const settingsStore = useSettingsStore();
      const installCommandName = settingsStore.settings.locale === 'en' ? 'Install Dependencies' : '安装依赖';

      // Migrate old project data: ensure new optional fields have defaults
      projectStore.projects = data.projects.map((p: any) => ensureNodeInstallCommand({
        ...p,
        type: p.type || 'node',
        gitRemoteUrl: typeof p.gitRemoteUrl === 'string' ? p.gitRemoteUrl : undefined,
        gitBranch: typeof p.gitBranch === 'string' ? p.gitBranch : undefined,
        gitConfigured: p.gitConfigured ?? undefined,
        scripts: p.scripts || [],
        visibleScripts: p.visibleScripts || undefined,
        customCommands: p.customCommands || [],
        projectFiles: p.projectFiles || [],
        memo: p.memo || '',
        pinned: p.pinned ?? false,
        pinOrder: p.pinOrder ?? undefined,
      }, installCommandName));

      normalizedDataChanged = projectStore.projects.some((project: Project, index: number) => {
        const originalCommands = Array.isArray(data.projects[index]?.customCommands) ? data.projects[index].customCommands : [];
        return JSON.stringify(project.customCommands || []) !== JSON.stringify(originalCommands);
      });
    }
    if (data.settings) {
      const settingsStore = useSettingsStore();
      settingsStore.settings = { ...settingsStore.settings, ...data.settings };
    }
    if (data.customNodes) {
      const nodeStore = useNodeStore();
      // Merge custom nodes
      const existing = new Set(nodeStore.versions.map(v => v.path));
      data.customNodes.forEach((n: any) => {
          if (!existing.has(n.path)) {
              nodeStore.versions.push(n);
          }
      });
    }
    if (data.usageData) {
      const usageStore = useUsageStore();
      usageStore.loadData(data.usageData);
    }
    console.log('Data loaded');
    lastSerializedData = serializePersistedData();

    if (normalizedDataChanged) {
      await api.writeConfigFile(FILE_NAME, lastSerializedData);
    }
  } catch (e) {
    console.error('Failed to load data:', e);
  }
}
