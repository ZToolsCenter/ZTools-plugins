<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import type { Project, CustomCommand, ProjectQuickCommand } from '../types';
import type { ProjectInfo, ImportNode } from '../api/types';
import { useNodeStore } from '../stores/node';
import { normalizeNodeVersion, projectNodeVersionHint } from '../utils/nvm';
import { getNodeRuntimeId, normalizeRuntimeVersion, resolveAppDefaultNodePath, resolveProjectNodePath, resolveProjectRuntime } from '../utils/nodeRuntime';
import { ensureNodeInstallCommand, getInstallDependenciesCommand, buildJavaPresetCommands, isWindowsPlatform } from '../utils/projectCommands';
import { getCustomCommandDisplayName } from '../utils/projectCommands';
import { useSettingsStore } from '../stores/settings';
import { useProjectStore } from '../stores/project';
import type { PackageManagerResolveResult } from '../api/types';
import { collectProjectTags, normalizeProjectTags } from '../utils/projectTags';
import { countModulesInNode } from '../utils/scanCandidateTree';
import { MAX_PROJECT_DEPTH } from '../utils/projectTree';
import {
  getAvailableProjectQuickCommands,
  getDefaultProjectQuickCommands,
  normalizeProjectQuickCommands,
} from '../utils/projectQuickCommands';
import SubProjectScanModal from './SubProjectScanModal.vue';

/**
 * 新建项目扫描子项目时可用的层级数。
 *
 * 新项目一定是一级项目（深度 1），其子项目从第 2 层起算，
 * 故还能向下延伸 MAX_PROJECT_DEPTH - 1 层。若按默认的 MAX_PROJECT_DEPTH 扫描，
 * 会多扫出一层——那层在 addProjectTree 挂载时必然被截断丢弃，
 * 却已经出现在层级选择弹窗里让用户白勾一遍。
 */
const NEW_PROJECT_SUB_DEPTH = MAX_PROJECT_DEPTH - 1;

type ProjectForm = {
  id: string;
  name: string;
  path: string;
  type: 'node' | 'java' | 'other';
  /** Java 构建工具，仅 type === 'java' 时有值 */
  buildTool?: 'maven' | 'gradle';
  /** 是否存在 mvnw / gradlew，有则命令优先走 wrapper */
  hasWrapper?: boolean;
  gitConfigured: boolean;
  gitRemoteUrl: string;
  gitBranch: string;
  nodeRuntimeId: string;
  nodeVersion: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
  packageManagerSource: 'project' | 'default';
  scripts: string[];
  visibleScripts: string[];
  customCommands: CustomCommand[];
  quickCommands: ProjectQuickCommand[];
  editorId: string;
  description: string;
  tags: string[];
  groupId: string;
  terminalInjectNode: boolean;
};

const { t } = useI18n();
const settingsStore = useSettingsStore();
const projectStore = useProjectStore();
const nodeStore = useNodeStore();
const props = defineProps<{
  modelValue: boolean;
  editProject?: Project | null;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'add', project: Project, subProjectTree: ImportNode[]): void;
  (e: 'update', project: Project): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const isEdit = computed(() => !!props.editProject);

const defaultEditor = computed(() => {
  const editors = settingsStore.settings.editors || [];
  if (!editors.length) return null;
  return editors.find((editor) => editor.id === settingsStore.settings.defaultEditorId) || editors[0];
});

const editorPlaceholder = computed(() => defaultEditor.value
  ? `${t('project.editorDefault')} (${defaultEditor.value.name || defaultEditor.value.path})`
  : t('project.editorDefault'));

const editorHint = computed(() => defaultEditor.value
  ? `${t('project.editorHint')}：${defaultEditor.value.name || defaultEditor.value.path}`
  : t('project.editorHint'));

const loading = ref(false);

function runtimeSourceLabel(source: string): string {
  if (source === 'managed') return t('nodes.sourceManaged');
  if (source === 'nvm') return t('nodes.sourceNvm');
  if (source === 'system') return t('nodes.sourceSystem');
  if (source === 'external') return t('nodes.sourceExternal');
  return t('nodes.sourceCustom');
}

function runtimeOptionLabel(runtime: { version: string; source: string }): string {
  return `${runtime.version} · ${runtimeSourceLabel(runtime.source)}`;
}
/** 各 PM 的可用性状态 { pmName: PackageManagerResolveResult } */
const pmAvailability = ref<Record<string, PackageManagerResolveResult>>({});
/** PM 可用性检查是否进行中 */
const pmChecking = ref(false);
const pathIsGitRepo = ref(false);
const pathEntryCount = ref(0);
const remoteBranches = ref<string[]>([]);
const loadingRemoteBranches = ref(false);
const cloneOperationId = ref<string | null>(null);
const cloneCancelling = ref(false);
const scannedSubProjects = ref<ImportNode[]>([]);
/** 扫描到的可识别子模块总数，用于提示"提交后可选择层级" */
const scannedSubModuleCount = computed(() =>
  scannedSubProjects.value.reduce((sum, node) => sum + countModulesInNode(node), 0),
);

/***********************一级页快捷运行配置*********************/
const availableQuickCommands = computed(() => getAvailableProjectQuickCommands(form.value));
const selectedQuickCommands = computed(() => normalizeProjectQuickCommands(form.value, form.value.quickCommands));

