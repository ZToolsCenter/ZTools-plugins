import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api';
import type {
  AppDefaultNode,
  ManagedRuntimeLocation,
  ManagedRuntimeLocationInfo,
  NodeInstallProgress,
  NodeVersion,
  NodeVersionEntry,
  SystemNodeState,
  SystemNodeSwitchOptions,
  SystemNodeSwitchResult,
} from '../types';
import {
  buildNodeRuntimeId,
  ensureNodeRuntime,
  getNodeRuntimeId,
  normalizeRuntimeVersion,
  resolveAppDefaultRuntime,
} from '../utils/nodeRuntime';
import { mergeNodeRuntimes, migrateLegacyNodeSource, sortNodeVersions } from '../utils/nodeDefaultState';
import { findSystemRuntime, mapSystemNodeStateToRuntime } from '../utils/systemNode';
import { buildNodeVersionEntries } from '../utils/nodeRuntimeGrouping';
import { resolveTerminalCommand } from '../utils/terminalConfig';
import { useSettingsStore } from './settings';

const SYSTEM_NODE_PLACEHOLDER = 'System Default';
const APP_DEFAULT_KEY = 'app_default_node';
const CUSTOM_NODES_KEY = 'custom_nodes';
const LEGACY_SYSTEM_PATH_KEY = 'system_node_path';

function normalizeVersionLabel(version: string): string {
  return normalizeRuntimeVersion(version);
}

function parseLegacyCustomNodes(): NodeVersion[] {
  if (typeof localStorage === 'undefined') return [];
  const stored = localStorage.getItem(CUSTOM_NODES_KEY);
  if (!stored) return [];
  try {
    const custom: NodeVersion[] = JSON.parse(stored);
    return custom
      .filter(node => node && node.path && node.version)
      .map(node => {
        const source = migrateLegacyNodeSource(node.source);
        return ensureNodeRuntime({
          version: node.version,
          path: node.path,
          source: source === 'system' ? 'custom' : source,
          status: node.status || 'available',
        });
      })
      .filter(node => node.source === 'custom');
  } catch (error) {
    console.error('Failed to load legacy custom nodes', error);
    return [];
  }
}

function parseLegacyDefault(): AppDefaultNode | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(APP_DEFAULT_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as AppDefaultNode;
      if (parsed?.path && parsed?.version && parsed?.source) {
        const source = migrateLegacyNodeSource(parsed.source);
        return {
          runtimeId: parsed.runtimeId || buildNodeRuntimeId(source, parsed.version, parsed.path),
          source,
          version: parsed.version,
          path: parsed.path,
        };
      }
    } catch (error) {
      console.error('Failed to load legacy app default node', error);
    }
  }

  const legacyPath = localStorage.getItem(LEGACY_SYSTEM_PATH_KEY);
  if (legacyPath && legacyPath !== SYSTEM_NODE_PLACEHOLDER) {
    return {
      runtimeId: buildNodeRuntimeId('system', '', legacyPath),
      source: 'system',
      version: '',
      path: legacyPath,
    };
  }
  return null;
}

function clearLegacyStorage() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(APP_DEFAULT_KEY);
  localStorage.removeItem(CUSTOM_NODES_KEY);
  localStorage.removeItem(LEGACY_SYSTEM_PATH_KEY);
}

