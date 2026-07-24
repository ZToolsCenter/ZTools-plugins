<script setup lang="ts">
import type { Project } from '../types';
import type { PackageManagerResolveResult } from '../api/types';
import { useProjectStore } from '../stores/project';
import { useNodeStore } from '../stores/node';
import { useSettingsStore } from '../stores/settings';
import { computed, ref, watch, onMounted } from 'vue';
import { api } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { getCustomCommandDisplayName } from '../utils/projectCommands';
import { resolveNodePathFromVersion, resolveProjectNodePath, isExplicitNodeVersion } from '../utils/nodeRuntime';
import { normalizeNvmVersion } from '../utils/nvm';
import { resolveTerminalCommand } from '../utils/terminalConfig';

const { t } = useI18n();
const props = defineProps<{ project: Project }>();
const emit = defineEmits(['edit']);
const store = useProjectStore();
const nodeStore = useNodeStore();
const settingsStore = useSettingsStore();

const isActive = computed(() => store.activeProjectId === props.project.id);

const displayScripts = computed(() => {
    if (!props.project.scripts?.length) return [];
    if (props.project.visibleScripts?.length) {
        return props.project.scripts.filter(s => props.project.visibleScripts!.includes(s));
    }
    return props.project.scripts;
});

const isRunning = computed(() => {
    return (store.runningProjectCount[props.project.id] || 0) > 0;
});

/** ********************* 包管理器可用性检查 *********************/

/** PM 解析结果缓存（reactive） */
const pmResult = ref<PackageManagerResolveResult>({ available: true });
/** PM 禁用原因 i18n key */
const pmDisabledKey = ref('');
/** PM 禁用原因参数 */
const pmDisabledParams = ref<Record<string, string>>({});

/** 是否有需要 PM 的命令（脚本或安装依赖） */
const hasPmCommands = computed(() => {
    return props.project.type === 'node' &&
        props.project.packageManager &&
        (displayScripts.value.length > 0 || (props.project.customCommands?.length || 0) > 0);
});

/** 包管理器是否不可用 */
const pmUnavailable = computed(() => {
    return hasPmCommands.value && !pmResult.value.available;
});

/** 禁用提示文本 */
const pmDisabledTooltip = computed(() => {
    if (!pmUnavailable.value) return '';
    if (pmDisabledKey.value) {
        return t(pmDisabledKey.value, pmDisabledParams.value);
    }
    return t('project.cmdDisabledUnknown', { pm: props.project.packageManager || 'npm' });
});

/** 刷新 PM 可用性状态 */
async function refreshPmStatus() {
    if (!hasPmCommands.value) {
        pmResult.value = { available: true };
        pmDisabledKey.value = '';
        pmDisabledParams.value = {};
        return;
    }

    try {
        const result = await store.resolvePmForProject(props.project);
        pmResult.value = result;

        if (!result.available) {
            // 构建禁用原因
            const pm = props.project.packageManager || 'npm';
            const nodeVersion = props.project.nodeVersion || 'default';

            // 获取默认 Node 版本
            let defaultNodeVersion = '';
            try {
                const defaultPath = await api.getSystemNodePath();
                if (defaultPath) defaultNodeVersion = await api.getNodeVersion(defaultPath);
            } catch (_) {}

            switch (result.reason) {
                case 'project_node_unavailable':
                    pmDisabledKey.value = 'project.cmdDisabledNoNode';
                    pmDisabledParams.value = { pm };
                    break;
                case 'pm_not_installed_in_project_node':
                    pmDisabledKey.value = 'project.cmdDisabledPmNotInstalled';
                    pmDisabledParams.value = { pm, version: nodeVersion };
                    break;
                case 'default_node_unavailable':
                    pmDisabledKey.value = 'project.cmdDisabledDefaultNodeUnavailable';
                    pmDisabledParams.value = { pm };
                    break;
                case 'pm_not_installed_in_default_node':
                    pmDisabledKey.value = 'project.cmdDisabledPmNotInstalledDefault';
                    pmDisabledParams.value = { pm, version: defaultNodeVersion || 'default' };
                    break;
                default:
                    pmDisabledKey.value = 'project.cmdDisabledUnknown';
                    pmDisabledParams.value = { pm };
            }
        } else {
            pmDisabledKey.value = '';
            pmDisabledParams.value = {};
        }
    } catch (_) {
        pmResult.value = { available: true };
    }
}

// 项目变化时刷新 PM 状态
watch(() => [props.project.packageManager, props.project.packageManagerSource, props.project.nodeVersion], () => {
    refreshPmStatus();
});

onMounted(() => {
    refreshPmStatus();
});

function handleClick() {
    store.activeProjectId = props.project.id;
}

function handleRun(script: string) {
    const runId = `${props.project.id}:${script}`;
    if (store.runningStatus[runId]) {
        store.stopProject(props.project, script);
    } else {
        store.runProject(props.project, script);
    }
}

