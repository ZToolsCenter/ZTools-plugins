import { ref } from 'vue';
import { api } from '../api';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { useNodeStore } from '../stores/node';
import { useUsageStore } from '../stores/usage';
import type { AppDefaultNode, NodeVersion, Project, ProjectGroup, Settings, UsageData } from '../types';
import { ensureNodeInstallCommand } from './projectCommands';
import { createPersistenceSaveQueue } from './persistenceQueue';
import { clampWorkspaceExplorerWidth } from './workspaceExplorerLayout';
import { normalizeUiSize } from './uiSize';
import { isPersistedDataShape, parsePersistedData } from './configSafety';

const FILE_NAME = 'data.json';
const SAVE_DEBOUNCE_MS = 800;
const SAVE_IDLE_TIMEOUT_MS = 2000;

type PersistedData = {
  projects: Project[];
  settings: Settings;
  customNodes: NodeVersion[];
  appDefaultNode?: AppDefaultNode | null;
  usageData?: UsageData;
  projectGroups?: ProjectGroup[];
};

type IdleCallbackHandle = number;
type IdleCallbackDeadline = { didTimeout: boolean; timeRemaining: () => number };

export type PersistenceState = 'loading' | 'ready' | 'read-only';
export type PersistenceOperation = 'load' | 'save';
export type PersistenceEvent =
  | { type: 'error'; operation: PersistenceOperation; error: Error }
  | { type: 'recovered'; operation: PersistenceOperation };
export type PersistenceLoadResult =
  | { state: 'ready' }
  | { state: 'read-only'; error: Error };

export interface PersistenceRecoveryState {
  backupAvailable: boolean;
  backupValid: boolean;
  backupError: string | null;
}

let saveTimer: number | null = null;
let saveIdleHandle: IdleCallbackHandle | null = null;
let persistenceState: PersistenceState = 'loading';
let readOnlyError: Error | null = null;
let lastFailure: PersistenceOperation | null = null;
const listeners = new Set<(event: PersistenceEvent) => void>();
const saveQueue = createPersistenceSaveQueue((serialized) => api.writeConfigFile(FILE_NAME, serialized));
export const persistenceRecovery = ref<PersistenceRecoveryState>({
  backupAvailable: false,
  backupValid: false,
  backupError: null,
});

function buildPersistedData(): PersistedData {
  const projectStore = useProjectStore();
  const settingsStore = useSettingsStore();
  const nodeStore = useNodeStore();
  const usageStore = useUsageStore();

  return {
    projects: projectStore.projects,
    settings: settingsStore.settings,
    customNodes: nodeStore.versions.filter(v => v.source === 'custom'),
    appDefaultNode: nodeStore.appDefault,
    usageData: usageStore.usageData,
    projectGroups: projectStore.projectGroups,
  };
}

