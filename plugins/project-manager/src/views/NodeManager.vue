<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import type { CanonicalNodeRuntime, ManagedRuntimeLocationMode, NodeVersion, Project } from '../types';
import { useNodeStore } from '../stores/node';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { getNodeRuntimeId } from '../utils/nodeRuntime';
import { groupNodeRuntimesByVersion, type NodeRuntimeGroup } from '../utils/nodeRuntimeGrouping';
import { getRuntimeListMode, type NodeRuntimeListMode } from '../utils/nodeRuntimeLayout';
import { getProjectsUsingRuntime, type ProjectRuntimeUsage, type RuntimeUsageReason } from '../utils/nodeRuntimeUsage';
import AddNodeModal from '../components/AddNodeModal.vue';
import InstallNodeModal from '../components/InstallNodeModal.vue';

const { t } = useI18n();
const emit = defineEmits<{
  navigateProject: [projectId: string];
}>();
const nodeStore = useNodeStore();
const projectStore = useProjectStore();
const settingsStore = useSettingsStore();
const target = import.meta.env.VITE_TARGET;
const isPlugin = target === 'utools' || target === 'ztools';

const showAddModal = ref(false);
const showInstallModal = ref(false);
const showStorageDialog = ref(false);
const showUsageDialog = ref(false);
const showRuntimeDetailsDialog = ref(false);
const selectedUsageRuntime = ref<NodeVersion | null>(null);
const selectedUsageGroup = ref<NodeRuntimeGroup | null>(null);
const selectedUsageCanonical = ref<CanonicalNodeRuntime | null>(null);
const selectedRuntimeDetailsGroup = ref<NodeRuntimeGroup | null>(null);
const selectedRuntimeDetails = computed(() => selectedRuntimeDetailsGroup.value?.canonicalRuntimes || []);
const usageSearchQuery = ref('');
const storageMode = ref<ManagedRuntimeLocationMode>('app-data');
const customStoragePath = ref('');
const migrateExisting = ref(true);
const storageSaving = ref(false);
type RuntimeAction = 'project-manager-default' | 'system-node';
const runtimeListPanel = ref<HTMLElement | null>(null);
const runtimeListMode = ref<NodeRuntimeListMode>('table');
let runtimeListResizeObserver: ResizeObserver | null = null;

const sourceOrder: Array<'managed' | 'nvm' | 'custom'> = ['managed', 'nvm', 'custom'];

const managedRuntimes = computed(() => nodeStore.versions.filter(runtime => runtime.source === 'managed'));
const nvmRuntimes = computed(() => nodeStore.versions.filter(runtime => runtime.source === 'nvm'));
const defaultRuntime = computed(() => nodeStore.defaultRuntime);
const defaultUnavailable = computed(() => !!nodeStore.appDefault && !defaultRuntime.value);
const managedRoot = computed(() => nodeStore.managedLocation?.rootPath || '');
const managedRootLabel = computed(() => managedRoot.value || (nodeStore.managedLocationLoading ? t('nodes.locationUnknown') : t('nodes.locationUnavailable')));
const portableAvailable = computed(() => nodeStore.managedLocation?.portableAvailable === true);
const nvmRoots = computed(() => {
  const roots = new Set<string>();
  for (const runtime of nvmRuntimes.value) {
    if (runtime.runtimeRoot) roots.add(runtime.runtimeRoot);
  }
  return [...roots];
});

const displayRuntimes = computed<NodeVersion[]>(() => {
  const rows = [...nodeStore.versions];
  for (const progress of Object.values(nodeStore.installProgress)) {
    if (!rows.some(row => row.source === 'managed' && row.version === progress.version)) {
      rows.push({
        runtimeId: `managed:${progress.version}`,
        version: progress.version,
        path: '',
        source: 'managed',
        status: 'installing',
      });
    }
  }
  return rows;
});

const runtimeGroups = computed<NodeRuntimeGroup[]>(() => groupNodeRuntimesByVersion(displayRuntimes.value, {
  systemNodeState: nodeStore.systemNodeState,
  appDefault: nodeStore.appDefault,
}));

