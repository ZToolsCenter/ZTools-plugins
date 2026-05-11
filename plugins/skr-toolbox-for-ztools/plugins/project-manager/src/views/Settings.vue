<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useProjectStore } from '../stores/project';
import { useNodeStore } from '../stores/node';
import { api } from '../api';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { AiServiceConfig, NodeVersion, Project, Settings } from '../types';
import { isAiServiceConfigured, normalizeAiApiType, requestAiText } from '../utils/ai';
import { isAbortError } from '../utils/network';
import { ensureNodeInstallCommand } from '../utils/projectCommands';

type ImportChoice = 'keep' | 'incoming';
type ImportDiff = { key: string; label: string; current: string; incoming: string };
type ProjectConflict = { existingIndex: number; existing: Project; incoming: Project; choice: ImportChoice; diffs: ImportDiff[] };
type NodeConflict = { existingIndex: number; existing: NodeVersion; incoming: NodeVersion; choice: ImportChoice; diffs: ImportDiff[] };
type SettingsConflict = { key: keyof Settings; label: string; current: string; incoming: string; choice: ImportChoice; incomingValue: unknown };
type ImportPlan = {
  projectAdds: Project[];
  projectConflicts: ProjectConflict[];
  nodeAdds: NodeVersion[];
  nodeConflicts: NodeConflict[];
  settingsConflicts: SettingsConflict[];
};

function createDefaultAiService(overrides: Partial<AiServiceConfig> = {}): AiServiceConfig {
  return {
    apiType: 'chat_completions',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

function normalizeAiServiceConfig(value: unknown, fallback: AiServiceConfig): AiServiceConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultAiService(fallback);
  }

  const service = value as Partial<AiServiceConfig>;
  return createDefaultAiService({
    apiType: normalizeAiApiType(service.apiType || fallback.apiType),
    baseUrl: typeof service.baseUrl === 'string' ? service.baseUrl : fallback.baseUrl,
    apiKey: typeof service.apiKey === 'string' ? service.apiKey : fallback.apiKey,
    model: typeof service.model === 'string' ? service.model : fallback.model,
  });
}

function normalizeAiSettings(settings: Settings): Settings {
  return {
    ...settings,
    gitAiPrimaryService: normalizeAiServiceConfig(settings.gitAiPrimaryService, createDefaultAiService({
      baseUrl: settings.gitAiBaseUrl || 'https://api.openai.com/v1',
      apiKey: settings.gitAiApiKey || '',
      model: settings.gitAiModel || 'gpt-4o-mini',
    })),
    gitAiStream: typeof settings.gitAiStream === 'boolean' ? settings.gitAiStream : true,
  };
}

const { t } = useI18n();
const settingsStore = useSettingsStore();
const projectStore = useProjectStore();
const nodeStore = useNodeStore();
const appVersion = ref('');
const target = import.meta.env.VITE_TARGET;
const isPlugin = target === 'utools' || target === 'ztools';
const contextMenuEnabled = ref(false);
const contextMenuSupported = ref(false);
const autoLaunchEnabled = ref(false);
const aiTestLoading = ref(false);
const aiTestResult = ref<{ success: boolean; message: string } | null>(null);
const updateCheckLoading = ref(false);
const importDialogVisible = ref(false);
const importPlan = ref<ImportPlan | null>(null);
const importSourceName = ref('');

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const draft = ref<Settings>(normalizeAiSettings(deepClone(toRaw(settingsStore.settings))));
const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(settingsStore.settings));

const importSummary = computed(() => {
  const plan = importPlan.value;
  return {
    addedProjects: plan?.projectAdds.length || 0,
    conflictedProjects: plan?.projectConflicts.length || 0,
    addedNodes: plan?.nodeAdds.length || 0,
    conflictedNodes: plan?.nodeConflicts.length || 0,
    conflictedSettings: plan?.settingsConflicts.length || 0,
  };
});

function resetDraft() {
  draft.value = normalizeAiSettings(deepClone(toRaw(settingsStore.settings)));
}

function handleSave() {
  Object.assign(settingsStore.settings, normalizeAiSettings(deepClone(toRaw(draft.value))));
  ElMessage.success(t('common.success'));
}

function handleCancel() {
  resetDraft();
}

onMounted(async () => {
  appVersion.value = await api.getAppVersion();
  if (settingsStore.availableTerminals.length === 0) {
    settingsStore.fetchAvailableTerminals();
  }
  if (!isPlugin) {
    contextMenuSupported.value = await api.isContextMenuSupported();
    if (contextMenuSupported.value) contextMenuEnabled.value = await api.checkContextMenu();
    await refreshAutoLaunchState();
  }
  window.addEventListener('manual-check-update-result', handleManualUpdateResult as EventListener);
});

onBeforeUnmount(() => {
  window.removeEventListener('manual-check-update-result', handleManualUpdateResult as EventListener);
});

async function toggleContextMenu(val: boolean) {
  try {
    await api.setContextMenu(val, draft.value.locale);
    ElMessage.success(t('common.success'));
  } catch (error) {
    ElMessage.error(`${t('common.error')}: ${error}`);
    contextMenuEnabled.value = !val;
  }
}

async function toggleAutoLaunch(val: boolean) {
  try {
    const autostart = await import('@tauri-apps/plugin-autostart');
    if (val) await autostart.enable();
    else await autostart.disable();
    await refreshAutoLaunchState();
    ElMessage.success(t('common.success'));
  } catch (error) {
    ElMessage.error(`${t('common.error')}: ${error}`);
    autoLaunchEnabled.value = !val;
  }
}

