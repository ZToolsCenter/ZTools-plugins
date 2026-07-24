<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import type { Project, CustomCommand } from '../types';
import type { ProjectInfo } from '../api/types';
import { normalizeNvmVersion, findInstalledNodeVersion } from '../utils/nvm';
import { ensureNodeInstallCommand, getInstallDependenciesCommand } from '../utils/projectCommands';
import { useSettingsStore } from '../stores/settings';
import type { PackageManagerResolveResult } from '../api/types';

type ProjectForm = {
  id: string;
  name: string;
  path: string;
  type: 'node' | 'other';
  gitConfigured: boolean;
  gitRemoteUrl: string;
  gitBranch: string;
  nodeVersion: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
  packageManagerSource: 'project' | 'default';
  scripts: string[];
  visibleScripts: string[];
  customCommands: CustomCommand[];
  editorId: string;
};

const { t } = useI18n();
const settingsStore = useSettingsStore();
const props = defineProps<{
  modelValue: boolean;
  editProject?: Project | null;
}>();
const emit = defineEmits(['update:modelValue', 'add', 'update']);

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

const nodeVersions = ref<string[]>([]);
const loading = ref(false);
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

const form = ref<ProjectForm>({
  id: '',
  name: '',
  path: '',
  type: 'node',
  gitConfigured: false,
  gitRemoteUrl: '',
  gitBranch: '',
  nodeVersion: '',
  packageManager: 'npm',
  packageManagerSource: 'project',
  scripts: [],
  visibleScripts: [],
  customCommands: [],
  editorId: '',
});

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
    nodeVersion: nodeVersions.value[0] || '',
    packageManager: 'npm',
    packageManagerSource: 'project',
    scripts: [],
    visibleScripts: [],
    customCommands: [],
    editorId: '',
  };
}

function setNodeVersionOptions(list: string[], preserveCurrent = true) {
  const current = form.value.nodeVersion;
  const next = [...list];

  if (preserveCurrent && current && !next.includes(current)) {
    next.unshift(current);
  }

  nodeVersions.value = next;

  if (!form.value.nodeVersion) {
    form.value.nodeVersion = next[0] || '';
  }
}

async function refreshNodeVersions() {
  try {
    const list = await api.getNvmList();
    setNodeVersionOptions(list.map((item) => item.version));
  } catch (error) {
    console.error('Failed to load node versions', error);
    setNodeVersionOptions([]);
  }
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
}

async function applyDetectedNodeVersion(rawVersion?: string | null) {
  const normalizedNvmVersion = normalizeNvmVersion(rawVersion);
  if (!normalizedNvmVersion) {
    if (rawVersion) {
      console.warn('Invalid .nvmrc version, skipping auto install', rawVersion);
      ElMessage.warning(t('project.invalidNvmrc'));
    }
    return;
  }

  let installed = findInstalledNodeVersion(nodeVersions.value, normalizedNvmVersion);

  if (!installed) {
    try {
      ElMessage.info(t('project.autoInstallStart', { version: normalizedNvmVersion }));
      await api.installNode(normalizedNvmVersion);
      ElMessage.success(t('project.autoInstallSuccess', { version: normalizedNvmVersion }));
      await refreshNodeVersions();
      installed = findInstalledNodeVersion(nodeVersions.value, normalizedNvmVersion);
    } catch (installError) {
      ElMessage.error(`${t('project.autoInstallFailed', { version: normalizedNvmVersion })}: ${String(installError)}`);
      console.error('Failed to auto-install node version', installError);
    }
  }

  if (installed) {
    form.value.nodeVersion = installed;
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
    await applyDetectedNodeVersion(info.nvmVersion);
    return;
  }

  form.value.type = 'other';
  form.value.scripts = [];
  form.value.visibleScripts = [];
}