function getQuickCommandLabel(command: ProjectQuickCommand): string {
  if (command.type === 'script') return command.id;
  const customCommand = form.value.customCommands.find(item => item.id === command.id);
  return customCommand ? getCustomCommandDisplayName(customCommand, t) : command.id;
}

function isQuickCommandSelected(command: ProjectQuickCommand): boolean {
  return selectedQuickCommands.value.some(item => item.type === command.type && item.id === command.id);
}

function toggleQuickCommand(command: ProjectQuickCommand): void {
  if (isQuickCommandSelected(command)) {
    form.value.quickCommands = form.value.quickCommands.filter(item => !(item.type === command.type && item.id === command.id));
    return;
  }

  if (selectedQuickCommands.value.length >= 3) {
    ElMessage.warning(t('project.quickCommandsMax'));
    return;
  }
  form.value.quickCommands = [...form.value.quickCommands, command];
}

function moveQuickCommand(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= form.value.quickCommands.length) return;
  const commands = [...form.value.quickCommands];
  [commands[index], commands[nextIndex]] = [commands[nextIndex], commands[index]];
  form.value.quickCommands = commands;
}

function syncQuickCommands(useDefault = false): void {
  const current = form.value.quickCommands;
  form.value.quickCommands = normalizeProjectQuickCommands(
    form.value,
    useDefault && current.length === 0 ? getDefaultProjectQuickCommands(form.value) : current,
  );
}

/***********************编辑态：调整子项目层级*********************/
/** 层级管理弹窗开关 */
const showLevelManager = ref(false);

/**
 * 编辑的项目是否还能**新增**子项目（三级项目不能再挂）。
 * 注意：即使不能新增，层级管理弹窗仍可打开——那里还要支持移除已有子项目。
 */
const canManageSubLevels = computed(() => {
  if (!props.editProject) return false;
  return projectStore.getProjectDepth(props.editProject.id) < MAX_PROJECT_DEPTH;
});

function openLevelManager() {
  showLevelManager.value = true;
}

const form = ref<ProjectForm>({
  id: '',
  name: '',
  path: '',
  type: 'node',
  gitConfigured: false,
  gitRemoteUrl: '',
  gitBranch: '',
  nodeRuntimeId: '',
  nodeVersion: '',
  packageManager: 'npm',
  packageManagerSource: 'project',
  scripts: [],
  visibleScripts: [],
  customCommands: [],
  quickCommands: [],
  editorId: '',
  description: '',
  tags: [],
  groupId: '',
  terminalInjectNode: true,
});

const selectedExistingRuntime = computed(() => {
  const runtimeId = form.value.nodeRuntimeId;
  if (!runtimeId) return undefined;
  return nodeStore.versions.find(runtime => getNodeRuntimeId(runtime) === runtimeId);
});

const runtimeOptions = computed(() => nodeStore.versionEntries
  .map(entry => {
    const selected = selectedExistingRuntime.value;
    const selectedVersion = selected && normalizeRuntimeVersion(selected.version).toLowerCase();
    const entryVersion = normalizeRuntimeVersion(entry.version).toLowerCase();
    // Preserve an existing exact project binding while editing, but keep one
    // option per version and use the effective Runtime for new selections.
    return selected && selectedVersion === entryVersion
      ? { ...selected, version: entry.version }
      : { ...entry.effectiveRuntime, version: entry.version };
  })
  .filter(runtime => runtime.status !== 'broken' && runtime.status !== 'unavailable'));

const missingRuntimeOption = computed(() => {
  if (!form.value.nodeRuntimeId || runtimeOptions.value.some(runtime => runtime.runtimeId === form.value.nodeRuntimeId)) return null;
  return {
    runtimeId: form.value.nodeRuntimeId,
    version: form.value.nodeVersion || t('nodes.unavailable'),
    source: selectedExistingRuntime.value?.source || 'custom',
    status: 'unavailable' as const,
  };
});

/***********************标签输入处理*********************/
/** 所有项目已使用标签，用于新增/编辑项目时复用同一个标签 */
const allProjectTags = computed(() => collectProjectTags(projectStore.projects));

const canConfigureRepo = computed(() => !isEdit.value && !!form.value.path && !pathIsGitRepo.value);
const repoTargetHasFiles = computed(() => pathEntryCount.value > 0);
const cloneInProgress = computed(() => loading.value && !!cloneOperationId.value);

function buildEmptyForm(): ProjectForm {
  return {
    id: '',
    name: '',
    path: '',
    type: 'node',
    gitConfigured: false,
    gitRemoteUrl: '',
    gitBranch: '',
    nodeRuntimeId: '',
    nodeVersion: '',
    packageManager: 'npm',
    packageManagerSource: 'project',
    scripts: [],
    visibleScripts: [],
    customCommands: [],
    quickCommands: [],
    editorId: '',
    description: '',
    tags: [],
    groupId: '',
    terminalInjectNode: true,
  };
}

async function refreshNodeVersions() {
  try {
    await nodeStore.loadRuntimes();
  } catch (error) {
    console.error('Failed to load node versions', error);
  }
}

function effectiveRuntimeForVersion(version: string): typeof runtimeOptions.value[number] | undefined {
  const normalized = normalizeRuntimeVersion(version).toLowerCase();
  return runtimeOptions.value.find(runtime => normalizeRuntimeVersion(runtime.version).toLowerCase() === normalized);
}