async function refreshAutoLaunchState() {
  try {
    const autostart = await import('@tauri-apps/plugin-autostart');
    autoLaunchEnabled.value = await autostart.isEnabled();
  } catch (error) {
    console.error('Failed to read auto-launch state:', error);
    autoLaunchEnabled.value = false;
  }
}

async function selectExecutable() {
  try {
    const selected = await api.openDialog({
      multiple: false,
      filters: [{ name: 'Executable', extensions: ['exe', 'cmd', 'bat', 'sh', ''] }],
    });
    return typeof selected === 'string' ? selected : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function addEditor() {
  if (!draft.value.editors) draft.value.editors = [];
  draft.value.editors.push({ id: crypto.randomUUID(), name: '', path: '' });
}

function removeEditor(index: number) {
  if (!draft.value.editors || draft.value.editors.length <= 1) return;
  const removedId = draft.value.editors[index].id;
  draft.value.editors.splice(index, 1);
  if (draft.value.defaultEditorId === removedId && draft.value.editors.length > 0) {
    draft.value.defaultEditorId = draft.value.editors[0].id;
  }
}

async function browseEditorPath(index: number) {
  const selected = await selectExecutable();
  if (!selected || !draft.value.editors?.[index]) return;
  draft.value.editors[index].path = selected;
  if (!draft.value.editors[index].name) {
    draft.value.editors[index].name = selected.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') || '';
  }
}

async function addCustomTerminal() {
  const selected = await selectExecutable();
  if (!selected) return;
  if (!draft.value.customTerminals) draft.value.customTerminals = [];
  if (draft.value.customTerminals.some(item => item.id === selected)) {
    ElMessage.warning(t('settings.terminalAlreadyExists'));
    return;
  }
  draft.value.customTerminals.push({ id: selected, name: selected.split(/[/\\]/).pop() || selected });
}

function removeCustomTerminal(id: string) {
  if (!draft.value.customTerminals) return;
  draft.value.customTerminals = draft.value.customTerminals.filter(item => item.id !== id);
  if (draft.value.defaultTerminal === id) {
    draft.value.defaultTerminal = settingsStore.allTerminals[0]?.id || 'cmd';
  }
}

function createExportPayload() {
  return {
    projects: deepClone(toRaw(projectStore.projects)),
    settings: deepClone(toRaw(settingsStore.settings)),
    customNodes: deepClone(toRaw(nodeStore.versions.filter(item => item.source === 'custom'))),
  };
}

async function exportData() {
  try {
    const selected = await api.saveDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: 'frontend-manager-backup.json',
    });
    if (!selected) return;
    await api.writeTextFile(selected, JSON.stringify(createExportPayload(), null, 2));
    ElMessage.success(t('settings.exportSuccess'));
  } catch (error) {
    console.error(error);
    ElMessage.error(`${t('settings.exportError')}: ${error}`);
  }
}

function normalizeProject(project: any): Project | null {
  if (!project || !project.path) return null;
  return ensureNodeInstallCommand({
    id: typeof project.id === 'string' && project.id ? project.id : crypto.randomUUID(),
    name: project.name || project.path.split(/[\\/]/).pop() || 'Untitled',
    path: project.path,
    type: project.type === 'other' ? 'other' : 'node',
    gitRemoteUrl: typeof project.gitRemoteUrl === 'string' && project.gitRemoteUrl ? project.gitRemoteUrl : undefined,
    gitBranch: typeof project.gitBranch === 'string' && project.gitBranch ? project.gitBranch : undefined,
    gitConfigured: typeof project.gitConfigured === 'boolean' ? project.gitConfigured : undefined,
    nodeVersion: project.nodeVersion || undefined,
    packageManager: project.packageManager || 'npm',
    scripts: Array.isArray(project.scripts) ? project.scripts : [],
    visibleScripts: Array.isArray(project.visibleScripts) ? project.visibleScripts : undefined,
    customCommands: Array.isArray(project.customCommands) ? project.customCommands : [],
    projectFiles: Array.isArray(project.projectFiles) ? project.projectFiles : [],
    memo: typeof project.memo === 'string' ? project.memo : '',
    pinned: project.pinned ?? false,
    pinOrder: project.pinOrder ?? undefined,
    editorId: project.editorId || undefined,
  }, t('project.installDependencies'));
}

function normalizeSettingsPayload(settings: any): Settings {
  return normalizeAiSettings({ ...deepClone(toRaw(settingsStore.settings)), ...settings });
}

function normalizeCustomNode(node: any): NodeVersion | null {
  if (!node || !node.path) return null;
  return { version: String(node.version || ''), path: String(node.path), source: 'custom' };
}

type ImportValueOptions = {
  currentEditors?: Settings['editors'];
  incomingEditors?: Settings['editors'];
};

function resolveEditorReference(editorId: unknown, editors?: Settings['editors']) {
  if (!editorId || typeof editorId !== 'string' || !editors?.length) return null;
  const editor = editors.find(item => item.id === editorId);
  if (!editor) return null;
  return {
    name: editor.name || editor.path || 'Editor',
    path: editor.path || '',
  };
}