export const useNodeStore = defineStore('node', () => {
  const versions = ref<NodeVersion[]>([]);
  const loading = ref(false);
  const managedSupported = ref(true);
  const registryError = ref('');
  const appDefault = ref<AppDefaultNode | null>(null);
  const systemNodeState = ref<SystemNodeState | null>(null);
  /** 仅供项目默认解析的 ephemeral fallback，不进入 Runtime Registry 或持久化。 */
  const systemNodeRuntime = ref<NodeVersion | null>(null);
  const systemNodeLoading = ref(false);
  const systemNodeSwitching = ref(false);
  const systemNodeSwitchSupported = ref(false);
  const managedLocation = ref<ManagedRuntimeLocationInfo | null>(null);
  const managedLocationLoading = ref(false);
  let managedLocationRequestId = 0;
  const installProgress = ref<Record<string, NodeInstallProgress>>({});
  const persistedCustomNodes = ref<NodeVersion[]>([]);
  const hydrated = ref(false);
  const legacyMigrationPending = ref(false);
  let progressUnlisten: (() => void) | null = null;

  function markDefault(list: NodeVersion[]): NodeVersion[] {
    const current = appDefault.value;
    const currentId = current
      ? current.runtimeId || buildNodeRuntimeId(current.source, current.version, current.path)
      : '';
    return list.map(node => {
      const normalized = ensureNodeRuntime(node);
      return { ...normalized, isDefault: !!currentId && getNodeRuntimeId(normalized) === currentId };
    });
  }

  function applyMerged(parts: {
    managed?: NodeVersion[];
    nvm?: NodeVersion[];
    custom?: NodeVersion[];
  }) {
    versions.value = markDefault(mergeNodeRuntimes({
      managed: parts.managed ?? versions.value.filter(v => v.source === 'managed'),
      nvm: parts.nvm ?? versions.value.filter(v => v.source === 'nvm'),
      custom: parts.custom ?? persistedCustomNodes.value,
    }));
  }

  function hydratePersistedData(data: {
    customNodes?: NodeVersion[];
    appDefaultNode?: AppDefaultNode | null;
  }) {
    persistedCustomNodes.value = (data.customNodes || [])
      .filter(node => node && node.path && node.version)
      .map(node => ensureNodeRuntime({ ...node, source: 'custom' }));
    // R2.2 stored the detected System Node as the app default. System Node is
    // now an OS-derived state, so migrate that legacy value to the normal
    // implicit fallback instead of keeping a dead `system` default binding.
    appDefault.value = data.appDefaultNode && data.appDefaultNode.source !== 'system'
      ? {
        ...data.appDefaultNode,
        runtimeId: data.appDefaultNode.runtimeId
          || buildNodeRuntimeId(data.appDefaultNode.source, data.appDefaultNode.version, data.appDefaultNode.path),
      }
      : null;
    hydrated.value = true;
    applyMerged({ custom: persistedCustomNodes.value });
  }

  function migrateLegacyStorage(): boolean {
    const customNodes = parseLegacyCustomNodes();
    const defaultNode = parseLegacyDefault();
    hydrated.value = true;
    if (!customNodes.length && !defaultNode) return false;
    hydratePersistedData({ customNodes, appDefaultNode: defaultNode });
    legacyMigrationPending.value = true;
    return true;
  }

  function completeLegacyMigration() {
    clearLegacyStorage();
    legacyMigrationPending.value = false;
  }

  function migrateDefaultRuntimeId(): boolean {
    if (!appDefault.value) return false;
    if (appDefault.value.runtimeId) {
      versions.value = markDefault(versions.value);
      return false;
    }
    const resolved = resolveAppDefaultRuntime(versions.value, appDefault.value, systemNodeRuntime.value);
    if (!resolved.runtime) return false;
    const runtime = ensureNodeRuntime(resolved.runtime);
    const next = {
      runtimeId: getNodeRuntimeId(runtime),
      source: runtime.source,
      version: runtime.version,
      path: runtime.path,
    } satisfies AppDefaultNode;
    const changed = JSON.stringify(appDefault.value) !== JSON.stringify(next);
    if (changed) appDefault.value = next;
    versions.value = markDefault(versions.value);
    return changed;
  }

  const loadCustomNodes = () => {
    applyMerged({ custom: persistedCustomNodes.value });
  };

  const refreshCustomRuntimes = async () => {
    const checked = await Promise.all(persistedCustomNodes.value.map(async runtime => {
      try {
        const actual = await api.getNodeVersion(runtime.path);
        const valid = !!actual && normalizeRuntimeVersion(actual) === normalizeRuntimeVersion(runtime.version);
        return { ...runtime, status: valid ? 'available' as const : 'broken' as const };
      } catch {
        return { ...runtime, status: 'broken' as const };
      }
    }));
    persistedCustomNodes.value = checked;
    applyMerged({ custom: checked });
  };

  function applySystemNodeState(state: SystemNodeState): void {
    const mapped = mapSystemNodeStateToRuntime(state, versions.value);
    systemNodeState.value = mapped;
    const matched = findSystemRuntime(mapped, versions.value);
    systemNodeRuntime.value = matched || (mapped.available && mapped.nodePath && mapped.version
      ? ensureNodeRuntime({
        runtimeId: `system-state:${mapped.canonicalNodePath || mapped.nodePath}`,
        version: mapped.version,
        path: mapped.nodePath,
        canonicalPath: mapped.canonicalNodePath,
        source: 'system',
        status: 'available',
      })
      : null);
  }

  const refreshSystemNode = async (options: { throwOnError?: boolean } = {}): Promise<SystemNodeState> => {
    systemNodeLoading.value = true;
    try {
      const detected = await api.getSystemNodeState();
      applySystemNodeState(detected);
      return systemNodeState.value || detected;
    } catch (error) {
      console.error('Failed to detect system node state', error);
      if (options.throwOnError) throw error;
      const unavailable: SystemNodeState = {
        available: false,
        source: 'unknown',
        candidates: [],
        pathScope: 'unknown',
      };
      applySystemNodeState(unavailable);
      return unavailable;
    } finally {
      systemNodeLoading.value = false;
    }
  };

  const syncSystemNode = async (options: {
    preferredVersion?: string;
    preferredPath?: string;
  } = {}) => {
    if (!options.preferredPath) {
      await refreshSystemNode();
      return;
    }

    const resolvedPath = options.preferredPath;
    let resolvedVersion = options.preferredVersion || 'System';
    let status: NodeVersion['status'] = 'available';
    try {
      const detectedVersion = await api.getNodeVersion(resolvedPath);
      if (detectedVersion) resolvedVersion = normalizeVersionLabel(detectedVersion);
      else status = 'broken';
    } catch (error) {
      console.error('Failed to detect system node version', error);
      status = 'broken';
    }
    applySystemNodeState({
      available: status === 'available',
      version: resolvedVersion,
      nodePath: resolvedPath,
      source: 'unknown',
      candidates: [{ path: resolvedPath, version: status === 'available' ? resolvedVersion : undefined }],
      pathScope: 'unknown',
    });
  };

  const loadManagedRuntimeSize = async (requestId: number): Promise<void> => {
    try {
      const size = await api.getManagedNodeRuntimeSize();
      if (requestId !== managedLocationRequestId || !managedLocation.value) return;
      managedLocation.value = { ...managedLocation.value, ...size };
    } catch (error) {
      if (requestId === managedLocationRequestId && managedLocation.value) {
        managedLocation.value = {
          ...managedLocation.value,
          sizeBytes: 0,
          sizeStatus: 'error',
          warnings: [...(managedLocation.value.warnings || []), String(error)],
        };
      }
      console.error('Failed to calculate managed runtime size', error);
    } finally {
      if (requestId === managedLocationRequestId) managedLocationLoading.value = false;
    }
  };

  const refreshManagedRuntimes = async () => {
    const requestId = ++managedLocationRequestId;
    managedLocation.value = null;
    managedLocationLoading.value = true;
    try {
      const managed = await api.listInstalledNodeRuntimes();
      applyMerged({
        managed: managed.map(node => ensureNodeRuntime({
          ...node,
          source: 'managed',
          status: node.status || 'available',
        })),
      });
    } catch (error) {
      registryError.value = String(error);
      applyMerged({ managed: [] });
      console.error('Failed to load managed node runtimes', error);
    }
    try {
      const location = await api.getManagedNodeRuntimeLocation();
      if (requestId !== managedLocationRequestId) return;
      managedLocation.value = location;
      void loadManagedRuntimeSize(requestId);
    } catch (error) {
      if (requestId === managedLocationRequestId) {
        managedLocation.value = null;
        managedLocationLoading.value = false;
      }
      console.error('Failed to load managed runtime location', error);
    }
  };

  const refreshNvmRuntimes = async (options: { throwOnError?: boolean } = {}) => {
    try {
      const nvm = await api.scanNvmNodeRuntimes();
      applyMerged({
        nvm: nvm.map(node => ensureNodeRuntime({
          ...node,
          source: 'nvm',
          status: node.status || 'available',
        })),
      });
    } catch (error) {
      console.warn('NVM discovery is unavailable', error);
      if (options.throwOnError) throw error;
      applyMerged({ nvm: [] });
    }
  };

  const refreshRuntimeRegistryAfterSystemSwitch = async (): Promise<void> => {
    const failures: unknown[] = [];
    try {
      await refreshNvmRuntimes({ throwOnError: true });
    } catch (error) {
      failures.push(error);
    }
    try {
      await refreshSystemNode({ throwOnError: true });
    } catch (error) {
      failures.push(error);
    }
    versions.value = sortNodeVersions(markDefault(versions.value));
    migrateDefaultRuntimeId();
    if (failures.length) {
      throw new Error(failures.map(error => String(error)).join('; '));
    }
  };

  const loadRuntimes = async () => {
    loading.value = true;
    registryError.value = '';
    try {
      try {
        managedSupported.value = await api.managedNodeRuntimeSupported();
      } catch {
        managedSupported.value = true;
      }
      try {
        systemNodeSwitchSupported.value = await api.systemNodeSwitchSupported();
      } catch {
        systemNodeSwitchSupported.value = false;
      }
      loadCustomNodes();
      await refreshCustomRuntimes();
      await refreshManagedRuntimes();
      await refreshNvmRuntimes();
      await refreshSystemNode();
      versions.value = sortNodeVersions(markDefault(versions.value));
      migrateDefaultRuntimeId();
    } finally {
      loading.value = false;
    }
  };

  /** @deprecated 使用 loadRuntimes */
  const loadNvmNodes = loadRuntimes;

  const getRuntime = (runtimeId: string | undefined) => {
    if (!runtimeId) return undefined;
    return versions.value.find(runtime => getNodeRuntimeId(runtime) === runtimeId);
  };

  const addCustomNode = async (node: NodeVersion) => {
    const candidate = ensureNodeRuntime({ ...node, source: 'custom' });
    const detectedVersion = await api.getNodeVersion(candidate.path);
    if (!detectedVersion) throw new Error('无法验证该 Node 可执行文件，请选择包含 node.exe 的目录。');
    const version = normalizeVersionLabel(detectedVersion);
    const normalized = ensureNodeRuntime({
      ...candidate,
      runtimeId: buildNodeRuntimeId('custom', version, candidate.path),
      version,
      status: 'available',
    });
    persistedCustomNodes.value = [
      ...persistedCustomNodes.value.filter(item => getNodeRuntimeId(item) !== getNodeRuntimeId(normalized)),
      normalized,
    ];
    applyMerged({ custom: persistedCustomNodes.value });
    return normalized;
  };

  const removeNode = (runtimeIdOrPath: string) => {
    const target = persistedCustomNodes.value.find(node =>
      getNodeRuntimeId(node) === runtimeIdOrPath || node.path === runtimeIdOrPath,
    );
    if (!target) return;
    const targetId = getNodeRuntimeId(target);
    persistedCustomNodes.value = persistedCustomNodes.value.filter(node => getNodeRuntimeId(node) !== targetId);
    applyMerged({ custom: persistedCustomNodes.value });
  };

  const replaceCustomNodes = (nodes: NodeVersion[]) => {
    persistedCustomNodes.value = nodes
      .filter(node => node && node.path && node.version)
      .map(node => ensureNodeRuntime({ ...node, source: 'custom' }));
    applyMerged({ custom: persistedCustomNodes.value });
  };

  const setAppDefaultNode = async (node: NodeVersion) => {
    const targetId = getNodeRuntimeId(node);
    const target = getRuntime(targetId) || ensureNodeRuntime(node);
    if (!getRuntime(targetId)) {
      throw new Error('所选 Node Runtime 不存在或已被移除，请先重新扫描。');
    }
    if (!target.path || target.path === SYSTEM_NODE_PLACEHOLDER || target.status === 'broken' || target.status === 'unavailable') {
      throw new Error('所选 Node Runtime 不可用，请先重新检测。');
    }
    let actualVersion: string;
    try {
      actualVersion = await api.getNodeVersion(target.path);
    } catch (error) {
      throw new Error(`Node Runtime 验证失败：${String(error)}`);
    }
    if (!actualVersion) throw new Error('Node Runtime 验证失败：找不到 node 可执行文件。');
    const expected = normalizeRuntimeVersion(target.version);
    const actual = normalizeRuntimeVersion(actualVersion);
    if (expected !== actual) {
      throw new Error(`Node Runtime 版本不匹配：记录为 ${expected}，实际为 ${actual}。`);
    }

    const previousDefault = appDefault.value ? { ...appDefault.value } : null;
    const runtimeId = getNodeRuntimeId(target);
    appDefault.value = {
      runtimeId,
      source: target.source,
      version: actual,
      path: target.path,
    };
    versions.value = markDefault(versions.value);
    try {
      const { flushPendingSave } = await import('../utils/persistence');
      await flushPendingSave();
    } catch (error) {
      appDefault.value = previousDefault;
      versions.value = markDefault(versions.value);
      throw new Error(`默认 Node 保存失败：${String(error)}`);
    }
    try {
      await loadRuntimes();
    } catch (error) {
      throw new Error(`默认 Node 已保存，但 Runtime Registry 刷新失败：${String(error)}`);
    }
  };

  /** 验证 Runtime，并把状态更新为 available/broken。 */
  const validateRuntime = async (runtimeId: string) => {
    const target = getRuntime(runtimeId);
    if (!target) throw new Error('Runtime 不存在或已被移除。');
    const index = versions.value.findIndex(item => getNodeRuntimeId(item) === runtimeId);
    let actual = '';
    try {
      actual = await api.getNodeVersion(target.path);
    } catch (error) {
      if (index >= 0) versions.value[index] = { ...versions.value[index], status: 'broken' };
      throw new Error(`Node Runtime 验证失败：${String(error)}`);
    }
    const valid = !!actual && normalizeRuntimeVersion(actual) === normalizeRuntimeVersion(target.version);
    if (index >= 0) versions.value[index] = { ...versions.value[index], status: valid ? 'available' : 'broken' };
    if (!valid) throw new Error(`Node Runtime 验证失败：期望 ${target.version}，实际 ${actual || '不可用'}。`);
    return actual;
  };

  const updateSystemNode = async (newPath: string, preferredVersion?: string) => {
    await syncSystemNode({ preferredPath: newPath, preferredVersion });
  };

  const switchSystemNode = async (
    runtime: NodeVersion,
    options: SystemNodeSwitchOptions = {},
  ): Promise<SystemNodeSwitchResult> => {
    systemNodeSwitching.value = true;
    try {
      const result = await api.switchSystemNode(runtime, options);
      if (result.current) applySystemNodeState(result.current);
      return result;
    } finally {
      systemNodeSwitching.value = false;
    }
  };

  function applyProgress(progress: NodeInstallProgress) {
    const version = normalizeVersionLabel(progress.version);
    const nextProgress = { ...progress, version };
    installProgress.value = { ...installProgress.value, [version]: nextProgress };
    if (progress.phase === 'complete') {
      const next = { ...installProgress.value };
      delete next[version];
      installProgress.value = next;
    }
  }

  async function ensureProgressListener() {
    if (progressUnlisten || !api.onNodeRuntimeProgress) return;
    progressUnlisten = await api.onNodeRuntimeProgress(applyProgress);
  }

  const installManagedNode = async (version: string, operationId?: string) => {
    await ensureProgressListener();
    const normalized = normalizeVersionLabel(version);
    applyProgress({
      operationId: operationId || `install-${normalized}`,
      version: normalized,
      phase: 'resolving',
      percent: 0,
    });
    try {
      loading.value = true;
      await api.installManagedNode(version, operationId);
      await loadRuntimes();
      const exists = versions.value.some(v =>
        v.source === 'managed' && normalizeVersionLabel(v.version) === normalized && v.status !== 'broken',
      );
      if (!exists) throw new Error('Node version not found after installation.');
      return true;
    } finally {
      const next = { ...installProgress.value };
      delete next[normalized];
      installProgress.value = next;
      loading.value = false;
    }
  };

  /** @deprecated 使用 installManagedNode */
  const installNode = installManagedNode;

  const cancelManagedNodeInstall = async (operationId: string) => {
    await api.cancelManagedNodeInstall(operationId);
  };

  const uninstallManagedNode = async (version: string) => {
    loading.value = true;
    try {
      await api.uninstallManagedNode(version);
      await loadRuntimes();
      const normalized = normalizeVersionLabel(version);
      const exists = versions.value.some(v =>
        v.source === 'managed' && normalizeVersionLabel(v.version) === normalized,
      );
      if (exists) throw new Error('Node version still exists after uninstallation.');
      return true;
    } finally {
      loading.value = false;
    }
  };

  const changeManagedRuntimeLocation = async (
    location: ManagedRuntimeLocation,
    migrate: boolean,
    runningRuntimePaths: string[] = [],
  ) => {
    const result = await api.migrateManagedNodeRuntimeLocation(location, migrate, runningRuntimePaths);
    managedLocation.value = result;
    const settingsStore = useSettingsStore();
    settingsStore.settings.managedNodeRuntimeLocation = {
      mode: result.mode,
      customPath: result.customPath || undefined,
    };
    try {
      const { flushPendingSave } = await import('../utils/persistence');
      await flushPendingSave();
    } catch (error) {
      // The backend has already switched successfully; report persistence cleanup without rolling it back.
      result.warnings = [
        ...(result.warnings || []),
        `Runtime 位置已切换，但前端配置刷新失败：${String(error)}`,
      ];
    }
    await loadRuntimes();
    return result;
  };

  const openManagedRuntimeRoot = async () => {
    await api.openManagedNodeRuntimeRoot();
  };

  const openTerminalWithRuntime = async (runtime: NodeVersion) => {
    const settingsStore = useSettingsStore();
    const home = await api.getHomeDirectory();
    const terminal = resolveTerminalCommand(
      settingsStore.settings.defaultTerminal,
      settingsStore.settings.customTerminals,
    );
    return api.openInTerminal(home || '.', terminal, runtime.path, 'npm');
  };

  const openSystemTerminal = async () => {
    const settingsStore = useSettingsStore();
    const home = await api.getHomeDirectory();
    const terminal = resolveTerminalCommand(
      settingsStore.settings.defaultTerminal,
      settingsStore.settings.customTerminals,
    );
    return api.openInTerminal(home || '.', terminal, '', '');
  };

  const defaultRuntime = computed(() => resolveAppDefaultRuntime(
    versions.value,
    appDefault.value,
    systemNodeRuntime.value,
  ).runtime);
  const versionEntries = computed<NodeVersionEntry[]>(() => buildNodeVersionEntries(versions.value, {
    systemNodeState: systemNodeState.value,
    appDefault: appDefault.value,
  }));

  return {
    versions,
    loading,
    managedSupported,
    registryError,
    appDefault,
    defaultRuntime,
    versionEntries,
    systemNodeRuntime,
    systemNodeState,
    systemNodeLoading,
    systemNodeSwitching,
    systemNodeSwitchSupported,
    managedLocation,
    managedLocationLoading,
    installProgress,
    legacyMigrationPending,
    loadRuntimes,
    loadNvmNodes,
    refreshManagedRuntimes,
    refreshNvmRuntimes,
    refreshRuntimeRegistryAfterSystemSwitch,
    loadCustomNodes,
    refreshCustomRuntimes,
    hydratePersistedData,
    migrateLegacyStorage,
    completeLegacyMigration,
    migrateDefaultRuntimeId,
    getRuntime,
    addCustomNode,
    removeNode,
    replaceCustomNodes,
    updateSystemNode,
    syncSystemNode,
    refreshSystemNode,
    switchSystemNode,
    setAppDefaultNode,
    validateRuntime,
    installManagedNode,
    installNode,
    cancelManagedNodeInstall,
    uninstallManagedNode,
    uninstallNode: uninstallManagedNode,
    changeManagedRuntimeLocation,
    openManagedRuntimeRoot,
    openTerminalWithRuntime,
    openSystemTerminal,
  };
});