const sourceCounts = computed<Record<'managed' | 'nvm' | 'custom', number>>(() => {
  const counts = { managed: 0, nvm: 0, custom: 0 };
  for (const group of runtimeGroups.value) {
    const source = group.effectiveRuntime.source;
    if (source === 'managed' || source === 'nvm' || source === 'custom') counts[source] += 1;
  }
  return counts;
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

const managedStorageText = computed(() => {
  if (nodeStore.managedLocationLoading || nodeStore.managedLocation?.sizeStatus === 'calculating') return t('nodes.storageCalculating');
  if (!nodeStore.managedLocation) return t('nodes.storageUnavailable');
  if (nodeStore.managedLocation.sizeStatus === 'error') return t('nodes.storageUnavailable');
  return t('nodes.storageUsage', { size: formatBytes(nodeStore.managedLocation.sizeBytes) });
});

function sourceLabel(source: NodeVersion['source'] | 'external'): string {
  if (source === 'managed') return t('nodes.sourceManaged');
  if (source === 'nvm') return t('nodes.sourceNvm');
  if (source === 'system') return t('nodes.sourceSystem');
  if (source === 'external') return t('nodes.sourceExternal');
  return t('nodes.sourceCustom');
}

function systemSourceLabel(source: NodeVersion['source'] | 'external' | 'unknown' | undefined): string {
  if (!source || source === 'unknown') return t('nodes.sourceUnknown');
  if (source === 'external') return t('nodes.sourceExternal');
  return sourceLabel(source);
}

function sourceTone(source: NodeVersion['source'] | 'external'): string {
  if (source === 'managed') return 'success';
  if (source === 'nvm') return 'warning';
  if (source === 'system') return 'info';
  if (source === 'external') return 'info';
  return 'primary';
}

function runtimeIsAvailable(runtime: NodeVersion): boolean {
  return !nodeStore.installProgress[runtime.version]
    && (runtime.status === undefined || runtime.status === 'available');
}

function groupStatusLabel(group: NodeRuntimeGroup): string {
  const installing = group.runtimes.some(runtime => runtime.status === 'installing' || nodeStore.installProgress[runtime.version]);
  if (installing) return t('nodes.installing');
  const available = group.runtimes.filter(runtimeIsAvailable).length;
  if (available === group.runtimes.length) return t('nodes.available');
  if (available > 0) return t('nodes.runtimeGroupPartial', { available, total: group.runtimes.length });
  return t('nodes.broken');
}

function groupStatusTone(group: NodeRuntimeGroup): string {
  if (group.runtimes.some(runtime => runtime.status === 'installing' || nodeStore.installProgress[runtime.version])) return 'text-blue-500';
  return group.runtimes.some(runtimeIsAvailable)
    ? 'text-emerald-600 dark:text-emerald-300'
    : 'text-amber-600 dark:text-amber-300';
}

function groupProgressText(group: NodeRuntimeGroup): string {
  const runtime = group.runtimes.find(item => nodeStore.installProgress[item.version]);
  return runtime ? progressText(runtime) : '';
}

function primaryRuntime(group: NodeRuntimeGroup): NodeVersion {
  return group.effectiveRuntime;
}

function groupHasAppDefault(group: NodeRuntimeGroup): boolean {
  return group.isProjectManagerDefault;
}

function groupCanSetAppDefault(group: NodeRuntimeGroup): boolean {
  return runtimeIsAvailable(group.effectiveRuntime) && !group.isProjectManagerDefault;
}

function groupHasSystemCurrent(group: NodeRuntimeGroup): boolean {
  return group.isSystemCurrent;
}

function groupCanSetSystemNode(group: NodeRuntimeGroup): boolean {
  return runtimeIsAvailable(group.effectiveRuntime) && !group.isSystemCurrent;
}

function progressText(runtime: NodeVersion): string {
  const progress = nodeStore.installProgress[runtime.version];
  if (!progress) return '';
  if (progress.phase === 'downloading' && typeof progress.percent === 'number') {
    return `${t('nodes.phaseDownloading')} ${progress.percent}%`;
  }
  const phaseKey = {
    preparing: 'nodes.phasePreparing',
    resolving: 'nodes.phaseResolving',
    verifying: 'nodes.phaseVerifying',
    extracting: 'nodes.phaseExtracting',
    finalizing: 'nodes.phaseFinalizing',
    validating: 'nodes.phaseValidating',
    cleanup: 'nodes.phaseCleanup',
    complete: 'nodes.phaseComplete',
  }[progress.phase];
  return phaseKey ? t(phaseKey) : progress.phase;
}

function projectIsRunning(project: Project): boolean {
  return Object.entries(projectStore.runningStatus).some(([key, running]) => running && key.startsWith(`${project.id}:`));
}

function runtimeUsages(runtime: NodeVersion): ProjectRuntimeUsage[] {
  return getProjectsUsingRuntime(
    projectStore.projects,
    runtime,
    nodeStore.versions,
    nodeStore.appDefault,
    nodeStore.systemNodeRuntime,
  );
}

function canonicalRuntimeUsages(canonical: CanonicalNodeRuntime): ProjectRuntimeUsage[] {
  const usages = new Map<string, ProjectRuntimeUsage>();
  for (const runtime of canonical.variants) {
    for (const usage of runtimeUsages(runtime)) {
      if (!usages.has(usage.project.id)) usages.set(usage.project.id, usage);
    }
  }
  return [...usages.values()];
}

function projectsUsingRuntime(runtime: NodeVersion): Project[] {
  return runtimeUsages(runtime).map(usage => usage.project);
}

function runtimeIsRunning(runtime: NodeVersion): boolean {
  return projectsUsingRuntime(runtime).some(projectIsRunning);
}

function groupProjectsUsingRuntime(group: NodeRuntimeGroup): Project[] {
  return groupUsageEntries(group).map(usage => usage.project);
}

function groupUsageEntries(group: NodeRuntimeGroup): ProjectRuntimeUsage[] {
  const usages = new Map<string, ProjectRuntimeUsage>();
  for (const canonical of group.canonicalRuntimes) {
    for (const runtime of canonical.variants.filter(item => item.source !== 'system')) {
      for (const usage of runtimeUsages(runtime)) {
        if (!usages.has(usage.project.id)) usages.set(usage.project.id, usage);
      }
    }
  }
  return [...usages.values()];
}

function groupUsageLabel(group: NodeRuntimeGroup): string {
  const projects = groupProjectsUsingRuntime(group);
  if (!projects.length) return t('nodes.noProjectUsage');
  const running = projects.filter(projectIsRunning).length;
  return running ? t('nodes.projectUsageRunning', { count: projects.length, running }) : t('nodes.projectUsage', { count: projects.length });
}

function canonicalStatusLabel(canonical: CanonicalNodeRuntime): string {
  if (canonical.variants.some(runtime => runtime.status === 'installing' || nodeStore.installProgress[runtime.version])) {
    return t('nodes.installing');
  }
  return canonical.variants.some(runtimeIsAvailable) ? t('nodes.available') : t('nodes.broken');
}

function canonicalStatusTone(canonical: CanonicalNodeRuntime): string {
  if (canonical.variants.some(runtime => runtime.status === 'installing' || nodeStore.installProgress[runtime.version])) {
    return 'text-blue-500';
  }
  return canonical.variants.some(runtimeIsAvailable)
    ? 'text-emerald-600 dark:text-emerald-300'
    : 'text-amber-600 dark:text-amber-300';
}

function showRuntimeDetails(group: NodeRuntimeGroup): void {
  selectedRuntimeDetailsGroup.value = group;
  showRuntimeDetailsDialog.value = true;
}

function openFolder(path: string): void {
  if (!path) return;
  api.openFolder(path).catch(error => ElMessage.error(`${t('common.error')}: ${error}`));
}

function openManagedRuntimeRoot(): void {
  nodeStore.openManagedRuntimeRoot().catch(error => {
    ElMessage.error(`${t('common.error')}: ${error}`);
  });
}

async function refresh(): Promise<void> {
  try {
    await nodeStore.loadRuntimes();
    ElMessage.success(t('common.success'));
  } catch (error: any) {
    ElMessage.error(error?.message || t('common.error'));
  }
}

async function validateRuntime(runtime: NodeVersion): Promise<void> {
  try {
    await nodeStore.validateRuntime(getNodeRuntimeId(runtime));
    ElMessage.success(t('nodes.validationSuccess'));
  } catch (error: any) {
    ElMessage.error(error?.message || t('nodes.validationFailed'));
  }
}

async function setProjectManagerDefault(runtime: NodeVersion): Promise<void> {
  try {
    await nodeStore.setAppDefaultNode(runtime);
    ElMessage.success(t('nodes.projectManagerDefaultSaved'));
  } catch (error: any) {
    ElMessage.error(error?.message || t('common.error'));
  }
}

function promptRuntimeAction(action: RuntimeAction, group: NodeRuntimeGroup): void {
  const runtime = group.effectiveRuntime;
  if (!runtimeIsAvailable(runtime)) return;
  if (action === 'project-manager-default') void setProjectManagerDefault(runtime);
  else void executeSystemNodeSwitch(runtime);
}

async function executeSystemNodeSwitch(runtime: NodeVersion, elevated = false): Promise<void> {
  if (!nodeStore.systemNodeSwitchSupported) {
    ElMessage.info(t('nodes.systemSwitchUnsupported'));
    return;
  }
  let result;
  try {
    result = await nodeStore.switchSystemNode(runtime, { elevated });
  } catch (error: any) {
    ElMessage.error(error?.message || t('nodes.systemNodeSwitchFailed'));
    return;
  }

  if (result.status === 'elevation-required' && !elevated) {
    try {
      await ElMessageBox.confirm(
        t('nodes.elevationRequiredMessage'),
        t('nodes.elevationRequiredTitle'),
        {
          confirmButtonText: t('nodes.elevatedContinue'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
          distinguishCancelAndClose: true,
        },
      );
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      return;
    }
    await executeSystemNodeSwitch(runtime, true);
    return;
  }

  if (result.status === 'switched') {
    ElMessage.success(t('nodes.systemNodeSwitchSuccess', { version: runtime.version }));
    void nodeStore.refreshRuntimeRegistryAfterSystemSwitch().catch(() => {
      ElMessage.warning({
        message: t('nodes.backgroundRefreshFailed'),
        duration: 6000,
      });
    });
  } else if (result.status === 'already-active') {
    ElMessage.info(t('nodes.alreadySystemNode'));
  } else if (result.status === 'cancelled') {
    ElMessage.info(t('nodes.systemSwitchCancelled'));
  } else {
    const errorKey: Record<string, string> = {
      runtime_unavailable: 'nodes.runtimeUnavailable',
      controller_link_failed: 'nodes.systemNodeSwitchFailed',
      user_path_write_failed: 'nodes.userPathWriteFailed',
      machine_path_write_failed: 'nodes.machinePathWriteFailed',
      verification_failed: 'nodes.verificationFailed',
      rollback_failed: 'nodes.rollbackFailed',
      elevated_operation_timeout: 'nodes.elevatedOperationTimeout',
      elevation_required: 'nodes.elevationRequiredMessage',
      unsupported_platform: 'nodes.systemSwitchUnsupported',
    };
    ElMessage.error(t(errorKey[result.errorCode || ''] || 'nodes.systemNodeSwitchFailed', {
      detail: result.message || '',
    }));
  }
}

async function openRuntimeTerminal(runtime: NodeVersion): Promise<void> {
  try {
    await nodeStore.openTerminalWithRuntime(runtime);
  } catch (error: any) {
    ElMessage.error(error?.message || t('common.error'));
  }
}

async function openPlainTerminal(): Promise<void> {
  try {
    await nodeStore.openSystemTerminal();
  } catch (error: any) {
    ElMessage.error(error?.message || t('common.error'));
  }
}

async function copyPath(path: string): Promise<void> {
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    ElMessage.success(t('nodes.pathCopied'));
  } catch (error: any) {
    ElMessage.error(error?.message || t('common.error'));
  }
}

function showUsage(runtime: NodeVersion, group: NodeRuntimeGroup | null = null): void {
  selectedUsageRuntime.value = runtime;
  selectedUsageGroup.value = group;
  selectedUsageCanonical.value = null;
  usageSearchQuery.value = '';
  showUsageDialog.value = true;
}

function showGroupUsage(group: NodeRuntimeGroup): void {
  showUsage(primaryRuntime(group), group);
}

function showCanonicalUsage(canonical: CanonicalNodeRuntime): void {
  selectedUsageRuntime.value = canonical.runtime;
  selectedUsageGroup.value = null;
  selectedUsageCanonical.value = canonical;
  usageSearchQuery.value = '';
  showUsageDialog.value = true;
}

const selectedUsageEntries = computed<ProjectRuntimeUsage[]>(() => {
  const usages = selectedUsageCanonical.value
    ? canonicalRuntimeUsages(selectedUsageCanonical.value)
    : selectedUsageGroup.value
    ? groupUsageEntries(selectedUsageGroup.value)
    : selectedUsageRuntime.value
      ? runtimeUsages(selectedUsageRuntime.value)
      : [];
  const query = usageSearchQuery.value.trim().toLowerCase();
  return usages.filter(({ project }) => {
    if (!query) return true;
    return `${project.name} ${project.path}`.toLowerCase().includes(query);
  });
});

function usageReasonLabel(reason: RuntimeUsageReason, project: Project): string {
  if (reason === 'runtime-id') return t('nodes.usageReasonRuntime');
  if (reason === 'version') return t('nodes.usageReasonVersion', { version: project.nodeVersion || '' });
  return t('nodes.usageReasonDefault');
}

function openUsageProject(project: Project): void {
  showUsageDialog.value = false;
  emit('navigateProject', project.id);
}

async function removeRuntime(runtime: NodeVersion): Promise<void> {
  if (runtime.source === 'system' || runtime.source === 'nvm') return;
  const projects = projectsUsingRuntime(runtime);
  if (runtime.source === 'managed' && runtimeIsRunning(runtime)) {
    ElMessage.warning(t('nodes.uninstallRunning'));
    return;
  }

  const details = projects.length
    ? `\n${t('nodes.uninstallReferenced', { count: projects.length })}`
    : '';
  const message = runtime.source === 'managed'
    ? `${t('nodes.uninstallConfirm', { version: runtime.version })}${details}`
    : t('nodes.removeCustomConfirm');

  try {
    await ElMessageBox.confirm(message, t('common.warning'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    });
    if (runtime.source === 'managed') {
      await nodeStore.uninstallManagedNode(runtime.version);
    } else {
      nodeStore.removeNode(getNodeRuntimeId(runtime));
    }
    ElMessage.success(t('common.success'));
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error?.message || t('common.error'));
  }
}

function openStorageDialog(): void {
  const location = nodeStore.managedLocation;
  storageMode.value = location?.mode || settingsStore.settings.managedNodeRuntimeLocation?.mode || 'app-data';
  customStoragePath.value = location?.customPath || settingsStore.settings.managedNodeRuntimeLocation?.customPath || '';
  migrateExisting.value = true;
  showStorageDialog.value = true;
}

async function selectStorageFolder(): Promise<void> {
  const selected = await api.openDialog({ directory: true, multiple: false });
  if (selected && typeof selected === 'string') customStoragePath.value = selected;
}

async function saveStorageLocation(): Promise<void> {
  if (storageMode.value === 'custom' && !customStoragePath.value.trim()) {
    ElMessage.warning(t('nodes.customLocationRequired'));
    return;
  }
  if (storageMode.value === 'portable' && !portableAvailable.value) {
    ElMessage.error(t('nodes.portableUnavailable'));
    return;
  }

  const location = {
    mode: storageMode.value,
    customPath: storageMode.value === 'custom' ? customStoragePath.value.trim() : undefined,
  } as const;
  const runningRuntimePaths = managedRuntimes.value.filter(runtimeIsRunning).map(runtime => runtime.path);
  try {
    storageSaving.value = true;
    const result = await nodeStore.changeManagedRuntimeLocation(location, migrateExisting.value, runningRuntimePaths);
    showStorageDialog.value = false;
    if (result.warnings?.length) {
      ElMessage.warning(result.warnings.join('\n'));
    } else {
      ElMessage.success(t('nodes.locationSaved'));
    }
  } catch (error: any) {
    ElMessage.error(error?.message || t('nodes.locationChangeFailed'));
  } finally {
    storageSaving.value = false;
  }
}

function handleRuntimeCommand(command: string, runtime: NodeVersion, group: NodeRuntimeGroup | null = null): void {
  if (command === 'project-manager-default' && group) promptRuntimeAction('project-manager-default', group);
  if (command === 'system-node' && group) promptRuntimeAction('system-node', group);
  if (command === 'details' && group) showRuntimeDetails(group);
  if (command === 'validate') void validateRuntime(runtime);
  if (command === 'terminal') void openRuntimeTerminal(runtime);
  if (command === 'folder') openFolder(runtime.path);
  if (command === 'root') openFolder(runtime.runtimeRoot || runtime.path);
  if (command === 'copy-node') void copyPath(runtime.path);
  if (command === 'copy-root') void copyPath(runtime.runtimeRoot || runtime.path);
  if (command === 'usage') showUsage(runtime, group);
  if (command === 'remove') void removeRuntime(runtime);
}

function updateRuntimeListMode(width = runtimeListPanel.value?.clientWidth || 0): void {
  runtimeListMode.value = getRuntimeListMode(width);
}

onMounted(() => {
  updateRuntimeListMode();
  if (runtimeListPanel.value && typeof ResizeObserver !== 'undefined') {
    runtimeListResizeObserver = new ResizeObserver(entries => {
      updateRuntimeListMode(entries[0]?.contentRect.width || runtimeListPanel.value?.clientWidth || 0);
    });
    runtimeListResizeObserver.observe(runtimeListPanel.value);
  }
  void nodeStore.loadRuntimes();
});

onBeforeUnmount(() => {
  runtimeListResizeObserver?.disconnect();
  runtimeListResizeObserver = null;
});
</script>

<template>
  <div class="app-page">
    <div class="app-page-header">
      <div class="app-content-container app-page-header-main">
        <div class="app-page-heading">
          <h1 :class="isPlugin ? 'app-page-title !text-purple-500' : 'app-page-title'">{{ t('nodes.title') }}</h1>
          <p class="app-page-description">{{ t('nodes.description') }}</p>
        </div>
        <div class="app-page-actions flex flex-wrap justify-end gap-2">
          <el-button size="small" @click="openPlainTerminal">
            <el-icon><div class="i-mdi-console" /></el-icon>{{ t('nodes.openSystemTerminal') }}
          </el-button>
          <el-button type="primary" size="small" :disabled="!nodeStore.managedSupported" @click="showInstallModal = true">
            <el-icon><div class="i-mdi-download" /></el-icon>{{ t('nodes.installNode') }}
          </el-button>
          <el-button type="success" size="small" @click="showAddModal = true">
            <el-icon><div class="i-mdi-plus" /></el-icon>{{ t('nodes.addNode') }}
          </el-button>
          <el-button size="small" @click="refresh">
            <el-icon><div class="i-mdi-refresh" /></el-icon>{{ t('common.refresh') }}
          </el-button>
        </div>
      </div>
    </div>

    <div class="app-page-content overflow-y-auto">
      <div class="app-content-container space-y-4 pb-6">
        <div v-if="!nodeStore.managedSupported" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {{ t('nodes.managedUnsupported') }}
        </div>

        <div class="runtime-summary-grid">
          <section class="app-table-panel runtime-summary-card rounded-lg p-4">
            <div class="mb-4 flex items-start justify-between gap-3">
              <div>
                <div class="app-text-meta font-medium uppercase tracking-wide text-slate-400">{{ t('nodes.projectManagerDefaultNode') }}</div>
                <div v-if="defaultRuntime" class="mt-1 flex items-center gap-2">
                  <span class="font-mono text-2xl font-semibold text-slate-800 dark:text-slate-100">{{ defaultRuntime.version }}</span>
                  <el-tag :type="sourceTone(defaultRuntime.source)" effect="plain" size="small">{{ sourceLabel(defaultRuntime.source) }}</el-tag>
                </div>
                <div v-else class="mt-2 text-base font-medium text-amber-600 dark:text-amber-300">
                  {{ defaultUnavailable ? t('nodes.defaultUnavailable') : t('nodes.noDefaultNode') }}
                </div>
              </div>
              <div :class="defaultRuntime ? 'i-mdi-check-circle text-emerald-500' : 'i-mdi-alert-circle text-amber-500'" class="text-2xl" />
            </div>
            <div v-if="defaultRuntime" class="app-text-meta truncate font-mono text-slate-500 dark:text-slate-400" :title="defaultRuntime.path">{{ defaultRuntime.path }}</div>
            <div v-else-if="nodeStore.appDefault?.path" class="app-text-meta truncate font-mono text-slate-400" :title="nodeStore.appDefault.path">{{ nodeStore.appDefault.path }}</div>
            <div class="runtime-summary-card__actions mt-4 flex flex-wrap gap-2">
              <el-button v-if="defaultRuntime" size="small" @click="openRuntimeTerminal(defaultRuntime)">
                <el-icon><div class="i-mdi-console" /></el-icon>{{ t('nodes.openTerminal') }}
              </el-button>
              <el-button v-if="defaultRuntime" size="small" @click="validateRuntime(defaultRuntime)">
                <el-icon><div class="i-mdi-shield-check-outline" /></el-icon>{{ t('nodes.validate') }}
              </el-button>
              <el-button v-if="defaultRuntime" size="small" @click="openFolder(defaultRuntime.path)">
                <el-icon><div class="i-mdi-folder-open-outline" /></el-icon>{{ t('nodes.openDirectory') }}
              </el-button>
              <el-button v-if="defaultUnavailable" size="small" type="warning" plain @click="refresh">
                <el-icon><div class="i-mdi-refresh" /></el-icon>{{ t('nodes.recheck') }}
              </el-button>
            </div>
          </section>

          <section class="app-table-panel runtime-summary-card rounded-lg p-4">
            <div class="mb-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="app-text-meta font-medium uppercase tracking-wide text-slate-400">{{ t('nodes.systemCurrentNode') }}</div>
                <div v-if="nodeStore.systemNodeState?.available" class="mt-1 flex items-center gap-2">
                  <span class="font-mono text-2xl font-semibold text-slate-800 dark:text-slate-100">{{ nodeStore.systemNodeState.version }}</span>
                  <el-tag :type="nodeStore.systemNodeState.source === 'nvm' ? 'warning' : nodeStore.systemNodeState.source === 'managed' ? 'success' : 'info'" effect="plain" size="small">
                    {{ systemSourceLabel(nodeStore.systemNodeState.source) }}
                  </el-tag>
                </div>
                <div v-else class="mt-2 text-base font-medium text-amber-600 dark:text-amber-300">
                  {{ t('nodes.systemNodeUnavailable') }}
                </div>
              </div>
              <div :class="nodeStore.systemNodeState?.available ? 'i-mdi-check-circle text-emerald-500' : 'i-mdi-alert-circle text-amber-500'" class="text-2xl" />
            </div>
            <div v-if="nodeStore.systemNodeState?.nodePath" class="app-text-meta truncate font-mono text-slate-500 dark:text-slate-400" :title="nodeStore.systemNodeState.nodePath">
              {{ nodeStore.systemNodeState.nodePath }}
            </div>
            <div v-if="nodeStore.systemNodeState?.available" class="app-text-meta mt-2 text-slate-400 dark:text-slate-500">
              {{ t('nodes.terminalRestartHint') }}
            </div>
            <div v-if="!nodeStore.systemNodeSwitchSupported" class="app-text-meta mt-2 text-amber-600 dark:text-amber-300">
              {{ t('nodes.systemSwitchUnsupported') }}
            </div>
            <div class="runtime-summary-card__actions mt-4 flex flex-wrap gap-2">
              <el-button size="small" :loading="nodeStore.systemNodeLoading" :disabled="nodeStore.systemNodeSwitching" @click="nodeStore.refreshSystemNode()">
                <el-icon><div class="i-mdi-refresh" /></el-icon>{{ t('nodes.recheckSystemNode') }}
              </el-button>
              <span v-if="nodeStore.systemNodeSwitching" class="app-text-meta self-center text-blue-500">{{ t('nodes.systemNodeSwitching') }}</span>
            </div>
          </section>

          <section class="app-table-panel runtime-summary-card runtime-summary-card--storage rounded-lg p-4">
            <div class="mb-3 flex items-start justify-between gap-3">
              <div>
                <div class="app-text-meta font-medium uppercase tracking-wide text-slate-400">{{ t('nodes.managedRuntime') }}</div>
                <div class="mt-2 flex items-center gap-2">
                  <el-tag effect="plain" type="success" size="small">{{ t(`nodes.locationMode.${nodeStore.managedLocation?.mode || 'app-data'}`) }}</el-tag>
                  <span class="text-sm text-slate-500 dark:text-slate-400">{{ t('nodes.installedCount', { count: managedRuntimes.length }) }}</span>
                </div>
              </div>
              <div class="i-mdi-database-cog-outline text-2xl text-emerald-500" />
            </div>
            <div class="app-text-meta truncate font-mono text-slate-500 dark:text-slate-400" :title="managedRootLabel">{{ managedRootLabel }}</div>
            <div class="app-text-meta mt-1 flex items-center gap-1 text-slate-400">
              <el-icon v-if="nodeStore.managedLocationLoading"><div class="i-mdi-loading animate-spin" /></el-icon>
              <span>{{ managedStorageText }}</span>
            </div>
            <div class="runtime-summary-card__actions mt-4 flex flex-wrap gap-2">
              <el-button size="small" @click="openStorageDialog">
                <el-icon><div class="i-mdi-swap-horizontal" /></el-icon>{{ t('nodes.changeLocation') }}
              </el-button>
              <el-button size="small" :disabled="!managedRoot" @click="openManagedRuntimeRoot">
                <el-icon><div class="i-mdi-folder-open-outline" /></el-icon>{{ t('nodes.openDirectory') }}
              </el-button>
            </div>
          </section>
        </div>

        <section class="app-table-panel rounded-lg p-4">
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">{{ t('nodes.sourceOverview') }}</h2>
              <p class="app-text-meta mt-1 text-slate-500 dark:text-slate-400">{{ t('nodes.sourceOverviewHint') }}</p>
            </div>
            <el-button size="small" @click="refresh">
              <el-icon><div class="i-mdi-refresh" /></el-icon>{{ t('nodes.rescanNvm') }}
            </el-button>
          </div>
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div v-for="source in sourceOrder" :key="source" class="rounded-lg border border-slate-200/80 bg-white/30 px-3 py-3 dark:border-slate-700/70 dark:bg-slate-900/20">
              <div class="app-text-meta text-slate-500 dark:text-slate-400">{{ sourceLabel(source) }}</div>
              <div class="mt-1 text-xl font-semibold text-slate-800 dark:text-slate-100">{{ sourceCounts[source] }}</div>
            </div>
          </div>
          <div v-if="nvmRoots.length" class="app-text-meta mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
            <span class="font-medium text-emerald-600 dark:text-emerald-300">{{ t('nodes.nvmDetected') }}</span>
            <span v-for="root in nvmRoots" :key="root" class="font-mono">{{ root }}</span>
            <span>{{ t('nodes.nvmVersionCount', { count: sourceCounts.nvm }) }}</span>
          </div>
          <div v-else class="app-text-meta mt-4 text-slate-400">{{ t('nodes.nvmNotDetected') }}</div>
        </section>

        <section ref="runtimeListPanel" class="app-table-panel runtime-list-panel rounded-lg p-0">
          <div class="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-700/70">
            <div>
              <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">{{ t('nodes.allRuntimes') }}</h2>
              <p class="app-text-meta mt-1 text-slate-500 dark:text-slate-400">{{ t('nodes.runtimeListHint') }}</p>
            </div>
              <span class="app-text-meta text-slate-400">{{ runtimeGroups.length }}</span>
          </div>
          <div v-if="runtimeGroups.length && runtimeListMode !== 'card'" class="runtime-table-view">
            <el-table :data="runtimeGroups" row-key="key" style="width: 100%" :row-style="{ background: 'transparent' }" class="custom-table">
              <el-table-column :label="t('nodes.version')" :min-width="runtimeListMode === 'table' ? 180 : 150">
                <template #default="{ row }">
                  <div class="flex min-w-0 flex-col gap-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <span class="font-mono font-semibold text-slate-800 dark:text-slate-100">{{ row.version }}</span>
                      <el-tag v-if="groupHasAppDefault(row)" type="success" effect="plain" size="small">{{ t('nodes.projectManagerDefault') }}</el-tag>
                      <el-tag v-if="groupHasSystemCurrent(row)" type="info" effect="plain" size="small">{{ t('nodes.systemCurrent') }}</el-tag>
                    </div>
                    <span v-if="groupProgressText(row)" class="app-text-meta text-blue-500">{{ groupProgressText(row) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="t('nodes.source')" :min-width="runtimeListMode === 'table' ? 170 : 125">
                <template #default="{ row }">
                  <el-tag :type="sourceTone(row.effectiveRuntime.source)" effect="plain" size="small">
                    {{ sourceLabel(row.effectiveRuntime.source) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="runtimeListMode === 'table'" :label="t('nodes.status')" width="110">
                <template #default="{ row }">
                  <span :class="groupStatusTone(row)" class="app-text-meta">{{ groupStatusLabel(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('nodes.path')" :min-width="runtimeListMode === 'table' ? 220 : 190" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="app-text-meta block truncate font-mono text-slate-500 dark:text-slate-400" :title="primaryRuntime(row).path">{{ primaryRuntime(row).path || t('nodes.installing') }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('nodes.usage')" :min-width="runtimeListMode === 'table' ? 145 : 115">
                <template #default="{ row }">
                  <span :class="groupProjectsUsingRuntime(row).length ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'" class="app-text-meta">{{ groupUsageLabel(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('nodes.actions')" :width="runtimeListMode === 'table' ? 500 : 190" fixed="right" align="right">
                <template #default="{ row }">
                  <div :class="['runtime-table-actions', runtimeListMode === 'table' ? 'runtime-table-actions--wide' : 'runtime-table-actions--compact']">
                    <template v-if="runtimeListMode === 'table'">
                      <div class="runtime-action-slot runtime-action-slot--icon">
                        <el-tooltip v-if="groupProjectsUsingRuntime(row).length" :content="t('nodes.viewUsage')" placement="top">
                          <el-button text circle size="small" @click="showGroupUsage(row)">
                            <div class="i-mdi-account-multiple-outline" />
                          </el-button>
                        </el-tooltip>
                        <span v-else class="runtime-action-placeholder" aria-hidden="true" />
                      </div>
                      <div class="runtime-action-slot runtime-action-slot--text runtime-action-slot--app-default">
                        <el-button v-if="groupCanSetAppDefault(row)" class="runtime-action-button" text type="primary" size="small" @click="promptRuntimeAction('project-manager-default', row)">
                          {{ t('nodes.setProjectManagerDefault') }}
                        </el-button>
                        <span v-else class="runtime-action-placeholder" aria-hidden="true" />
                      </div>
                      <div class="runtime-action-slot runtime-action-slot--text runtime-action-slot--system-node">
                        <el-button v-if="groupCanSetSystemNode(row)" class="runtime-action-button" text type="warning" size="small" :disabled="nodeStore.systemNodeSwitching || !nodeStore.systemNodeSwitchSupported" @click="promptRuntimeAction('system-node', row)">
                          {{ t('nodes.setSystemNode') }}
                        </el-button>
                        <span v-else class="runtime-action-placeholder" aria-hidden="true" />
                      </div>
                      <div class="runtime-action-slot runtime-action-slot--icon">
                        <el-tooltip :content="t('nodes.openTerminal')" placement="top">
                          <el-button text circle size="small" :disabled="!runtimeIsAvailable(primaryRuntime(row))" @click="openRuntimeTerminal(primaryRuntime(row))">
                            <div class="i-mdi-console" />
                          </el-button>
                        </el-tooltip>
                      </div>
                      <div class="runtime-action-slot runtime-action-slot--icon">
                        <el-dropdown trigger="click" @command="(command: string) => handleRuntimeCommand(command, primaryRuntime(row), row)">
                          <el-button text circle size="small" :title="t('nodes.actions')"><div class="i-mdi-dots-vertical" /></el-button>
                          <template #dropdown>
                            <el-dropdown-menu>
                              <el-dropdown-item command="details">{{ t('nodes.runtimeDetails') }}</el-dropdown-item>
                              <el-dropdown-item command="validate">{{ t('nodes.validate') }}</el-dropdown-item>
                              <el-dropdown-item command="folder">{{ t('nodes.openDirectory') }}</el-dropdown-item>
                              <el-dropdown-item v-if="primaryRuntime(row).source === 'nvm'" command="root">{{ t('nodes.openNvmDirectory') }}</el-dropdown-item>
                              <el-dropdown-item command="copy-node">{{ t('nodes.copyNodePath') }}</el-dropdown-item>
                              <el-dropdown-item command="copy-root">{{ t('nodes.copyRuntimePath') }}</el-dropdown-item>
                              <el-dropdown-item command="usage">{{ t('nodes.viewUsage') }}</el-dropdown-item>
                              <el-dropdown-item v-if="primaryRuntime(row).source === 'managed' || primaryRuntime(row).source === 'custom'" divided command="remove">
                                {{ primaryRuntime(row).source === 'managed' ? t('nodes.uninstall') : t('nodes.removeCustom') }}
                              </el-dropdown-item>
                            </el-dropdown-menu>
                          </template>
                        </el-dropdown>
                      </div>
                    </template>
                    <template v-else>
                      <el-tooltip v-if="groupProjectsUsingRuntime(row).length" :content="t('nodes.viewUsage')" placement="top">
                        <el-button text circle size="small" @click="showGroupUsage(row)">
                          <div class="i-mdi-account-multiple-outline" />
                        </el-button>
                      </el-tooltip>
                      <el-tooltip v-if="groupCanSetAppDefault(row)" :content="t('nodes.setProjectManagerDefault')" placement="top">
                        <el-button text circle size="small" :disabled="nodeStore.systemNodeSwitching" @click="promptRuntimeAction('project-manager-default', row)">
                          <div class="i-mdi-star-outline" />
                        </el-button>
                      </el-tooltip>
                      <el-tooltip v-if="groupCanSetSystemNode(row)" :content="t('nodes.setSystemNode')" placement="top">
                        <el-button text circle size="small" type="warning" :disabled="nodeStore.systemNodeSwitching || !nodeStore.systemNodeSwitchSupported" @click="promptRuntimeAction('system-node', row)">
                          <div class="i-mdi-swap-horizontal" />
                        </el-button>
                      </el-tooltip>
                      <el-tooltip :content="t('nodes.openTerminal')" placement="top">
                        <el-button text circle size="small" :disabled="!runtimeIsAvailable(primaryRuntime(row))" @click="openRuntimeTerminal(primaryRuntime(row))">
                          <div class="i-mdi-console" />
                        </el-button>
                      </el-tooltip>
                      <el-dropdown trigger="click" @command="(command: string) => handleRuntimeCommand(command, primaryRuntime(row), row)">
                        <el-button text circle size="small" :title="t('nodes.actions')"><div class="i-mdi-dots-vertical" /></el-button>
                        <template #dropdown>
                          <el-dropdown-menu>
                            <el-dropdown-item command="details">{{ t('nodes.runtimeDetails') }}</el-dropdown-item>
                            <el-dropdown-item v-if="groupCanSetAppDefault(row)" command="project-manager-default">{{ t('nodes.setProjectManagerDefault') }}</el-dropdown-item>
                            <el-dropdown-item v-if="groupCanSetSystemNode(row)" command="system-node">{{ t('nodes.setSystemNode') }}</el-dropdown-item>
                            <el-dropdown-item command="validate">{{ t('nodes.validate') }}</el-dropdown-item>
                            <el-dropdown-item command="folder">{{ t('nodes.openDirectory') }}</el-dropdown-item>
                            <el-dropdown-item v-if="primaryRuntime(row).source === 'nvm'" command="root">{{ t('nodes.openNvmDirectory') }}</el-dropdown-item>
                            <el-dropdown-item command="copy-node">{{ t('nodes.copyNodePath') }}</el-dropdown-item>
                            <el-dropdown-item command="copy-root">{{ t('nodes.copyRuntimePath') }}</el-dropdown-item>
                            <el-dropdown-item command="usage">{{ t('nodes.viewUsage') }}</el-dropdown-item>
                            <el-dropdown-item v-if="primaryRuntime(row).source === 'managed' || primaryRuntime(row).source === 'custom'" divided command="remove">
                              {{ primaryRuntime(row).source === 'managed' ? t('nodes.uninstall') : t('nodes.removeCustom') }}
                            </el-dropdown-item>
                          </el-dropdown-menu>
                        </template>
                      </el-dropdown>
                    </template>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div v-else-if="runtimeGroups.length" class="runtime-card-list">
            <article v-for="row in runtimeGroups" :key="row.key" class="runtime-card">
              <div class="flex min-w-0 items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="font-mono text-base font-semibold text-slate-800 dark:text-slate-100">{{ row.version }}</span>
                    <el-tag v-if="groupHasAppDefault(row)" type="success" effect="plain" size="small">{{ t('nodes.projectManagerDefault') }}</el-tag>
                    <el-tag v-if="groupHasSystemCurrent(row)" type="info" effect="plain" size="small">{{ t('nodes.systemCurrent') }}</el-tag>
                  </div>
                  <div class="mt-2 flex min-w-0 gap-1">
                    <el-tag :type="sourceTone(row.effectiveRuntime.source)" effect="plain" size="small">
                      {{ sourceLabel(row.effectiveRuntime.source) }}
                    </el-tag>
                  </div>
                </div>
                <span :class="groupStatusTone(row)" class="app-text-meta shrink-0">{{ groupStatusLabel(row) }}</span>
              </div>
              <div class="runtime-card__path mt-3" :title="primaryRuntime(row).path">{{ primaryRuntime(row).path || t('nodes.installing') }}</div>
              <div class="app-text-meta mt-2 text-slate-500 dark:text-slate-400">{{ groupUsageLabel(row) }}</div>
              <div class="runtime-card__actions mt-3">
                <el-button v-if="groupCanSetSystemNode(row)" size="small" type="warning" plain :disabled="nodeStore.systemNodeSwitching || !nodeStore.systemNodeSwitchSupported" @click="promptRuntimeAction('system-node', row)">
                  <el-icon><div class="i-mdi-swap-horizontal" /></el-icon>{{ t('nodes.setSystemNode') }}
                </el-button>
                <el-tooltip :content="t('nodes.openTerminal')" placement="top">
                  <el-button text circle size="small" :disabled="!runtimeIsAvailable(primaryRuntime(row))" @click="openRuntimeTerminal(primaryRuntime(row))">
                    <div class="i-mdi-console" />
                  </el-button>
                </el-tooltip>
                <el-tooltip v-if="groupProjectsUsingRuntime(row).length" :content="t('nodes.viewUsage')" placement="top">
                  <el-button text circle size="small" @click="showGroupUsage(row)">
                    <div class="i-mdi-account-multiple-outline" />
                  </el-button>
                </el-tooltip>
                <el-dropdown trigger="click" @command="(command: string) => handleRuntimeCommand(command, primaryRuntime(row), row)">
                  <el-button text circle size="small" :title="t('nodes.actions')"><div class="i-mdi-dots-vertical" /></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="details">{{ t('nodes.runtimeDetails') }}</el-dropdown-item>
                      <el-dropdown-item v-if="groupCanSetAppDefault(row)" command="project-manager-default">{{ t('nodes.setProjectManagerDefault') }}</el-dropdown-item>
                      <el-dropdown-item v-if="groupCanSetSystemNode(row)" command="system-node">{{ t('nodes.setSystemNode') }}</el-dropdown-item>
                      <el-dropdown-item command="validate">{{ t('nodes.validate') }}</el-dropdown-item>
                      <el-dropdown-item command="folder">{{ t('nodes.openDirectory') }}</el-dropdown-item>
                      <el-dropdown-item v-if="primaryRuntime(row).source === 'nvm'" command="root">{{ t('nodes.openNvmDirectory') }}</el-dropdown-item>
                      <el-dropdown-item command="copy-node">{{ t('nodes.copyNodePath') }}</el-dropdown-item>
                      <el-dropdown-item command="copy-root">{{ t('nodes.copyRuntimePath') }}</el-dropdown-item>
                      <el-dropdown-item command="usage">{{ t('nodes.viewUsage') }}</el-dropdown-item>
                      <el-dropdown-item v-if="primaryRuntime(row).source === 'managed' || primaryRuntime(row).source === 'custom'" divided command="remove">
                        {{ primaryRuntime(row).source === 'managed' ? t('nodes.uninstall') : t('nodes.removeCustom') }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </article>
          </div>
          <div v-if="!runtimeGroups.length && !nodeStore.loading" class="px-4 py-12 text-center text-sm text-slate-400">{{ t('nodes.noNodes') }}</div>
        </section>
      </div>
    </div>

    <AddNodeModal v-model="showAddModal" />
    <InstallNodeModal v-model="showInstallModal" />

    <el-dialog v-model="showStorageDialog" :title="t('nodes.changeLocation')" width="560px" align-center destroy-on-close>
      <el-form label-position="top">
        <el-form-item :label="t('nodes.locationModeLabel')">
          <el-radio-group v-model="storageMode" class="flex flex-col items-start gap-2">
            <el-radio value="app-data">{{ t('nodes.locationMode.app-data') }}</el-radio>
            <el-radio value="custom">{{ t('nodes.locationMode.custom') }}</el-radio>
            <el-radio value="portable" :disabled="!portableAvailable">{{ t('nodes.locationMode.portable') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="storageMode === 'custom'" :label="t('nodes.customLocationLabel')">
          <el-input v-model="customStoragePath" :placeholder="t('nodes.customLocationPlaceholder')">
            <template #append><el-button @click="selectStorageFolder"><div class="i-mdi-folder" /></el-button></template>
          </el-input>
        </el-form-item>
        <div v-if="storageMode === 'portable' && !portableAvailable" class="app-text-control rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{{ t('nodes.portableUnavailable') }}</div>
        <div v-if="managedRuntimes.length" class="mt-2 rounded-lg border border-slate-200/70 px-3 py-3 dark:border-slate-700/70">
          <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('nodes.existingManagedRuntimes', { count: managedRuntimes.length }) }}</div>
          <el-radio-group v-model="migrateExisting" class="flex flex-col items-start gap-2">
            <el-radio :value="true">{{ t('nodes.migrateExisting') }}</el-radio>
            <el-radio :value="false">{{ t('nodes.switchWithoutMigration') }}</el-radio>
          </el-radio-group>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showStorageDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="storageSaving" @click="saveStorageLocation">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showUsageDialog" :title="t('nodes.viewUsage')" width="720px" align-center class="runtime-usage-dialog">
      <div v-if="selectedUsageRuntime" class="mb-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-mono text-base font-semibold text-slate-800 dark:text-slate-100">{{ selectedUsageRuntime.version }}</span>
            <el-tag :type="sourceTone(selectedUsageRuntime.source)" effect="plain" size="small">{{ sourceLabel(selectedUsageRuntime.source) }}</el-tag>
          </div>
          <div class="app-text-meta mt-1 text-slate-500 dark:text-slate-400">
            {{ t('nodes.usageSummary', { count: selectedUsageEntries.length }) }}
          </div>
        </div>
        <div class="i-mdi-account-multiple-outline shrink-0 text-xl text-slate-400" />
      </div>
      <el-input v-model="usageSearchQuery" clearable :placeholder="t('nodes.usageSearchPlaceholder')" class="mb-3">
        <template #prefix><el-icon><div class="i-mdi-magnify" /></el-icon></template>
      </el-input>
      <div v-if="selectedUsageEntries.length" class="runtime-usage-list">
        <button v-for="usage in selectedUsageEntries" :key="usage.project.id" type="button" class="runtime-usage-item" @click="openUsageProject(usage.project)">
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{{ usage.project.name }}</span>
            <span class="mt-0.5 block truncate font-mono app-text-meta text-slate-400" :title="usage.project.path">{{ usage.project.path }}</span>
            <span class="mt-1 block truncate app-text-meta text-slate-500 dark:text-slate-400">{{ usageReasonLabel(usage.reason, usage.project) }}</span>
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <el-tag v-if="projectIsRunning(usage.project)" type="warning" effect="plain" size="small">{{ t('nodes.running') }}</el-tag>
            <span class="i-mdi-chevron-right text-base text-slate-400" />
          </span>
        </button>
      </div>
      <div v-else class="py-8 text-center text-sm text-slate-400">
        {{ usageSearchQuery ? t('nodes.usageNoMatch') : t('nodes.noProjectUsage') }}
      </div>
    </el-dialog>

    <el-dialog v-model="showRuntimeDetailsDialog" :title="t('nodes.runtimeDetails')" width="820px" align-center class="runtime-details-dialog">
      <div v-if="selectedRuntimeDetailsGroup" class="mb-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-mono text-base font-semibold text-slate-800 dark:text-slate-100">{{ selectedRuntimeDetailsGroup.version }}</span>
            <span class="app-text-meta text-slate-500 dark:text-slate-400">{{ t('nodes.runtimeDetailsHint') }}</span>
          </div>
        </div>
        <div class="i-mdi-source-branch shrink-0 text-xl text-slate-400" />
      </div>
      <div v-if="selectedRuntimeDetails.length" class="runtime-details-list">
        <article v-for="canonical in selectedRuntimeDetails" :key="canonical.canonicalId" class="runtime-details-item">
          <div class="runtime-details-item__main">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <el-tag :type="sourceTone(canonical.preferredSource)" effect="plain" size="small">{{ sourceLabel(canonical.preferredSource) }}</el-tag>
              <el-tag v-if="canonical.isProjectManagerDefault" type="success" effect="plain" size="small">{{ t('nodes.projectManagerDefault') }}</el-tag>
              <el-tag v-if="canonical.isSystemCurrent" type="info" effect="plain" size="small">{{ t('nodes.systemCurrent') }}</el-tag>
              <span :class="canonicalStatusTone(canonical)" class="app-text-meta">{{ canonicalStatusLabel(canonical) }}</span>
            </div>
            <div class="app-text-meta mt-2 truncate font-mono text-slate-600 dark:text-slate-300" :title="canonical.runtimePath">{{ canonical.runtimePath }}</div>
            <div class="app-text-meta mt-1 text-slate-400">
              {{ canonicalRuntimeUsages(canonical).length ? t('nodes.projectUsage', { count: canonicalRuntimeUsages(canonical).length }) : t('nodes.noProjectUsage') }}
            </div>
          </div>
          <div class="runtime-details-item__actions">
            <el-button size="small" @click="openFolder(canonical.runtimePath)">
              <el-icon><div class="i-mdi-folder-open-outline" /></el-icon>{{ t('nodes.openDirectory') }}
            </el-button>
            <el-button v-if="canonical.preferredSource === 'nvm'" size="small" @click="openFolder(canonical.runtime.runtimeRoot || canonical.runtimePath)">
              <el-icon><div class="i-mdi-folder-network-outline" /></el-icon>{{ t('nodes.openNvmDirectory') }}
            </el-button>
            <el-button size="small" @click="copyPath(canonical.runtimePath)">
              <el-icon><div class="i-mdi-content-copy" /></el-icon>{{ t('nodes.copyRuntimePath') }}
            </el-button>
            <el-button size="small" @click="validateRuntime(canonical.runtime)">
              <el-icon><div class="i-mdi-shield-check-outline" /></el-icon>{{ t('nodes.validate') }}
            </el-button>
            <el-button size="small" @click="showCanonicalUsage(canonical)">
              <el-icon><div class="i-mdi-account-multiple-outline" /></el-icon>{{ t('nodes.viewUsage') }}
            </el-button>
            <el-button v-if="canonical.preferredSource === 'managed'" size="small" type="danger" plain @click="removeRuntime(canonical.runtime)">
              <el-icon><div class="i-mdi-delete-outline" /></el-icon>{{ t('nodes.uninstall') }}
            </el-button>
            <el-button v-if="canonical.preferredSource === 'custom'" size="small" type="danger" plain @click="removeRuntime(canonical.runtime)">
              <el-icon><div class="i-mdi-delete-outline" /></el-icon>{{ t('nodes.removeCustom') }}
            </el-button>
          </div>
        </article>
      </div>
      <div v-else class="py-8 text-center text-sm text-slate-400">{{ t('nodes.noNodes') }}</div>
    </el-dialog>
  </div>
</template>

<style scoped>
.app-page-content > .app-content-container {
  container-type: inline-size;
}

.runtime-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.runtime-summary-card {
  display: flex;
  min-width: 0;
  min-height: 188px;
  flex-direction: column;
}

.runtime-summary-card__actions {
  min-height: 32px;
}

.runtime-list-panel {
  min-width: 0;
  overflow: hidden;
}

.runtime-table-view {
  min-width: 0;
  overflow-x: auto;
}

.runtime-table-actions {
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  min-width: max-content;
  white-space: nowrap;
}

.runtime-table-actions--wide {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  grid-template-columns: 32px minmax(190px, 1fr) 160px 32px 32px;
  column-gap: 4px;
}

.runtime-table-actions--compact {
  display: flex;
  gap: 4px;
}

.runtime-action-slot {
  display: flex;
  min-width: 0;
  align-items: center;
}

.runtime-action-slot--icon {
  justify-content: center;
}

.runtime-action-slot--text {
  justify-content: flex-end;
}

.runtime-action-slot--app-default {
  min-width: 190px;
}

.runtime-action-slot--system-node {
  min-width: 160px;
}

.runtime-action-button {
  flex: 0 0 auto;
  min-width: 0;
  justify-content: center;
  white-space: nowrap;
}

.runtime-action-placeholder {
  display: block;
  width: 100%;
  height: 1px;
}

.runtime-card-list {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.runtime-card {
  min-width: 0;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 12px;
  background: transparent;
}

.runtime-card__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  color: var(--app-text-muted);
}

.runtime-card__actions {
  display: flex;
  min-width: 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  white-space: nowrap;
}

.runtime-card__actions > * {
  flex: 0 0 auto;
}

.runtime-details-list {
  display: grid;
  max-height: 70vh;
  gap: 10px;
  overflow-y: auto;
  padding: 1px 4px 4px 1px;
}

.runtime-details-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  min-width: 0;
  align-items: center;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 12px;
}

.runtime-details-item__main {
  min-width: 0;
}

.runtime-details-item__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

::deep(.runtime-details-dialog) {
  max-width: calc(100vw - 24px);
}

@container (max-width: 1100px) {
  .runtime-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .runtime-summary-card--storage {
    grid-column: 1 / -1;
  }
}

@container (max-width: 700px) {
  .runtime-summary-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .runtime-summary-card--storage {
    grid-column: auto;
  }
}

:deep(.el-table) {
  --el-table-header-bg-color: transparent;
}

:deep(.el-table th.el-table__cell) {
  background-color: transparent !important;
}

:deep(.el-table__body tr:hover > td) {
  background-color: var(--app-primary-soft) !important;
}

.runtime-usage-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  max-height: max(72px, calc(70vh - 132px));
  min-height: 0;
  overflow-y: auto;
  padding: 1px 4px 4px 1px;
}

.runtime-usage-item {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 82px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 10px;
  background: transparent;
  text-align: left;
  transition: background-color var(--app-duration-fast) var(--app-ease);
}

.runtime-usage-item:hover {
  background: var(--app-primary-soft);
}

:deep(.runtime-usage-dialog .el-dialog__body) {
  max-height: 70vh;
  overflow: hidden;
}

:deep(.runtime-usage-dialog) {
  max-width: calc(100vw - 24px);
}

@media (max-width: 520px) {
  .runtime-usage-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .runtime-details-item {
    grid-template-columns: minmax(0, 1fr);
  }

  .runtime-details-item__actions {
    justify-content: flex-start;
  }
}
</style>