function hydrateFormFromProject(project: Project) {
  form.value = {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    gitConfigured: !!project.gitConfigured,
    gitRemoteUrl: project.gitRemoteUrl || '',
    gitBranch: project.gitBranch || '',
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
    editorId: project.editorId || '',
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
    const nvmList = await api.getNvmList().catch(() => []);
    const projectNodeEntry = nvmList.find((v) => v.version === form.value.nodeVersion);
    const nodePath = projectNodeEntry?.path || '';

    // 解析默认 Node 路径
    let defaultNodePath = '';
    try {
      defaultNodePath = await api.getSystemNodePath();
    } catch (_) {}

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
      const defaultNodePath = await api.getSystemNodePath();
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
      const [isGitRepo, entries, info] = await Promise.all([
        api.gitCheck(selected).catch(() => false),
        api.readDir(selected).catch(() => []),
        api.scanProject(selected),
      ]);

      pathIsGitRepo.value = isGitRepo;
      pathEntryCount.value = entries.length;
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
    project.nodeVersion = form.value.nodeVersion;
    project.packageManager = form.value.packageManager;
    project.packageManagerSource = form.value.packageManagerSource;
    project.scripts = form.value.scripts;
    project.visibleScripts = form.value.visibleScripts;
  }

  project.customCommands = form.value.customCommands.filter((command) => command.name && command.command);

  if (form.value.editorId) {
    project.editorId = form.value.editorId;
  }

  // Preserve pin and sort state when editing
  if (isEdit.value && props.editProject) {
    project.pinned = props.editProject.pinned;
    project.pinOrder = props.editProject.pinOrder;
    project.sortOrder = props.editProject.sortOrder;
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
    }

    const project = buildProjectPayload();
    if (isEdit.value) {
      emit('update', project);
    } else {
      emit('add', project);
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
        <div v-if="form.path" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span v-if="pathIsGitRepo">{{ t('project.gitLocalRepoDetected') }}</span>
          <span v-else>{{ t('project.gitLocalRepoMissing') }}</span>
        </div>
      </el-form-item>

      <template v-if="canConfigureRepo">
        <el-form-item :label="t('project.gitConfigureRepo')">
          <el-switch v-model="form.gitConfigured" />
          <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
            class="mb-4 rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {{ t('project.gitTargetMustBeEmpty') }}
          </div>
        </template>
      </template>

      <el-form-item :label="t('project.type')">
        <el-select v-model="form.type" class="w-full">
          <el-option label="Node" value="node" />
          <el-option :label="t('project.typeOther')" value="other" />
        </el-select>
      </el-form-item>

      <template v-if="form.type === 'node'">
        <div class="grid gap-4 grid-cols-3">
          <div class="min-w-0">
            <el-form-item :label="t('project.nodeVersion')">
              <el-select v-model="form.nodeVersion">
                <el-option :label="t('nodes.select')" value="" />
                <el-option v-for="version in nodeVersions" :key="version" :label="version" :value="version" />
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
                  <span v-if="pmAvailability[pm]" class="ml-1 text-[10px]" :class="pmAvailability[pm].available ? 'text-emerald-500' : 'text-red-400'">
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

        <el-form-item v-if="form.scripts.length > 0" :label="t('project.scripts')">
          <div class="w-full rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-900/40 p-3">
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">{{ t('project.scriptsVisibilityHint') }}</p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                v-for="script in form.scripts"
                :key="script"
                type="button"
                @click="toggleVisibleScript(script)"
                class="script-toggle"
                :class="isScriptVisible(script) ? 'script-toggle-active' : 'script-toggle-inactive'"
              >
                <span class="truncate font-mono text-[12px]">{{ script }}</span>
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
        <div class="text-xs text-slate-400 mt-1">{{ editorHint }}</div>
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
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.1);
  color: rgb(37, 99, 235);
}

.script-toggle-inactive {
  border-color: rgba(148, 163, 184, 0.25);
  background: rgba(255, 255, 255, 0.85);
  color: rgb(71, 85, 105);
}

.dark .script-toggle-inactive {
  background: rgba(15, 23, 42, 0.72);
  color: rgb(203, 213, 225);
}

.script-toggle:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
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