function normalizeImportValue(
  key: string,
  value: unknown,
  side: 'current' | 'incoming',
  options: ImportValueOptions = {},
): unknown {
  if (key === 'defaultEditorId' || key === 'editorId') {
    const editors = side === 'current' ? options.currentEditors : options.incomingEditors;
    return normalizeImportValue('editorRef', resolveEditorReference(value, editors), side, options);
  }

  if (value === undefined || value === null || value === '') return null;

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map(item => normalizeImportValue(key, item, side, options))
      .filter(item => item !== null);

    if (normalizedItems.length === 0) return null;

    return normalizedItems.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([entryKey]) => entryKey !== 'id')
      .map(([entryKey, entryValue]) => {
        const normalizedEntryValue = entryKey.toLowerCase().includes('apikey') && entryValue
          ? '******'
          : normalizeImportValue(entryKey, entryValue, side, options);
        return [entryKey, normalizedEntryValue] as const;
      })
      .filter(([, entryValue]) => entryValue !== null)
      .sort(([a], [b]) => a.localeCompare(b));

    if (normalizedEntries.length === 0) return null;
    return Object.fromEntries(normalizedEntries);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  return value;
}

function formatImportValue(
  key: string,
  value: unknown,
  side: 'current' | 'incoming',
  options: ImportValueOptions = {},
) {
  const normalizedValue = normalizeImportValue(key, value, side, options);
  if (key.toLowerCase().includes('apikey') && typeof normalizedValue === 'string' && normalizedValue) return '******';
  if (normalizedValue === null) return '-';
  if (typeof normalizedValue === 'string') return normalizedValue;
  if (typeof normalizedValue === 'number' || typeof normalizedValue === 'boolean') return String(normalizedValue);
  return JSON.stringify(normalizedValue, null, 2);
}

function buildDiffs<T extends Record<string, any>>(
  current: T,
  incoming: T,
  fields: Array<{ key: keyof T | string; label: string }>,
  options: ImportValueOptions = {},
) {
  return fields
    .filter(field => {
      const key = String(field.key);
      return JSON.stringify(normalizeImportValue(key, current[key], 'current', options))
        !== JSON.stringify(normalizeImportValue(key, incoming[key], 'incoming', options));
    })
    .map(field => ({
      key: String(field.key),
      label: field.label,
      current: formatImportValue(String(field.key), current[String(field.key)], 'current', options),
      incoming: formatImportValue(String(field.key), incoming[String(field.key)], 'incoming', options),
    }));
}

function sortNodes(nodes: NodeVersion[]) {
  return [...nodes].sort((a, b) => {
    if (a.source === 'system') return -1;
    if (b.source === 'system') return 1;
    const parse = (version: string) => version.replace(/^v/, '').split('.').map(Number);
    const aParts = parse(a.version);
    const bParts = parse(b.version);
    for (let index = 0; index < 3; index += 1) {
      if (aParts[index] !== bParts[index]) return (bParts[index] || 0) - (aParts[index] || 0);
    }
    return a.path.localeCompare(b.path);
  });
}

function normalizeDefaultEditorId(settings: Settings): Settings {
  const editors = settings.editors || [];
  if (!editors.length) {
    settings.defaultEditorId = undefined;
    return settings;
  }

  if (!settings.defaultEditorId || !editors.some(editor => editor.id === settings.defaultEditorId)) {
    settings.defaultEditorId = editors[0].id;
  }

  return settings;
}