function resetRepoConfigState() {
  form.value.gitConfigured = false;
  form.value.gitRemoteUrl = '';
  form.value.gitBranch = '';
  remoteBranches.value = [];
}

function resetPathScanState() {
  pathIsGitRepo.value = false;
  pathEntryCount.value = 0;
  remoteBranches.value = [];
  scannedSubProjects.value = [];
}

async function applyDetectedNodeVersion(rawVersion?: string | null) {
  const normalizedNvmVersion = normalizeNodeVersion(rawVersion);
  if (!normalizedNvmVersion) {
    if (rawVersion) {
      console.warn('Invalid .nvmrc version, skipping auto install', rawVersion);
      ElMessage.warning(t('project.invalidNvmrc'));
    }
    return;
  }

  let installed = effectiveRuntimeForVersion(normalizedNvmVersion);

  if (!installed && nodeStore.managedSupported) {
    try {
      ElMessage.info(t('project.autoInstallStart', { version: normalizedNvmVersion }));
      await nodeStore.installManagedNode(normalizedNvmVersion);
      ElMessage.success(t('project.autoInstallSuccess', { version: normalizedNvmVersion }));
      await refreshNodeVersions();
      installed = effectiveRuntimeForVersion(normalizedNvmVersion);
    } catch (installError) {
      ElMessage.error(`${t('project.autoInstallFailed', { version: normalizedNvmVersion })}: ${String(installError)}`);
      console.error('Failed to auto-install node version', installError);
    }
  }

  if (installed) {
    form.value.nodeRuntimeId = installed.runtimeId || '';
    form.value.nodeVersion = installed.version;
  }
}

async function applyScanResult(info: ProjectInfo, options: { preferDetectedName?: boolean } = {}) {
  const folderName = form.value.path.split(/[/\\]/).pop() || '';
  const shouldUpdateName = !form.value.name || options.preferDetectedName || form.value.name === folderName;

  if (shouldUpdateName && info.name) {
    form.value.name = info.name;
  }

  if (info.projectType === 'node') {
    form.value.type = 'node';
    form.value.packageManager = info.packageManager || 'npm';
    form.value.scripts = info.scripts || [];
    form.value.visibleScripts = [...(info.scripts || [])];
    syncQuickCommands(true);
    await applyDetectedNodeVersion(projectNodeVersionHint(info));
    return;
  }

  if (info.projectType === 'java' && info.buildTool) {
    form.value.type = 'java';
    form.value.buildTool = info.buildTool;
    form.value.hasWrapper = !!info.hasWrapper;
    // Java 没有 package.json 那样的脚本清单，用预设自定义命令代替，
    // 这样「命令」页签才会渲染出来（它的条件是有脚本或有自定义命令）
    form.value.scripts = [];
    form.value.visibleScripts = [];
    if (form.value.customCommands.length === 0) {
      form.value.customCommands = buildJavaPresetCommands(
        info.buildTool,
        !!info.hasWrapper,
        isWindowsPlatform(),
        () => crypto.randomUUID(),
      );
    }
    syncQuickCommands(true);
    return;
  }

  form.value.type = 'other';
  form.value.buildTool = undefined;
  form.value.hasWrapper = undefined;
  form.value.scripts = [];
  form.value.visibleScripts = [];
}

function hydrateFormFromProject(project: Project) {
  const resolvedRuntime = resolveProjectRuntime(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime).runtime;
  form.value = {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    buildTool: project.buildTool,
    hasWrapper: project.hasWrapper,
    gitConfigured: !!project.gitConfigured,
    gitRemoteUrl: project.gitRemoteUrl || '',
    gitBranch: project.gitBranch || '',
    nodeRuntimeId: resolvedRuntime?.runtimeId || project.nodeRuntimeId || '',
    nodeVersion: project.nodeVersion || '',
    packageManager: project.packageManager || 'npm',
    packageManagerSource: project.packageManagerSource || 'project',
    scripts: project.scripts || [],
    visibleScripts: project.visibleScripts || [...(project.scripts || [])],
    customCommands: project.customCommands
      ? project.customCommands.map((command) => ({
        ...command,
        name: command.builtinId === 'install_dependencies'
          ? t('project.installDependencies')
          : command.name,
      }))
      : [],
    quickCommands: project.quickCommands
      ? [...project.quickCommands]
      : getDefaultProjectQuickCommands(project),
    editorId: project.editorId || '',
    description: project.description || '',
    tags: project.tags ? [...project.tags] : [],
    groupId: project.groupId || '',
    terminalInjectNode: project.terminalInjectNode !== false,
  };
}

watch(canConfigureRepo, (enabled) => {
  if (!enabled) {
    resetRepoConfigState();
  }
});

watch(() => props.modelValue, async (opened) => {
  if (!opened) return;

  await refreshNodeVersions();
  resetPathScanState();

  if (props.editProject) {
    hydrateFormFromProject(props.editProject);
    try {
      pathIsGitRepo.value = await api.gitCheck(props.editProject.path);
      const entries = await api.readDir(props.editProject.path);
      pathEntryCount.value = entries.length;
    } catch (error) {
      console.error('Failed to inspect existing project path', error);
    }
    // 刷新 PM 可用性状态
    await refreshPmAvailability();
    return;
  }

  form.value = buildEmptyForm();
  await refreshPmAvailability();
});