function handleRunCustom(commandId: string) {
    const runId = `${props.project.id}:${commandId}`;
    if (store.runningStatus[runId]) {
        store.stopProject(props.project, commandId);
    } else {
        store.runCustomCommand(props.project, commandId);
    }
}

function getCommandLabel(name: string, builtinId?: 'install_dependencies') {
    return getCustomCommandDisplayName({ name, builtinId }, t);
}

function handleTogglePin() {
    if (props.project.pinned) {
        store.unpinProject(props.project.id);
    } else {
        store.pinProject(props.project.id);
    }
}

function handleDelete() {
    ElMessageBox.confirm(
        t('dashboard.deleteProjectConfirm', { name: props.project.name }),
        t('dashboard.deleteProject'),
        {
            confirmButtonText: t('common.confirm'),
            cancelButtonText: t('common.cancel'),
            type: 'warning',
            customClass: 'dark-message-box'
        }
    )
        .then(() => {
            store.removeProject(props.project.id);
            ElMessage.success(t('common.success'));
        })
        .catch(() => { });
}

async function openEditor() {
    try {
        let editorPath = settingsStore.settings.editorPath;
        if (props.project.editorId && settingsStore.settings.editors?.length) {
            const found = settingsStore.settings.editors.find(e => e.id === props.project.editorId);
            if (found) editorPath = found.path;
        } else if (settingsStore.settings.editors?.length) {
            const defaultEditor = settingsStore.settings.defaultEditorId
                ? settingsStore.settings.editors.find(e => e.id === settingsStore.settings.defaultEditorId)
                : undefined;
            editorPath = (defaultEditor || settingsStore.settings.editors[0]).path;
        }
        await api.openInEditor(props.project.path, editorPath);
    } catch (e) {
        console.error(e);
        ElMessage.error(`${t('common.error')}: ${e}`);
    }
}

async function openTerminal() {
    try {
        if (props.project.type === 'node') {
            await nodeStore.loadNvmNodes();
        }

        let nodePath = '';
        if (props.project.type === 'node') {
            nodePath = resolveProjectNodePath(props.project, nodeStore.versions);

            // If a specific version is configured but not installed, auto-install it
            if (!nodePath && isExplicitNodeVersion(props.project.nodeVersion)) {
                const version = normalizeNvmVersion(props.project.nodeVersion!)!;
                try {
                    ElMessage.info(t('project.autoInstallStart', { version }));
                    await nodeStore.installNode(version);
                    ElMessage.success(t('project.autoInstallSuccess', { version }));
                    nodePath = resolveProjectNodePath(props.project, nodeStore.versions);
                } catch (installError) {
                    ElMessage.error(`${t('project.autoInstallFailed', { version })}: ${String(installError)}`);
                    console.error('Failed to auto-install node version for terminal', installError);
                }
            }

            if (!nodePath) {
                try {
                    const info = await api.scanProject(props.project.path);
                    nodePath = resolveNodePathFromVersion(info.nvmVersion, nodeStore.versions);
                } catch (scanError) {
                    console.warn('Failed to scan project for terminal node version', scanError);
                }
            }
        }

        const terminalCommand = resolveTerminalCommand(
            settingsStore.settings.defaultTerminal,
            settingsStore.settings.customTerminals,
        );

        const packageManager = props.project.packageManager || 'npm';
        await api.openInTerminal(props.project.path, terminalCommand, nodePath, packageManager);
    } catch (e) {
        console.error(e);
        ElMessage.error(`${t('common.error')}: ${e}`);
    }
}

async function openFolder() {
    try {
        await api.openFolder(props.project.path);
    } catch (e) {
        console.error(e);
        ElMessage.error(`${t('common.error')}: ${e}`);
    }
}
</script>