function buildImportPlan(payload: any): ImportPlan {
  const projectFields = [
    { key: 'name', label: t('project.name') },
    { key: 'type', label: t('project.type') },
    { key: 'gitRemoteUrl', label: t('project.gitRepoUrl') },
    { key: 'gitBranch', label: t('project.gitBranch') },
    { key: 'gitConfigured', label: t('project.gitConfigured') },
    { key: 'nodeVersion', label: t('project.nodeVersion') },
    { key: 'packageManager', label: t('project.packageManager') },
    { key: 'scripts', label: t('project.scripts') },
    { key: 'visibleScripts', label: t('project.scripts') },
    { key: 'customCommands', label: t('project.customCommands') },
    { key: 'projectFiles', label: t('dashboard.files') },
    { key: 'memo', label: t('dashboard.memo') },
    { key: 'editorId', label: t('project.editor') },
  ];
  const settingsFields: Array<{ key: keyof Settings; label: string }> = [
    { key: 'editors', label: t('settings.editors') },
    { key: 'defaultEditorId', label: t('settings.defaultEditor') },
    { key: 'defaultTerminal', label: t('settings.defaultTerminal') },
    { key: 'customTerminals', label: t('settings.customTerminals') },
    { key: 'locale', label: t('settings.language') },
    { key: 'themeMode', label: t('settings.theme') },
    { key: 'autoUpdate', label: t('settings.autoUpdate') },
    { key: 'trayEnabled', label: t('settings.trayEnabled') },
    { key: 'closeAction', label: t('settings.closeAction') },
    { key: 'gitAiEnabled', label: t('settings.gitAiEnabled') },
    { key: 'gitAiPrimaryService', label: t('settings.gitAiPrimaryService') },
    { key: 'gitAiStream', label: t('settings.gitAiStream') },
    { key: 'gitAiPromptTemplate', label: t('settings.gitAiPromptTemplate') },
  ];
  const normalizedProjects = Array.isArray(payload.projects) ? payload.projects.map(normalizeProject).filter(Boolean) as Project[] : [];
  const normalizedNodes = Array.isArray(payload.customNodes) ? payload.customNodes.map(normalizeCustomNode).filter(Boolean) as NodeVersion[] : [];
  const normalizedSettings = payload.settings ? normalizeSettingsPayload(payload.settings) : null;
  const currentEditors = settingsStore.settings.editors || [];
  const incomingEditors = normalizedSettings?.editors || [];
  const plan: ImportPlan = { projectAdds: [], projectConflicts: [], nodeAdds: [], nodeConflicts: [], settingsConflicts: [] };

  normalizedProjects.forEach((incomingProject) => {
    const existingIndex = projectStore.projects.findIndex(project => project.path === incomingProject.path);
    if (existingIndex === -1) return void plan.projectAdds.push(incomingProject);
    const existingProject = projectStore.projects[existingIndex];
    const diffs = buildDiffs(existingProject as Record<string, any>, incomingProject as Record<string, any>, projectFields, {
      currentEditors,
      incomingEditors,
    });
    if (diffs.length) plan.projectConflicts.push({ existingIndex, existing: existingProject, incoming: incomingProject, choice: 'keep', diffs });
  });

  if (normalizedSettings) {
    settingsFields.forEach((field) => {
      const currentValue = (settingsStore.settings as any)[field.key];
      const incomingValue = (normalizedSettings as any)[field.key];
      if (
        JSON.stringify(normalizeImportValue(String(field.key), currentValue, 'current', { currentEditors, incomingEditors })) ===
        JSON.stringify(normalizeImportValue(String(field.key), incomingValue, 'incoming', { currentEditors, incomingEditors }))
      ) return;
      plan.settingsConflicts.push({
        key: field.key,
        label: field.label,
        current: formatImportValue(String(field.key), currentValue, 'current', { currentEditors, incomingEditors }),
        incoming: formatImportValue(String(field.key), incomingValue, 'incoming', { currentEditors, incomingEditors }),
        choice: 'keep',
        incomingValue,
      });
    });
  }

  const currentCustomNodes = nodeStore.versions.filter(item => item.source === 'custom');
  normalizedNodes.forEach((incomingNode) => {
    const existingIndex = currentCustomNodes.findIndex(item => item.path === incomingNode.path);
    if (existingIndex === -1) return void plan.nodeAdds.push(incomingNode);
    const existingNode = currentCustomNodes[existingIndex];
    const diffs = buildDiffs(existingNode as Record<string, any>, incomingNode as Record<string, any>, [
      { key: 'version', label: t('nodes.version') },
      { key: 'source', label: t('nodes.source') },
    ]);
    if (diffs.length) plan.nodeConflicts.push({ existingIndex, existing: existingNode, incoming: incomingNode, choice: 'keep', diffs });
  });

  return plan;
}