// When package manager changes, update the install command and refresh PM availability
watch(() => form.value.packageManager, (newPm, oldPm) => {
  if (!newPm || newPm === oldPm) return;

  // Update existing install dependencies command text
  const newInstallCommand = getInstallDependenciesCommand(newPm);
  for (const command of form.value.customCommands) {
    if (command.builtinId === 'install_dependencies') {
      command.command = newInstallCommand;
    }
  }

  refreshPmAvailability();
});

// When Node version changes, refresh PM availability
watch(() => form.value.nodeVersion, () => {
  refreshPmAvailability();
});

watch(() => form.value.nodeRuntimeId, (runtimeId) => {
  if (!runtimeId) {
    if (form.value.nodeVersion && !effectiveRuntimeForVersion(form.value.nodeVersion)) {
      form.value.nodeVersion = '';
    }
    return;
  }
  const runtime = nodeStore.getRuntime(runtimeId);
  if (runtime) form.value.nodeVersion = runtime.version;
});

// When PM source changes, refresh PM availability
watch(() => form.value.packageManagerSource, () => {
  refreshPmAvailability();
});

/**
 * 获取所有 4 个 PM 选项的可用性状态。
 * 用于下拉列表中显示每个 PM 的可用状态后缀。
 */
async function refreshPmAvailability() {
  const pm = form.value.packageManager;
  const source = form.value.packageManagerSource;
  pmChecking.value = true;

  try {
    // 解析项目 Node 路径
    if (!nodeStore.versions.length) {
      await nodeStore.loadRuntimes();
    }
    const nodePath = resolveProjectNodePath(
      {
        id: '',
        name: '',
        path: form.value.path,
        type: 'node',
        nodeRuntimeId: form.value.nodeRuntimeId || undefined,
        nodeVersion: form.value.nodeVersion,
      },
      nodeStore.versions,
      nodeStore.appDefault,
      nodeStore.systemNodeRuntime,
    );
    const defaultNodePath = resolveAppDefaultNodePath(nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);

    const allPms: Array<'npm' | 'yarn' | 'pnpm' | 'cnpm'> = ['npm', 'yarn', 'pnpm', 'cnpm'];
    const results: Record<string, PackageManagerResolveResult> = {};

    for (const p of allPms) {
      try {
        results[p] = await api.resolvePackageManager(nodePath, defaultNodePath, p, source);
      } catch (_) {
        results[p] = { available: false, reason: 'unknown' };
      }
    }

    pmAvailability.value = results;

    // 检查当前选中的 PM 是否不可用，提示安装
    // 仅当来源为当前 Node 环境时，才提示安装到当前 Node
    const currentResult = results[pm];
    if (source === 'project' && currentResult && !currentResult.available && pm !== 'npm' && nodePath) {
      await promptInstallPm(pm, form.value.nodeVersion, nodePath);
    }
  } catch (error) {
    console.error('Failed to refresh PM availability', error);
  } finally {
    pmChecking.value = false;
  }
}