function serializePersistedData(): string {
  return JSON.stringify(buildPersistedData(), null, 2);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function resetRecoveryState(): void {
  persistenceRecovery.value = {
    backupAvailable: false,
    backupValid: false,
    backupError: null,
  };
}

async function inspectBackup(): Promise<void> {
  let backupAvailable = false;
  let backupValid = false;
  let backupError: string | null = null;

  try {
    backupAvailable = await api.hasConfigBackup(FILE_NAME);
    if (backupAvailable) {
      const content = await api.readConfigBackup(FILE_NAME);
      parsePersistedData(content);
      backupValid = true;
    }
  } catch (error) {
    backupError = toError(error).message;
  }

  persistenceRecovery.value = { backupAvailable, backupValid, backupError };
}

function emit(event: PersistenceEvent) {
  listeners.forEach((listener) => listener(event));
}

function reportFailure(operation: PersistenceOperation, error: unknown) {
  const normalized = toError(error);
  lastFailure = operation;
  emit({ type: 'error', operation, error: normalized });
  return normalized;
}

function reportRecovery(operation: PersistenceOperation) {
  if (!lastFailure) return;
  lastFailure = null;
  emit({ type: 'recovered', operation });
}

function enterReadOnly(operation: PersistenceOperation, error: unknown): Error {
  const normalized = reportFailure(operation, error);
  persistenceState = 'read-only';
  readOnlyError = normalized;
  return normalized;
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

async function saveData(force = false) {
  if (persistenceState !== 'ready') {
    throw readOnlyError || new Error('Persistence is not ready');
  }

  try {
    await saveQueue.enqueue(serializePersistedData(), force);
    reportRecovery('save');
  } catch (error) {
    throw reportFailure('save', error);
  }
}

export function subscribePersistenceEvents(listener: (event: PersistenceEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPersistenceState(): PersistenceState {
  return persistenceState;
}

export function scheduleSaveData() {
  if (persistenceState !== 'ready') return;
  clearScheduledSave();

  saveTimer = window.setTimeout(() => {
    saveTimer = null;

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: (deadline: IdleCallbackDeadline) => void, options?: { timeout?: number }) => IdleCallbackHandle;
    };

    const runSave = () => {
      saveIdleHandle = null;
      void saveData().catch(() => undefined);
    };

    if (idleWindow.requestIdleCallback) {
      saveIdleHandle = idleWindow.requestIdleCallback(runSave, { timeout: SAVE_IDLE_TIMEOUT_MS });
      return;
    }

    saveIdleHandle = window.setTimeout(runSave, 200);
  }, SAVE_DEBOUNCE_MS);
}

export async function flushPendingSave() {
  clearScheduledSave();
  if (persistenceState === 'loading') return;
  await saveData();
}

export async function restoreConfigBackup(): Promise<PersistenceLoadResult> {
  try {
    const content = await api.readConfigBackup(FILE_NAME);
    if (!isPersistedDataShape(parsePersistedData(content))) {
      throw new Error('Config backup does not have the expected persisted data shape');
    }
    const restored = await api.restoreConfigBackup(FILE_NAME);
    parsePersistedData(restored);
    return await loadData();
  } catch (error) {
    await inspectBackup();
    return { state: 'read-only', error: enterReadOnly('load', error) };
  }
}

export async function canOpenConfigDirectory(): Promise<boolean> {
  return api.canOpenConfigDirectory();
}

export async function openConfigDirectory(): Promise<void> {
  await api.openConfigDirectory();
}

export async function loadData(): Promise<PersistenceLoadResult> {
  persistenceState = 'loading';
  readOnlyError = null;
  resetRecoveryState();

  try {
    const content = await api.readConfigFile(FILE_NAME);
    if (!content) {
      if (await api.hasConfigBackup(FILE_NAME)) {
        throw new Error('Primary config file is missing while a backup exists');
      }
      const nodeStore = useNodeStore();
      const legacyMigrated = nodeStore.migrateLegacyStorage();
      saveQueue.markPersisted(serializePersistedData());
      persistenceState = 'ready';
      if (legacyMigrated) {
        try {
          await saveQueue.enqueue(serializePersistedData(), true);
          nodeStore.completeLegacyMigration();
          saveQueue.markPersisted(serializePersistedData());
        } catch (error) {
          return { state: 'read-only', error: enterReadOnly('save', error) };
        }
      }
      reportRecovery('load');
      return { state: 'ready' };
    }

    let data: any;
    try {
      data = parsePersistedData(content);
    } catch (error) {
      throw new Error(`Failed to parse config file: ${toError(error).message}`);
    }

    let normalizedDataChanged = false;
    const nodeStore = useNodeStore();
    const hasFormalNodeData = Array.isArray(data.customNodes)
      || Object.prototype.hasOwnProperty.call(data, 'appDefaultNode');
    if (!hasFormalNodeData) {
      nodeStore.migrateLegacyStorage();
    }
    if (data.projects) {
      const projectStore = useProjectStore();
      const settingsStore = useSettingsStore();
      const installCommandName = settingsStore.settings.locale === 'en' ? 'Install Dependencies' : '安装依赖';

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
        description: typeof p.description === 'string' ? p.description : undefined,
        tags: Array.isArray(p.tags) ? p.tags : undefined,
        groupId: typeof p.groupId === 'string' ? p.groupId : undefined,
        parentId: typeof p.parentId === 'string' ? p.parentId : undefined,
        favorite: p.favorite ?? false,
        moduleKind: typeof p.moduleKind === 'string' ? p.moduleKind : undefined,
        subScannedAt: typeof p.subScannedAt === 'number' ? p.subScannedAt : undefined,
        codeModules: Array.isArray(p.codeModules) ? p.codeModules : undefined,
        frontendEnvGroups: Array.isArray(p.frontendEnvGroups) ? p.frontendEnvGroups : undefined,
        frontendEnvScannedAt: typeof p.frontendEnvScannedAt === 'number' ? p.frontendEnvScannedAt : undefined,
        terminalInjectNode: typeof p.terminalInjectNode === 'boolean' ? p.terminalInjectNode : undefined,
        nodeRuntimeId: typeof p.nodeRuntimeId === 'string' ? p.nodeRuntimeId : undefined,
      }, installCommandName));

      normalizedDataChanged = projectStore.projects.some((project: Project, index: number) => {
        const originalCommands = Array.isArray(data.projects[index]?.customCommands) ? data.projects[index].customCommands : [];
        return JSON.stringify(project.customCommands || []) !== JSON.stringify(originalCommands);
      });
    }
    if (data.settings) {
      const settingsStore = useSettingsStore();
      const merged = { ...settingsStore.settings, ...data.settings };
      if (Object.prototype.hasOwnProperty.call(data.settings, 'uiSize')) {
        const originalUiSize = data.settings.uiSize;
        merged.uiSize = normalizeUiSize(originalUiSize);
        normalizedDataChanged ||= originalUiSize !== merged.uiSize;
      } else {
        // data.json 是正式持久化来源；旧版本缺字段时按新默认值迁移。
        merged.uiSize = normalizeUiSize(undefined);
        normalizedDataChanged = true;
      }
      if (!Array.isArray(data.settings.projectViewPresets)) {
        merged.projectViewPresets = [];
        normalizedDataChanged = true;
      }
      if (!Array.isArray(data.settings.workspaceProfiles)) {
        merged.workspaceProfiles = [];
        normalizedDataChanged = true;
      }
      const normalizedExplorerWidth = clampWorkspaceExplorerWidth(data.settings.workspaceExplorerWidth);
      normalizedDataChanged ||= data.settings.workspaceExplorerWidth !== normalizedExplorerWidth;
      merged.workspaceExplorerWidth = normalizedExplorerWidth;
      const managedLocation = data.settings.managedNodeRuntimeLocation;
      let normalizedManagedLocation: Settings['managedNodeRuntimeLocation'];
      if (managedLocation?.mode === 'custom' && typeof managedLocation.customPath === 'string' && managedLocation.customPath.trim()) {
        normalizedManagedLocation = {
          mode: 'custom',
          customPath: managedLocation.customPath.trim(),
        };
      } else if (managedLocation?.mode === 'portable') {
        normalizedManagedLocation = { mode: 'portable' };
      } else {
        normalizedManagedLocation = { mode: 'app-data' };
      }
      normalizedDataChanged ||= JSON.stringify(managedLocation) !== JSON.stringify(normalizedManagedLocation);
      merged.managedNodeRuntimeLocation = normalizedManagedLocation;
      settingsStore.settings = merged;
    }
    const normalizeNodeSource = (source: unknown): NodeVersion['source'] =>
      source === 'managed' || source === 'nvm' || source === 'system' || source === 'custom'
        ? source
        : 'custom';
    const persistedCustomNodes = Array.isArray(data.customNodes)
      ? data.customNodes.map((node: any) => ({
        runtimeId: typeof node.runtimeId === 'string' ? node.runtimeId : undefined,
        runtimeRoot: typeof node.runtimeRoot === 'string' ? node.runtimeRoot : undefined,
        version: typeof node.version === 'string' ? node.version : '',
        path: typeof node.path === 'string' ? node.path : '',
        source: 'custom' as const,
        status: node.status || 'available',
      }))
      : undefined;
    const persistedDefault = data.appDefaultNode && typeof data.appDefaultNode === 'object'
      ? {
        runtimeId: typeof data.appDefaultNode.runtimeId === 'string' ? data.appDefaultNode.runtimeId : undefined,
        source: normalizeNodeSource(data.appDefaultNode.source),
        version: typeof data.appDefaultNode.version === 'string' ? data.appDefaultNode.version : '',
        path: typeof data.appDefaultNode.path === 'string' ? data.appDefaultNode.path : '',
      }
      : (Object.prototype.hasOwnProperty.call(data, 'appDefaultNode') ? null : undefined);
    if (persistedCustomNodes !== undefined || persistedDefault !== undefined) {
      nodeStore.hydratePersistedData({
        customNodes: persistedCustomNodes,
        appDefaultNode: persistedDefault,
      });
      if (persistedCustomNodes !== undefined) {
        const originalNodes = Array.isArray(data.customNodes) ? data.customNodes : [];
        normalizedDataChanged ||= JSON.stringify(nodeStore.versions.filter(node => node.source === 'custom')) !== JSON.stringify(originalNodes);
      }
      if (persistedDefault !== undefined) {
        normalizedDataChanged ||= JSON.stringify(nodeStore.appDefault) !== JSON.stringify(data.appDefaultNode ?? null);
      }
    }
    if (data.usageData) {
      const usageStore = useUsageStore();
      usageStore.loadData(data.usageData);
    }
    if (data.projectGroups) {
      const projectStore = useProjectStore();
      projectStore.projectGroups = data.projectGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder ?? undefined,
        collapsed: g.collapsed ?? false,
      }));
    }

    persistenceState = 'ready';
    const serialized = serializePersistedData();
    const legacyMigrationPending = nodeStore.legacyMigrationPending;
    if (normalizedDataChanged || legacyMigrationPending) {
      try {
        await saveQueue.enqueue(serialized, true);
        if (legacyMigrationPending) nodeStore.completeLegacyMigration();
      } catch (error) {
        return { state: 'read-only', error: enterReadOnly('save', error) };
      }
    } else {
      saveQueue.markPersisted(serialized);
    }

    console.log('Data loaded');
    reportRecovery('load');
    return { state: 'ready' };
  } catch (error) {
    await inspectBackup();
    return { state: 'read-only', error: enterReadOnly('load', error) };
  }
}