async function importData() {
  try {
    const selected = await api.openDialog({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!selected || typeof selected !== 'string') return;
    const content = await api.readTextFile(selected);
    const plan = buildImportPlan(JSON.parse(content));
    const hasChanges = plan.projectAdds.length + plan.projectConflicts.length + plan.nodeAdds.length + plan.nodeConflicts.length + plan.settingsConflicts.length > 0;
    if (!hasChanges) return void ElMessage.info(t('settings.importNoChanges'));
    importPlan.value = plan;
    importSourceName.value = selected.split(/[/\\]/).pop() || selected;
    importDialogVisible.value = true;
  } catch (error) {
    console.error(error);
    ElMessage.error(`${t('settings.importError')}: ${error}`);
  }
}

function applyImportPlan() {
  const plan = importPlan.value;
  if (!plan) return;

  const nextProjects = deepClone(toRaw(projectStore.projects));
  plan.projectAdds.forEach(project => {
    if (!nextProjects.some(item => item.path === project.path)) nextProjects.push(project);
  });
  plan.projectConflicts.forEach((conflict) => {
    if (conflict.choice !== 'incoming') return;
    nextProjects[conflict.existingIndex] = { ...deepClone(conflict.incoming), id: nextProjects[conflict.existingIndex].id };
  });
  projectStore.projects = nextProjects;

  const nextSettings = deepClone(toRaw(settingsStore.settings));
  plan.settingsConflicts.forEach((conflict) => {
    if (conflict.choice === 'incoming') (nextSettings as any)[conflict.key] = deepClone(conflict.incomingValue);
  });
  settingsStore.settings = normalizeDefaultEditorId(normalizeAiSettings(nextSettings));

  const systemNodes = nodeStore.versions.filter(item => item.source !== 'custom');
  const customNodes = deepClone(toRaw(nodeStore.versions.filter(item => item.source === 'custom')));
  plan.nodeAdds.forEach(node => {
    if (!customNodes.some(item => item.path === node.path)) customNodes.push(node);
  });
  plan.nodeConflicts.forEach((conflict) => {
    if (conflict.choice === 'incoming') customNodes[conflict.existingIndex] = deepClone(conflict.incoming);
  });
  nodeStore.versions = sortNodes([...systemNodes, ...customNodes]);

  resetDraft();
  importDialogVisible.value = false;
  importPlan.value = null;
  importSourceName.value = '';
  ElMessage.success(t('settings.importApplied'));
}

function cancelImportPreview() {
  importDialogVisible.value = false;
  importPlan.value = null;
  importSourceName.value = '';
}

function openReleases() {
  api.openUrl('https://github.com/cuteyuchen/project-manager/releases');
}

function triggerManualUpdateCheck() {
  updateCheckLoading.value = true;
  window.dispatchEvent(new CustomEvent('manual-check-update'));
}

function handleManualUpdateResult(event: Event) {
  const customEvent = event as CustomEvent<{ status: 'available' | 'latest' | 'error'; version?: string; error?: string }>;
  updateCheckLoading.value = false;
  if (customEvent.detail.status === 'latest') return void ElMessage.success(t('settings.alreadyLatest'));
  if (customEvent.detail.status === 'available') return void ElMessage.info(t('settings.updateAvailable', { version: customEvent.detail.version || '' }));
  ElMessage.error(t('settings.updateCheckFailed', { error: customEvent.detail.error || t('common.error') }));
}

async function testAiConnection() {
  const service = draft.value.gitAiPrimaryService;
  if (!isAiServiceConfigured(service)) {
    aiTestResult.value = { success: false, message: t('settings.gitAiTestMissingConfig') };
    return;
  }

  aiTestLoading.value = true;
  aiTestResult.value = null;
  try {
    await requestAiText({
      apiType: service.apiType,
      baseUrl: service.baseUrl,
      apiKey: service.apiKey,
      model: service.model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      maxTokens: normalizeAiApiType(service.apiType) === 'responses' ? 64 : 32,
      temperature: 0,
      stream: draft.value.gitAiStream,
      timeoutMs: 15000,
    });
    aiTestResult.value = { success: true, message: t('settings.gitAiTestSuccess') };
  } catch (error: any) {
    if (isAbortError(error)) aiTestResult.value = { success: false, message: t('settings.gitAiTestTimeout') };
    else if (String(error?.message || '').includes('(401 ') || String(error?.message || '').includes('(403 ')) aiTestResult.value = { success: false, message: t('settings.gitAiTestAuthError') };
    else if (String(error?.message || '').includes('(404 ')) aiTestResult.value = { success: false, message: t('settings.gitAiTestModelNotFound') };
    else if (String(error?.message || '').includes('(429 ')) aiTestResult.value = { success: false, message: t('settings.gitAiTestRateLimit') };
    else if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('Failed')) aiTestResult.value = { success: false, message: t('settings.gitAiTestUnreachable') };
    else aiTestResult.value = { success: false, message: t('settings.gitAiTestError', { error: String(error).slice(0, 200) }) };
  } finally {
    aiTestLoading.value = false;
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#0f172a] shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold text-slate-800 dark:text-white">{{ t('settings.title') }}</h1>
        <span v-if="isDirty" class="text-xs px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400 font-medium">{{ t('settings.unsavedChanges') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <el-button :disabled="!isDirty" @click="handleCancel">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isDirty" @click="handleSave">
          <div class="i-mdi-content-save text-sm mr-1" />
          {{ t('common.save') }}
        </el-button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-5">
        <div
        :class="isPlugin
          ? 'max-w-5xl mx-auto space-y-4'
          : 'max-w-7xl mx-auto xl:grid xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.25fr)] gap-4 items-start'"
      >
        <div class="space-y-4 min-w-0">
        <el-card v-if="!isPlugin" class="settings-card">
          <template #header><div class="section-title"><div class="i-mdi-rocket-launch-outline text-emerald-500 text-lg" />{{ t('settings.systemIntegration') }}</div></template>
          <div class="space-y-4">
            <div v-if="!isPlugin && contextMenuSupported" class="setting-row">
              <div class="setting-label">{{ t('settings.contextMenu') }}</div>
              <el-switch v-model="contextMenuEnabled" @change="toggleContextMenu" />
            </div>
            <div v-if="!isPlugin" class="setting-row">
              <div class="setting-label">{{ t('settings.autoLaunch') }}</div>
              <el-switch v-model="autoLaunchEnabled" @change="toggleAutoLaunch" />
            </div>
            <div v-if="!isPlugin" class="setting-row">
              <div class="setting-label">{{ t('settings.trayEnabled') }}</div>
              <el-switch v-model="draft.trayEnabled" />
            </div>
            <div v-if="!isPlugin && draft.trayEnabled" class="panel">
              <div class="setting-label mb-2">{{ t('settings.closeAction') }}</div>
              <el-segmented
                v-model="draft.closeAction"
                :options="[
                  { label: t('settings.closeActionOptions.ask'), value: 'ask' },
                  { label: t('settings.closeActionOptions.tray'), value: 'tray' },
                  { label: t('settings.closeActionOptions.exit'), value: 'exit' },
                ]"
              />
            </div>
          </div>
        </el-card>

        <el-card class="settings-card">
          <template #header><div class="section-title"><div class="i-mdi-palette-outline text-fuchsia-500 text-lg" />{{ t('settings.appearanceUpdate') }}</div></template>
          <div class="space-y-4">
            <div class="panel">
              <div class="setting-label mb-2">{{ t('settings.language') }}</div>
              <el-select v-model="draft.locale" class="w-full">
                <el-option label="中文" value="zh" />
                <el-option label="English" value="en" />
              </el-select>
            </div>
            <div class="panel">
              <div class="setting-label mb-2">{{ t('settings.theme') }}</div>
              <el-segmented
                v-model="draft.themeMode"
                :options="[
                  { label: t('settings.themeMode.light'), value: 'light' },
                  { label: t('settings.themeMode.dark'), value: 'dark' },
                  { label: t('settings.themeMode.system'), value: 'auto' },
                ]"
              />
            </div>
            <div v-if="!isPlugin" class="setting-row">
              <div class="setting-label">{{ t('settings.autoUpdate') }}</div>
              <el-switch v-model="draft.autoUpdate" />
            </div>
            <div class="panel">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="setting-label">{{ t('settings.version') }}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">v{{ appVersion }}</div>
                </div>
                <el-button v-if="!isPlugin" :loading="updateCheckLoading" @click="triggerManualUpdateCheck">
                  <el-icon class="mr-1" v-if="!updateCheckLoading"><div class="i-mdi-refresh" /></el-icon>
                  {{ updateCheckLoading ? t('settings.checkingUpdate') : t('settings.checkNow') }}
                </el-button>
              </div>
              <el-button link type="primary" class="!px-0 mt-2" @click="openReleases">
                {{ t('settings.releases') }}
                <el-icon class="ml-1"><div class="i-mdi-open-in-new" /></el-icon>
              </el-button>
            </div>
          </div>
        </el-card>

        </div>

         <div :class="isPlugin ? 'space-y-4 min-w-0' : 'space-y-4 min-w-0 mt-4 xl:mt-0'">
        <el-card class="settings-card">
          <template #header><div class="section-title"><div class="i-mdi-application-brackets text-blue-500 text-lg" />{{ t('settings.editorsTerminal') }}</div></template>
          <div class="space-y-5">
            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="setting-label">{{ t('settings.editors') }}</div>
                <el-button type="primary" text @click="addEditor"><el-icon class="mr-1"><div class="i-mdi-plus" /></el-icon>{{ t('settings.addEditor') }}</el-button>
              </div>
              <div class="panel mb-3">
                <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div class="setting-label">{{ t('settings.defaultEditor') }}</div>
                  </div>
                  <el-select v-model="draft.defaultEditorId" class="w-full xl:w-72">
                    <el-option
                      v-for="editor in (draft.editors || [])"
                      :key="editor.id"
                      :label="editor.name || editor.path"
                      :value="editor.id"
                    />
                  </el-select>
                </div>
              </div>
              <div class="space-y-2">
                <div v-for="(editor, index) in (draft.editors || [])" :key="editor.id" class="panel">
                  <div class="flex items-center gap-2">
                    <el-tag v-if="draft.defaultEditorId === editor.id" type="primary" effect="light" round>
                      {{ t('settings.defaultEditorCurrent') }}
                    </el-tag>
                    <el-button v-else text type="primary" @click="draft.defaultEditorId = editor.id">
                      {{ t('settings.setAsDefault') }}
                    </el-button>
                    <el-input v-model="editor.name" :placeholder="t('settings.editorName')" class="!w-36" />
                    <el-input v-model="editor.path" readonly :placeholder="t('settings.editorPathPlaceholder')" class="flex-1">
                      <template #append><el-button @click="browseEditorPath(index)">{{ t('settings.selectFile') }}</el-button></template>
                    </el-input>
                    <el-button type="danger" text :disabled="(draft.editors?.length || 0) <= 1" @click="removeEditor(index)"><el-icon><div class="i-mdi-close" /></el-icon></el-button>
                  </div>
                </div>
              </div>
            </div>
            <div class="panel">
              <div class="setting-label mb-3">{{ t('settings.defaultTerminal') }}</div>
              <div class="flex gap-2">
                <el-select v-model="draft.defaultTerminal" class="flex-1">
                  <el-option-group :label="t('settings.detectedTerminals')"><el-option v-for="term in settingsStore.availableTerminals" :key="term.id" :label="term.name" :value="term.id" /></el-option-group>
                  <el-option-group v-if="draft.customTerminals?.length" :label="t('settings.customTerminals')"><el-option v-for="term in draft.customTerminals" :key="term.id" :label="term.name" :value="term.id" /></el-option-group>
                </el-select>
                <el-button @click="addCustomTerminal"><div class="i-mdi-plus text-sm" /></el-button>
              </div>
              <div v-if="draft.customTerminals?.length" class="mt-3 space-y-2">
                <div v-for="term in draft.customTerminals" :key="term.id" class="flex items-center gap-2 rounded-lg bg-white dark:bg-slate-800 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700/60">
                  <div class="i-mdi-console text-slate-400" />
                  <span class="flex-1 truncate">{{ term.name }}</span>
                  <button class="text-red-400 hover:text-red-500 cursor-pointer" @click="removeCustomTerminal(term.id)"><div class="i-mdi-close text-sm" /></button>
                </div>
              </div>
            </div>
          </div>
        </el-card>
        <el-card class="settings-card">
          <template #header><div class="section-title"><div class="i-mdi-database-sync-outline text-amber-500 text-lg" />{{ t('settings.dataBackup') }}</div></template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="panel">
              <div class="setting-label mb-2">{{ t('settings.export') }}</div>
              <p class="setting-desc">{{ t('settings.dataHint') }}</p>
              <el-button type="primary" class="mt-3" @click="exportData"><el-icon class="mr-1"><div class="i-mdi-export" /></el-icon>{{ t('settings.export') }}</el-button>
            </div>
            <div class="panel">
              <div class="setting-label mb-2">{{ t('settings.import') }}</div>
              <p class="setting-desc">{{ t('settings.importHint') }}</p>
              <el-button class="mt-3" @click="importData"><el-icon class="mr-1"><div class="i-mdi-import" /></el-icon>{{ t('settings.import') }}</el-button>
            </div>
          </div>
        </el-card>

        <el-card class="settings-card">
          <template #header><div class="section-title"><div class="i-mdi-auto-fix text-violet-500 text-lg" />{{ t('settings.gitAi') }}</div></template>
          <div class="space-y-4">
            <div class="setting-row">
              <div class="setting-label">{{ t('settings.gitAiEnabled') }}</div>
              <el-switch v-model="draft.gitAiEnabled" />
            </div>
            <div v-if="draft.gitAiEnabled" class="space-y-4">
              <div class="panel space-y-3">
                <div class="setting-label">{{ t('settings.gitAiPrimaryService') }}</div>
                <div>
                  <div class="setting-label mb-2">{{ t('settings.gitAiApiType') }}</div>
                  <el-select v-model="draft.gitAiPrimaryService!.apiType" class="w-full">
                    <el-option :label="t('settings.gitAiApiTypeChat')" value="chat_completions" />
                    <el-option :label="t('settings.gitAiApiTypeResponses')" value="responses" />
                  </el-select>
                </div>
                <div>
                  <div class="setting-label mb-2">{{ t('settings.gitAiBaseUrl') }}</div>
                  <el-input v-model="draft.gitAiPrimaryService!.baseUrl" :placeholder="t('settings.gitAiBaseUrlPlaceholder')" clearable />
                </div>
                <div>
                  <div class="setting-label mb-2">{{ t('settings.gitAiModel') }}</div>
                  <el-input v-model="draft.gitAiPrimaryService!.model" :placeholder="t('settings.gitAiModelPlaceholder')" clearable />
                </div>
                <div>
                  <div class="setting-label mb-2">{{ t('settings.gitAiApiKey') }}</div>
                  <el-input v-model="draft.gitAiPrimaryService!.apiKey" type="password" show-password :placeholder="t('settings.gitAiApiKeyPlaceholder')" />
                </div>
                <div class="setting-row !py-0">
                  <div class="setting-label">{{ t('settings.gitAiStream') }}</div>
                  <el-switch v-model="draft.gitAiStream" />
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  {{ draft.gitAiStream ? t('settings.gitAiStreamEnabledHint') : t('settings.gitAiStreamDisabledHint') }}
                </div>
                <div class="flex items-center gap-3">
                  <el-button :loading="aiTestLoading" type="primary" plain @click="testAiConnection()">
                    <el-icon class="mr-1" v-if="!aiTestLoading"><div class="i-mdi-connection" /></el-icon>{{ t('settings.gitAiTestBtn') }}
                  </el-button>
                  <div v-if="aiTestResult" class="text-sm flex items-center gap-1">
                    <div v-if="aiTestResult.success" class="i-mdi-check-circle text-green-500" />
                    <div v-else class="i-mdi-close-circle text-red-500" />
                    <span :class="aiTestResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">{{ aiTestResult.message }}</span>
                  </div>
                </div>
              </div>
              <div class="panel xl:col-span-2">
                <div class="setting-label mb-2">{{ t('settings.gitAiPromptTemplate') }}</div>
                <el-input v-model="draft.gitAiPromptTemplate" type="textarea" :rows="4" :placeholder="t('settings.gitAiPromptPlaceholder')" />
              </div>
            </div>
          </div>
        </el-card>

        </div>
      </div>
    </div>

    <el-dialog
      v-model="importDialogVisible"
      :title="t('settings.importPreviewTitle')"
      width="960px"
      destroy-on-close
      align-center
      class="import-preview-dialog"
    >
      <div v-if="importPlan" class="space-y-5 import-dialog-content">
        <div class="panel">
          <div class="setting-label">{{ t('settings.importSource') }}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ importSourceName }}</div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div class="summary-tile"><div class="summary-label">{{ t('settings.importProjectsAdded') }}</div><div class="summary-value">{{ importSummary.addedProjects }}</div></div>
          <div class="summary-tile"><div class="summary-label">{{ t('settings.importProjectsConflict') }}</div><div class="summary-value">{{ importSummary.conflictedProjects }}</div></div>
          <div class="summary-tile"><div class="summary-label">{{ t('settings.importNodesAdded') }}</div><div class="summary-value">{{ importSummary.addedNodes }}</div></div>
          <div class="summary-tile"><div class="summary-label">{{ t('settings.importNodesConflict') }}</div><div class="summary-value">{{ importSummary.conflictedNodes }}</div></div>
          <div class="summary-tile"><div class="summary-label">{{ t('settings.importSettingsConflict') }}</div><div class="summary-value">{{ importSummary.conflictedSettings }}</div></div>
        </div>
        <div v-if="importPlan.projectConflicts.length" class="space-y-3">
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">{{ t('settings.importProjectConflictTitle') }}</div>
          <div v-for="conflict in importPlan.projectConflicts" :key="conflict.existing.path" class="conflict-card">
            <div class="flex flex-col gap-3 mb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div class="font-medium text-slate-700 dark:text-slate-200">{{ conflict.existing.name }}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{{ conflict.existing.path }}</div>
              </div>
              <el-radio-group v-model="conflict.choice" class="w-full md:w-auto">
                <el-radio-button label="keep">{{ t('settings.importKeepCurrent') }}</el-radio-button>
                <el-radio-button label="incoming">{{ t('settings.importUseImported') }}</el-radio-button>
              </el-radio-group>
            </div>
            <div class="space-y-2">
              <div v-for="diff in conflict.diffs" :key="diff.key" class="space-y-2">
                <div class="text-xs font-semibold text-slate-500 dark:text-slate-300">{{ diff.label }}</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div class="diff-box"><div class="diff-title">{{ t('settings.importCurrent') }}</div><pre class="diff-content">{{ diff.current }}</pre></div>
                  <div class="diff-box"><div class="diff-title">{{ t('settings.importIncoming') }}</div><pre class="diff-content">{{ diff.incoming }}</pre></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="importPlan.nodeConflicts.length" class="space-y-3">
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">{{ t('settings.importNodeConflictTitle') }}</div>
          <div v-for="conflict in importPlan.nodeConflicts" :key="conflict.existing.path" class="conflict-card">
            <div class="flex flex-col gap-3 mb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div class="font-medium text-slate-700 dark:text-slate-200">{{ conflict.existing.version || conflict.incoming.version }}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{{ conflict.existing.path }}</div>
              </div>
              <el-radio-group v-model="conflict.choice" class="w-full md:w-auto">
                <el-radio-button label="keep">{{ t('settings.importKeepCurrent') }}</el-radio-button>
                <el-radio-button label="incoming">{{ t('settings.importUseImported') }}</el-radio-button>
              </el-radio-group>
            </div>
            <div class="space-y-2">
              <div v-for="diff in conflict.diffs" :key="diff.key" class="space-y-2">
                <div class="text-xs font-semibold text-slate-500 dark:text-slate-300">{{ diff.label }}</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div class="diff-box"><div class="diff-title">{{ t('settings.importCurrent') }}</div><pre class="diff-content">{{ diff.current }}</pre></div>
                  <div class="diff-box"><div class="diff-title">{{ t('settings.importIncoming') }}</div><pre class="diff-content">{{ diff.incoming }}</pre></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="importPlan.settingsConflicts.length" class="space-y-3">
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">{{ t('settings.importSettingsConflictTitle') }}</div>
          <div class="conflict-card space-y-3">
            <div v-for="conflict in importPlan.settingsConflicts" :key="String(conflict.key)" class="rounded-lg border border-slate-200 dark:border-slate-700/60 p-3">
              <div class="flex flex-col gap-3 mb-3 md:flex-row md:items-start md:justify-between">
                <div class="font-medium text-slate-700 dark:text-slate-200">{{ conflict.label }}</div>
                <el-radio-group v-model="conflict.choice" class="w-full md:w-auto">
                  <el-radio-button label="keep">{{ t('settings.importKeepCurrent') }}</el-radio-button>
                  <el-radio-button label="incoming">{{ t('settings.importUseImported') }}</el-radio-button>
                </el-radio-group>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div class="diff-box"><div class="diff-title">{{ t('settings.importCurrent') }}</div><pre class="diff-content">{{ conflict.current }}</pre></div>
                <div class="diff-box"><div class="diff-title">{{ t('settings.importIncoming') }}</div><pre class="diff-content">{{ conflict.incoming }}</pre></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="cancelImportPreview">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="applyImportPlan">{{ t('settings.importApply') }}</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings-card {
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.06);
  border-radius: 18px;
  border: 1px solid rgb(226 232 240 / 0.9) !important;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96)) !important;
}
.dark .settings-card {
  border-color: rgb(51 65 85 / 0.7) !important;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.96)) !important;
  box-shadow: 0 10px 30px rgba(2, 6, 23, 0.3);
}
.section-title { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.setting-row, .panel, .summary-tile, .conflict-card, .diff-box {
  border-radius: 14px;
  border: 1px solid rgb(226 232 240 / 0.8);
  background: rgb(248 250 252 / 0.88);
}
.dark .setting-row, .dark .panel, .dark .summary-tile, .dark .conflict-card, .dark .diff-box {
  border-color: rgb(51 65 85 / 0.7);
  background: rgb(15 23 42 / 0.62);
}
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; }
.panel, .conflict-card, .diff-box, .summary-tile { padding: 14px; }
.setting-label { font-size: 14px; font-weight: 600; color: rgb(51 65 85); }
.dark .setting-label { color: rgb(226 232 240); }
.setting-desc, .summary-label, .diff-title { font-size: 12px; color: rgb(100 116 139); }
.dark .setting-desc, .dark .summary-label, .dark .diff-title { color: rgb(148 163 184); }
.summary-value { margin-top: 8px; font-size: 24px; line-height: 1; font-weight: 700; color: rgb(15 23 42); }
.dark .summary-value { color: rgb(248 250 252); }
.diff-box { overflow: hidden; }
.diff-content { margin: 0; max-height: 240px; overflow: auto; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: rgb(30 41 59); font-family: var(--font-mono); }
.dark .diff-content { color: rgb(226 232 240); }
.import-dialog-content { max-height: 72vh; overflow-y: auto; padding-right: 4px; }
:deep(.el-card__header) { padding: 14px 18px; }
:deep(.el-card__body) { padding: 18px; }
:deep(.import-preview-dialog .el-dialog) {
  width: min(960px, calc(100vw - 32px));
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:deep(.import-preview-dialog .el-dialog__body) {
  min-height: 0;
  overflow: hidden;
  padding-top: 12px;
}
:deep(.import-preview-dialog .el-dialog__footer) { padding-top: 12px; }
</style>