/** 提示用户安装缺失的 PM */
async function promptInstallPm(pm: string, nodeVersion: string, nodePath: string) {
  try {
    await ElMessageBox.confirm(
      t('project.pmNotInstalledMessage', { pm, version: nodeVersion }),
      t('project.pmNotInstalledTitle'),
      {
        confirmButtonText: t('project.pmInstall'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    );
    await installPMForNode(pm, nodeVersion, nodePath);
    // 安装后刷新可用性
    await refreshPmAvailability();
  } catch {
    // User cancelled
  }
}

async function installPMForNode(pm: string, nodeVersion: string, nodePath: string) {
  try {
    ElMessage.info(t('project.pmInstalling', { pm, version: nodeVersion }));
    await api.installPm(nodePath, pm);
    ElMessage.success(t('project.pmInstallSuccess', { pm, version: nodeVersion }));
  } catch (error) {
    console.error('Failed to install PM for selected node:', error);
    // Fallback: try to install using default node version's npm
    try {
      const defaultNodePath = resolveAppDefaultNodePath(nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
      if (defaultNodePath) {
        await api.installPm(defaultNodePath, pm);
        ElMessage.warning(t('project.pmInstallFallback', { pm, version: nodeVersion }));
        return;
      }
    } catch (fallbackError) {
      console.error('Failed to install PM via default node:', fallbackError);
    }
    ElMessage.error(t('project.pmInstallFailed', { pm, version: nodeVersion }));
  }
}

async function selectFolder() {
  try {
    const selected = await api.openDialog({
      directory: true,
      multiple: false,
    });

    if (!selected || typeof selected !== 'string') return;

    form.value.path = selected;
    resetPathScanState();
    resetRepoConfigState();

    loading.value = true;
    try {
      const [isGitRepo, entries, info, subProjects] = await Promise.all([
        api.gitCheck(selected).catch(() => false),
        api.readDir(selected).catch(() => []),
        api.scanProject(selected),
        api.scanSubProjects(selected, NEW_PROJECT_SUB_DEPTH).catch((error) => {
          console.error('Failed to scan sub projects for manual import', error);
          return [];
        }),
      ]);

      pathIsGitRepo.value = isGitRepo;
      pathEntryCount.value = entries.length;
      // 扫描到的子项目树先暂存，提交时交给 Dashboard 弹出层级选择弹窗，
      // 不再直接全部平铺挂载——单个添加时由用户决定要挂到哪一级
      scannedSubProjects.value = subProjects;
      await applyScanResult(info, { preferDetectedName: !form.value.name });
    } catch (error) {
      console.error('Failed to scan project', error);
      if (!form.value.name) {
        form.value.name = selected.split(/[/\\]/).pop() || '';
      }
      form.value.type = 'other';
      form.value.scripts = [];
      form.value.visibleScripts = [];
    } finally {
      loading.value = false;
    }
  } catch (error) {
    console.error('Failed to open dialog:', error);
  }
}

async function loadRemoteBranches() {
  const remoteUrl = form.value.gitRemoteUrl.trim();
  if (!remoteUrl) {
    ElMessage.warning(t('project.gitRepoUrlRequired'));
    return;
  }

  loadingRemoteBranches.value = true;
  try {
    const branches = await api.gitListRemoteBranches(remoteUrl);
    remoteBranches.value = branches;

    if (branches.length === 0) {
      form.value.gitBranch = '';
      ElMessage.warning(t('project.gitNoBranches'));
      return;
    }

    if (!branches.includes(form.value.gitBranch)) {
      form.value.gitBranch = branches[0];
    }
  } catch (error) {
    console.error('Failed to load remote branches', error);
    remoteBranches.value = [];
    form.value.gitBranch = '';
    ElMessage.error(`${t('project.gitLoadBranchesFailed')}: ${String(error)}`);
  } finally {
    loadingRemoteBranches.value = false;
  }
}

function addCustomCommand() {
  form.value.customCommands.push({
    id: crypto.randomUUID(),
    name: '',
    command: '',
  });
}

function removeCustomCommand(index: number) {
  form.value.customCommands.splice(index, 1);
}

function isScriptVisible(script: string) {
  return (form.value.visibleScripts || []).includes(script);
}

function toggleVisibleScript(script: string) {
  const current = form.value.visibleScripts || [];
  if (current.includes(script)) {
    form.value.visibleScripts = current.filter((item) => item !== script);
    return;
  }

  form.value.visibleScripts = [...current, script];
}

function buildProjectPayload(): Project {
  const project: Project = {
    id: isEdit.value ? form.value.id : crypto.randomUUID(),
    name: form.value.name,
    path: form.value.path,
    type: form.value.type,
  };

  if (form.value.gitConfigured) {
    project.gitConfigured = true;
    project.gitRemoteUrl = form.value.gitRemoteUrl.trim();
    project.gitBranch = form.value.gitBranch;
  }

  if (form.value.type === 'node') {
    const selectedRuntime = form.value.nodeRuntimeId
      ? nodeStore.getRuntime(form.value.nodeRuntimeId)
      : undefined;
    project.nodeRuntimeId = form.value.nodeRuntimeId || undefined;
    project.nodeVersion = selectedRuntime?.version || (form.value.nodeRuntimeId ? form.value.nodeVersion : '');
    project.packageManager = form.value.packageManager;
    project.packageManagerSource = form.value.packageManagerSource;
    project.scripts = form.value.scripts;
    project.visibleScripts = form.value.visibleScripts;
    project.terminalInjectNode = form.value.terminalInjectNode;
  }

  if (form.value.type === 'java') {
    project.buildTool = form.value.buildTool;
    project.hasWrapper = form.value.hasWrapper;
  }

  project.customCommands = form.value.customCommands.filter((command) => command.name && command.command);
  project.quickCommands = normalizeProjectQuickCommands(project, form.value.quickCommands);

  if (form.value.editorId) {
    project.editorId = form.value.editorId;
  }

  // 保存描述、标签、分组
  if (form.value.description.trim()) {
    project.description = form.value.description.trim();
  }
  const tags = normalizeProjectTags(form.value.tags);
  if (tags.length > 0) {
    project.tags = tags;
  }
  if (form.value.groupId) {
    project.groupId = form.value.groupId;
  }

  // Preserve pin and sort state when editing
  if (isEdit.value && props.editProject) {
    project.pinned = props.editProject.pinned;
    project.pinOrder = props.editProject.pinOrder;
    project.sortOrder = props.editProject.sortOrder;
    // 保留嵌套关系与收藏等编辑表单未覆盖的字段
    project.parentId = props.editProject.parentId;
    project.favorite = props.editProject.favorite;
    project.moduleKind = props.editProject.moduleKind;
    project.subScannedAt = props.editProject.subScannedAt;
  }

  return ensureNodeInstallCommand(project, t('project.installDependencies'));
}

async function submit() {
  if (!form.value.name || !form.value.path) return;

  loading.value = true;
  try {
    if (!isEdit.value && form.value.gitConfigured) {
      if (!form.value.gitRemoteUrl.trim()) {
        ElMessage.warning(t('project.gitRepoUrlRequired'));
        return;
      }

      if (!form.value.gitBranch) {
        ElMessage.warning(t('project.gitBranchRequired'));
        return;
      }

      cloneOperationId.value = crypto.randomUUID();
      await api.gitCloneBranch(form.value.gitRemoteUrl.trim(), form.value.gitBranch, form.value.path, cloneOperationId.value);
      pathIsGitRepo.value = true;

      const info = await api.scanProject(form.value.path);
      await applyScanResult(info, { preferDetectedName: true });
      scannedSubProjects.value = await api.scanSubProjects(form.value.path, NEW_PROJECT_SUB_DEPTH).catch((error) => {
        console.error('Failed to scan cloned project sub projects', error);
        return [];
      });
    }

    const project = buildProjectPayload();
    if (isEdit.value) {
      emit('update', project);
    } else {
      emit('add', project, scannedSubProjects.value);
    }

    visible.value = false;
  } catch (error) {
    console.error('Failed to submit project', error);
    if (String(error).toLowerCase().includes('cancelled')) {
      ElMessage.info(t('git.operationCancelled'));
    } else {
      ElMessage.error(String(error));
    }
  } finally {
    cloneOperationId.value = null;
    cloneCancelling.value = false;
    loading.value = false;
  }
}

async function cancelClone() {
  if (!cloneOperationId.value || cloneCancelling.value) {
    return;
  }

  cloneCancelling.value = true;
  try {
    await api.gitCancelOperation(cloneOperationId.value);
    ElMessage.info(t('git.operationCancelling'));
  } catch (error) {
    cloneCancelling.value = false;
    ElMessage.error(String(error));
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('project.editProject') : t('dashboard.addProject')"
    width="750px"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    :show-close="!loading"
    destroy-on-close
    align-center
    class="project-modal"
  >
    <el-form label-position="top" :model="form" class="project-form">
      <el-form-item :label="t('project.name')">
        <el-input v-model="form.name" :placeholder="t('project.namePlaceholder')" />
      </el-form-item>

      <el-form-item :label="t('project.description')">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="2"
          :placeholder="t('project.descriptionPlaceholder')"
          resize="none"
        />
      </el-form-item>

      <div class="grid gap-4 grid-cols-2">
        <el-form-item :label="t('project.tags')">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            default-first-option
            collapse-tags
            collapse-tags-tooltip
            :reserve-keyword="false"
            class="w-full"
            size="small"
            :placeholder="t('project.tagsPlaceholder')"
          >
            <el-option
              v-for="tag in allProjectTags"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('project.group')">
          <el-select v-model="form.groupId" class="w-full" clearable :placeholder="t('project.groupPlaceholder')">
            <el-option :label="t('dashboard.ungrouped')" value="" />
            <el-option
              v-for="group in projectStore.projectGroups"
              :key="group.id"
              :label="group.name"
              :value="group.id"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item :label="t('project.path')" required>
        <div class="flex gap-2 w-full">
          <el-input v-model="form.path" :placeholder="t('project.selectFolder')" readonly>
            <template #append>
              <el-button @click="selectFolder">
                <el-icon><div class="i-mdi-folder" /></el-icon>
              </el-button>
            </template>
          </el-input>
        </div>
        <div v-if="form.path" class="app-text-meta mt-2 text-slate-500 dark:text-slate-400">
          <span v-if="pathIsGitRepo">{{ t('project.gitLocalRepoDetected') }}</span>
          <span v-else>{{ t('project.gitLocalRepoMissing') }}</span>
        </div>
        <!-- 扫描到子项目时提示：提交后会弹出层级选择弹窗，由用户决定挂载哪几级 -->
        <div v-if="!isEdit && scannedSubModuleCount > 0" class="app-text-meta mt-1 text-emerald-600 dark:text-emerald-400">
          {{ t('project.subProjectsDetected', { count: scannedSubModuleCount }) }}
        </div>
        <!-- 编辑态：随时重新扫描并调整子项目层级（含移除已有子项目） -->
        <div v-if="isEdit" class="mt-2">
          <el-button size="small" plain @click="openLevelManager">
            <div class="i-mdi-file-tree-outline mr-1" />
            {{ t('dashboard.manageSubProjects') }}
          </el-button>
          <span v-if="!canManageSubLevels" class="app-text-meta ml-2 text-slate-400">
            {{ t('dashboard.maxDepthReached') }}
          </span>
        </div>
      </el-form-item>

      <template v-if="canConfigureRepo">
        <el-form-item :label="t('project.gitConfigureRepo')">
          <el-switch v-model="form.gitConfigured" />
          <div class="app-text-meta mt-2 text-slate-500 dark:text-slate-400">
            {{ t('project.gitConfigureRepoHint') }}
          </div>
        </el-form-item>

        <template v-if="form.gitConfigured">
          <el-form-item :label="t('project.gitRepoUrl')" required>
            <el-input
              v-model="form.gitRemoteUrl"
              :placeholder="t('project.gitRepoUrlPlaceholder')"
              clearable
            >
              <template #append>
                <el-button @click="loadRemoteBranches" :loading="loadingRemoteBranches">
                  {{ t('project.gitLoadBranches') }}
                </el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item :label="t('project.gitBranch')" required>
            <el-select
              v-model="form.gitBranch"
              class="w-full"
              :placeholder="t('project.gitBranchPlaceholder')"
              :disabled="remoteBranches.length === 0"
            >
              <el-option
                v-for="branch in remoteBranches"
                :key="branch"
                :label="branch"
                :value="branch"
              />
            </el-select>
          </el-form-item>

          <div
            v-if="repoTargetHasFiles"
            class="app-text-control mb-4 rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {{ t('project.gitTargetMustBeEmpty') }}
          </div>
        </template>
      </template>

      <el-form-item :label="t('project.type')">
        <el-select v-model="form.type" class="w-full">
          <el-option label="Node" value="node" />
          <el-option label="Java" value="java" />
          <el-option :label="t('project.typeOther')" value="other" />
        </el-select>
      </el-form-item>

      <template v-if="form.type === 'node'">
        <div class="grid gap-4 grid-cols-3">
          <div class="min-w-0">
            <el-form-item :label="t('project.nodeVersion')">
              <el-select v-model="form.nodeRuntimeId" class="w-full">
                <el-option :label="t('nodes.projectManagerDefault')" value="" />
                <el-option
                  v-if="missingRuntimeOption"
                  :label="`${missingRuntimeOption.version} · ${t('nodes.unavailable')}`"
                  :value="missingRuntimeOption.runtimeId"
                  disabled
                />
                <el-option
                  v-for="runtime in runtimeOptions"
                  :key="runtime.runtimeId"
                  :label="runtimeOptionLabel(runtime)"
                  :value="runtime.runtimeId"
                >
                  <div class="flex min-w-0 items-center justify-between gap-3">
                    <span class="font-mono">{{ runtime.version }}</span>
                    <span class="app-text-meta text-slate-400">{{ runtimeSourceLabel(runtime.source) }}</span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item>
          </div>
          <div class="min-w-0">
            <el-form-item :label="t('project.pmSource')">
              <el-radio-group v-model="form.packageManagerSource" size="small">
                <el-radio-button value="project">{{ t('project.pmSourceProject') }}</el-radio-button>
                <el-radio-button value="default">{{ t('project.pmSourceDefault') }}</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </div>
          <div class="min-w-0">
            <el-form-item :label="t('project.packageManager')">
              <el-select v-model="form.packageManager">
                <el-option
                  v-for="pm in (['npm', 'yarn', 'pnpm', 'cnpm'] as const)"
                  :key="pm"
                  :value="pm"
                >
                  <span>{{ pm }}</span>
                  <span v-if="pmAvailability[pm]" class="ml-1 app-text-meta" :class="pmAvailability[pm].available ? 'text-emerald-500' : 'text-red-400'">
                    {{ pmAvailability[pm].available
                      ? (form.packageManagerSource === 'default' ? t('project.pmDefaultAvailable') : t('project.pmProjectAvailable'))
                      : t('project.pmNotAvailable')
                    }}
                  </span>
                </el-option>
              </el-select>
            </el-form-item>
          </div>
        </div>

        <el-form-item :label="t('project.terminalInjectNode')">
          <el-switch v-model="form.terminalInjectNode" />
          <div class="app-text-meta mt-2 text-slate-500 dark:text-slate-400">
            {{ t('project.terminalInjectNodeHint') }}
          </div>
        </el-form-item>

        <el-form-item v-if="form.scripts.length > 0" :label="t('project.scripts')">
          <div class="w-full rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-900/40 p-3">
            <p class="app-text-meta text-slate-500 dark:text-slate-400 mb-3">{{ t('project.scriptsVisibilityHint') }}</p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                v-for="script in form.scripts"
                :key="script"
                type="button"
                @click="toggleVisibleScript(script)"
                class="script-toggle"
                :class="isScriptVisible(script) ? 'script-toggle-active' : 'script-toggle-inactive'"
              >
                <span class="app-text-control truncate font-mono">{{ script }}</span>
                <div
                  class="text-sm transition-transform duration-200"
                  :class="isScriptVisible(script)
                    ? 'i-mdi-checkbox-marked-circle text-blue-500 scale-100'
                    : 'i-mdi-checkbox-blank-circle-outline text-slate-300 dark:text-slate-500 scale-90'"
                />
              </button>
            </div>
          </div>
        </el-form-item>
      </template>

      <el-form-item v-if="availableQuickCommands.length > 0" :label="t('project.quickCommandsTitle')">
        <div class="quick-command-config w-full">
          <p class="app-text-meta text-slate-500 dark:text-slate-400 mb-3">{{ t('project.quickCommandsHint') }}</p>
          <div v-if="selectedQuickCommands.length > 0" class="quick-command-selected">
            <div
              v-for="(command, index) in selectedQuickCommands"
              :key="`${command.type}:${command.id}`"
              class="quick-command-selected-item"
            >
              <div class="flex min-w-0 items-center gap-2">
                <div class="i-mdi-play-circle-outline text-blue-500 text-sm" />
                <span class="truncate">{{ getQuickCommandLabel(command) }}</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  class="quick-command-order-btn"
                  :disabled="index === 0"
                  :title="t('project.moveQuickCommandUp')"
                  @click="moveQuickCommand(index, -1)"
                >
                  <div class="i-mdi-chevron-up" />
                </button>
                <button
                  class="quick-command-order-btn"
                  :disabled="index === selectedQuickCommands.length - 1"
                  :title="t('project.moveQuickCommandDown')"
                  @click="moveQuickCommand(index, 1)"
                >
                  <div class="i-mdi-chevron-down" />
                </button>
              </div>
            </div>
          </div>
          <div class="quick-command-options">
            <button
              v-for="command in availableQuickCommands"
              :key="`${command.type}:${command.id}`"
              type="button"
              class="quick-command-option"
              :class="isQuickCommandSelected(command) ? 'quick-command-option-active' : 'quick-command-option-inactive'"
              @click="toggleQuickCommand(command)"
            >
              <span class="truncate">{{ getQuickCommandLabel(command) }}</span>
              <span class="quick-command-type">{{ command.type === 'script' ? t('project.quickCommandScript') : t('project.quickCommandCustom') }}</span>
              <div
                class="text-sm"
                :class="isQuickCommandSelected(command) ? 'i-mdi-checkbox-marked-circle text-blue-500' : 'i-mdi-checkbox-blank-circle-outline text-slate-300 dark:text-slate-500'"
              />
            </button>
          </div>
        </div>
      </el-form-item>

      <el-form-item :label="t('project.customCommands')">
        <div class="w-full space-y-2">
          <div
            v-for="(command, index) in form.customCommands"
            :key="command.id"
            class="rounded-lg border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900/30 px-3 py-0.5"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="grid min-w-0 flex-1 gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                <el-input v-model="command.name" :placeholder="t('project.commandName')" />
                <el-input v-model="command.command" :placeholder="t('project.commandContent')" />
              </div>
              <el-button type="danger" text @click="removeCustomCommand(index)">
                <el-icon><div class="i-mdi-close" /></el-icon>
              </el-button>
            </div>
          </div>
          <el-button type="primary" text @click="addCustomCommand">
            <el-icon class="mr-1"><div class="i-mdi-plus" /></el-icon>
            {{ t('project.addCommand') }}
          </el-button>
        </div>
      </el-form-item>

      <el-form-item
        v-if="settingsStore.settings.editors && settingsStore.settings.editors.length > 1"
        :label="t('project.editor')"
      >
        <el-select v-model="form.editorId" class="w-full" clearable :placeholder="editorPlaceholder">
          <el-option
            v-for="editor in settingsStore.settings.editors"
            :key="editor.id"
            :label="editor.name || editor.path"
            :value="editor.id"
          />
        </el-select>
        <div class="app-text-meta text-slate-400 mt-1">{{ editorHint }}</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false" :disabled="loading">{{ t('common.cancel') }}</el-button>
        <el-button
          v-if="cloneInProgress"
          type="danger"
          plain
          @click="cancelClone"
          :loading="cloneCancelling"
        >
          {{ cloneCancelling ? t('git.operationCancelling') : t('git.cancelOperation') }}
        </el-button>
        <el-button
          type="primary"
          @click="submit"
          :disabled="!form.name || !form.path || (form.gitConfigured && (!form.gitRemoteUrl || !form.gitBranch))"
          :loading="loading"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 编辑态的子项目层级管理：重新扫描并调整挂载层级 -->
  <SubProjectScanModal
    v-if="isEdit && editProject"
    v-model="showLevelManager"
    :parent-project="editProject"
  />
</template>

<style scoped>
.project-form {
  min-height: 0;
}

.script-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-radius: 0.85rem;
  border-width: 1px;
  padding: 0.7rem 0.8rem;
  text-align: left;
  transition: all 0.2s ease;
}

.script-toggle-active {
  border-color: color-mix(in srgb, var(--app-primary) 35%, transparent);
  background: var(--app-primary-soft);
  color: var(--app-primary);
}

.script-toggle-inactive {
  border-color: var(--app-border);
  background: var(--app-surface-soft);
  color: var(--app-text-secondary);
}

.script-toggle:hover {
  transform: translateY(-1px);
  box-shadow: var(--app-shadow-md);
}

.quick-command-config {
  padding: 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-surface-soft);
}
.quick-command-selected,
.quick-command-options {
  display: grid;
  gap: 6px;
}
.quick-command-selected {
  margin-bottom: 10px;
}
.quick-command-selected-item,
.quick-command-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  text-align: left;
}
.quick-command-selected-item {
  background: var(--app-surface);
  color: var(--app-text);
}
.quick-command-option {
  width: 100%;
  transition: background-color var(--app-duration-fast) var(--app-ease), border-color var(--app-duration-fast) var(--app-ease), color var(--app-duration-fast) var(--app-ease);
}
.quick-command-option-active {
  border-color: color-mix(in srgb, var(--app-primary) 35%, transparent);
  background: var(--app-primary-soft);
  color: var(--app-primary);
}
.quick-command-option-inactive {
  background: var(--app-surface);
  color: var(--app-text-secondary);
}
.quick-command-option:hover {
  border-color: color-mix(in srgb, var(--app-primary) 35%, transparent);
}
.quick-command-type {
  flex-shrink: 0;
  color: var(--app-text-muted);
  font-size: var(--app-font-meta);
}
.quick-command-order-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-secondary);
}
.quick-command-order-btn:hover:not(:disabled) {
  background: var(--app-primary-soft);
  color: var(--app-primary);
}
.quick-command-order-btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.project-modal {
  display: flex;
  width: min(700px, calc(100vw - 32px));
  max-height: 90vh;
  flex-direction: column;
  overflow: hidden;
}

:deep(.project-modal .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
  padding-top: 12px;
}

:deep(.project-modal .el-dialog__footer) {
  flex-shrink: 0;
  padding-top: 12px;
}
</style>