<template>
    <div @click="handleClick"
        class="p-3.5 rounded-lg cursor-pointer transition-all duration-200 border group relative overflow-hidden mb-2" :class="isActive
            ? 'bg-blue-50/80 dark:bg-blue-500/8 border-blue-200/90 dark:border-blue-500/20 shadow-sm'
            : 'bg-white dark:bg-slate-800/30 border-slate-200/95 dark:border-slate-700/20 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300/95 dark:hover:border-slate-600/30 hover:shadow-sm'">
        <div class="project-actions absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 flex bg-white/92 dark:bg-slate-900/88 backdrop-blur-xl rounded-xl px-0.5 py-0.5 shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
            <button @click.stop="handleTogglePin"
                class="project-action-btn transition-colors duration-150"
                :class="project.pinned ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'"
                :title="project.pinned ? t('dashboard.unpin') : t('dashboard.pin')">
                <div :class="project.pinned ? 'i-mdi-pin' : 'i-mdi-pin-outline'" class="text-xs" />
            </button>
            <button @click.stop="openEditor"
                class="project-action-btn text-slate-400 hover:text-blue-500 transition-colors duration-150"
                :title="t('dashboard.openInEditor')">
                <div class="i-mdi-code-tags text-xs" />
            </button>
            <button @click.stop="openTerminal"
                class="project-action-btn text-slate-400 hover:text-purple-500 transition-colors duration-150"
                :title="t('dashboard.openInTerminal')">
                <div class="i-mdi-console-line text-xs" />
            </button>
            <button @click.stop="openFolder"
                class="project-action-btn text-slate-400 hover:text-amber-500 transition-colors duration-150"
                :title="t('dashboard.openInExplorer')">
                <div class="i-mdi-folder-open text-xs" />
            </button>
            <button @click.stop="$emit('edit')"
                class="project-action-btn text-slate-400 hover:text-emerald-500 transition-colors duration-150"
                :title="t('project.editProject')">
                <div class="i-mdi-pencil text-xs" />
            </button>
            <button @click.stop="handleDelete"
                class="project-action-btn text-slate-400 hover:text-red-500 transition-colors duration-150"
                :title="t('dashboard.deleteProject')">
                <div class="i-mdi-delete text-xs" />
            </button>
        </div>

        <div class="flex justify-between items-center mb-1">
            <div class="flex items-center gap-1.5 min-w-0">
                <div v-if="project.pinned" class="i-mdi-pin text-amber-500 text-[10px] flex-shrink-0" />
                <h3 class="font-semibold text-xs truncate pr-16" :class="isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'">
                    {{ project.name }}
                </h3>
            </div>
            <div class="flex-shrink-0">
                <div v-if="isRunning"
                    class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] animate-pulse">
                </div>
            </div>
        </div>

        <div class="text-[10px] text-slate-400 dark:text-slate-500 truncate font-mono mb-2 pr-4">{{ project.path }}</div>

        <Transition name="project-scripts">
            <div
                v-if="(isActive || isRunning) && (displayScripts.length || (project.customCommands && project.customCommands.length))"
                class="flex flex-wrap gap-1.5 relative z-10 overflow-hidden pt-1"
            >
                <!-- PM 不可用提示条 -->
                <div v-if="pmUnavailable" class="w-full mb-1">
                    <el-tooltip :content="pmDisabledTooltip" placement="top" :show-after="200">
                        <div class="flex items-center gap-1 text-[10px] text-amber-500 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-500/10 rounded px-2 py-0.5 cursor-help">
                            <div class="i-mdi-alert-circle text-xs" />
                            <span>{{ t('project.commandDisabled') }}：{{ pmDisabledTooltip }}</span>
                        </div>
                    </el-tooltip>
                </div>
                <!-- Custom commands (shown first) -->
                <template v-if="project.customCommands && project.customCommands.length">
                    <button v-for="cmd in project.customCommands" :key="cmd.id" @click.stop="handleRunCustom(cmd.id)"
                        class="px-2 py-0.5 text-[10px] rounded border border-dashed transition-all duration-150 uppercase tracking-wider font-medium cursor-pointer"
                        :class="pmUnavailable
                            ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-700'
                            : store.runningStatus[`${project.id}:${cmd.id}`]
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 animate-pulse'
                                : 'bg-blue-500/8 text-blue-600 dark:text-blue-400 border-blue-500/15 hover:bg-blue-500/15'"
                        :disabled="pmUnavailable">
                        {{ getCommandLabel(cmd.name, cmd.builtinId) }}
                    </button>
                </template>
                <!-- Node scripts -->
                <template v-if="project.type === 'node' && displayScripts.length">
                    <button v-for="script in displayScripts" :key="script" @click.stop="handleRun(script)"
                        class="px-2 py-0.5 text-[10px] rounded border transition-all duration-150 uppercase tracking-wider font-medium cursor-pointer"
                        :class="pmUnavailable
                            ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-700'
                            : store.runningStatus[`${project.id}:${script}`]
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 animate-pulse'
                                : (script === 'dev' || script === 'start' || script === 'serve'
                                    ? 'bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 border-emerald-500/15 hover:bg-emerald-500/15'
                                    : 'bg-slate-100 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600/40 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200')"
                        :disabled="pmUnavailable">
                        {{ script }}
                    </button>
                </template>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.project-scripts-enter-active,
.project-scripts-leave-active {
  transition: max-height 0.24s ease, opacity 0.2s ease, transform 0.24s ease, padding-top 0.24s ease;
}

.project-scripts-enter-from,
.project-scripts-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px);
  padding-top: 0;
}

.project-scripts-enter-to,
.project-scripts-leave-from {
  max-height: 160px;
  opacity: 1;
  transform: translateY(0);
}

.project-actions {
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.12),
    inset 0 0 0 1px rgba(226, 232, 240, 0.7);
}

.project-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 20px;
  border: none;
  border-radius: 8px;
  background: transparent;
  transition: all 0.16s ease;
}

.project-action-btn:hover {
  background: rgba(255, 255, 255, 0.72);
  transform: translateY(-1px);
}

.dark .project-actions {
  box-shadow:
    0 12px 28px rgba(2, 6, 23, 0.28),
    inset 0 0 0 1px rgba(51, 65, 85, 0.72);
}

.dark .project-action-btn:hover {
  background: rgba(30, 41, 59, 0.78);
}
</style>
