<script setup lang="ts">
import type { Project } from '../types';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { computed } from 'vue';
import { api } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const props = defineProps<{ project: Project }>();
const emit = defineEmits(['edit']);
const store = useProjectStore();
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
    if (props.project.scripts?.length) {
        if (props.project.scripts.some(s => store.runningStatus[`${props.project.id}:${s}`])) {
            return true;
        }
    }
    if (props.project.customCommands?.length) {
        if (props.project.customCommands.some(c => store.runningStatus[`${props.project.id}:${c.id}`])) {
            return true;
        }
    }
    return false;
});

function handleClick() {
    store.activeProjectId = props.project.id;
}

function handleRun(script: string) {
    store.runProject(props.project, script);
}

function handleRunCustom(commandId: string) {
    store.runCustomCommand(props.project, commandId);
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
            editorPath = settingsStore.settings.editors[0].path;
        }
        await api.openInEditor(props.project.path, editorPath);
    } catch (e) {
        console.error(e);
        ElMessage.error(`${t('common.error')}: ${e}`);
    }
}

async function openTerminal() {
    try {
        await api.openInTerminal(props.project.path, settingsStore.settings.defaultTerminal);
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
            ? 'bg-blue-50/80 dark:bg-blue-500/8 border-blue-200/80 dark:border-blue-500/20 shadow-sm'
            : 'bg-white dark:bg-slate-800/30 border-slate-200/60 dark:border-slate-700/20 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-600/30 hover:shadow-sm'">
        <div class="absolute right-1 top-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 flex gap-0.5 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm rounded-md px-0.5 py-0.5 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
            <button @click.stop="handleTogglePin"
                class="p-1 transition-colors duration-150 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
                :class="project.pinned ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'"
                :title="project.pinned ? t('dashboard.unpin') : t('dashboard.pin')">
                <div :class="project.pinned ? 'i-mdi-pin' : 'i-mdi-pin-outline'" class="text-xs" />
            </button>
            <button @click.stop="openEditor"
                class="p-1 text-slate-400 hover:text-blue-500 transition-colors duration-150 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
                :title="t('dashboard.openInEditor')">
                <div class="i-mdi-code-tags text-xs" />
            </button>
            <button @click.stop="openTerminal"
                class="p-1 text-slate-400 hover:text-purple-500 transition-colors duration-150 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
                :title="t('dashboard.openInTerminal')">
                <div class="i-mdi-console-line text-xs" />
            </button>
            <button @click.stop="openFolder"
                class="p-1 text-slate-400 hover:text-amber-500 transition-colors duration-150 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
                :title="t('dashboard.openInExplorer')">
                <div class="i-mdi-folder-open text-xs" />
            </button>
            <button @click.stop="$emit('edit')"
                class="p-1 text-slate-400 hover:text-emerald-500 transition-colors duration-150 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
                :title="t('project.editProject')">
                <div class="i-mdi-pencil text-xs" />
            </button>
            <button @click.stop="handleDelete"
                class="p-1 text-slate-400 hover:text-red-500 transition-colors duration-150 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
                :title="t('dashboard.deleteProject')">
                <div class="i-mdi-delete text-xs" />
            </button>
        </div>

        <div class="flex justify-between items-center mb-1">
            <div class="flex items-center gap-1.5">
                <div v-if="project.pinned" class="i-mdi-pin text-amber-500 text-[10px] flex-shrink-0" />
                <h3 class="font-semibold text-xs truncate pr-16" :class="isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'">{{
                    project.name }}</h3>
            </div>
            <div class="flex-shrink-0">
                <div v-if="isRunning"
                    class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] animate-pulse">
                </div>
            </div>
        </div>

        <div class="text-[10px] text-slate-400 dark:text-slate-500 truncate font-mono mb-2 pr-4">{{ project.path }}</div>

        <!-- Node scripts -->
        <div class="flex flex-wrap gap-1.5 relative z-10"
            v-if="project.type === 'node' && (isActive || isRunning) && displayScripts.length">
            <button v-for="script in displayScripts" :key="script" @click.stop="handleRun(script)"
                :disabled="store.runningStatus[`${project.id}:${script}`]"
                class="px-2 py-0.5 text-[10px] rounded border transition-all duration-150 uppercase tracking-wider font-medium"
                :class="script === 'dev' || script === 'start' || script === 'serve'
                    ? 'bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 border-emerald-500/15 hover:bg-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed'
                    : 'bg-slate-100 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600/40 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed'">
                {{ script }}
            </button>
        </div>

        <!-- Custom commands (available for all project types) -->
        <div class="flex flex-wrap gap-1.5 relative z-10"
            v-if="(isActive || isRunning) && project.customCommands && project.customCommands.length">
            <button v-for="cmd in project.customCommands" :key="cmd.id" @click.stop="handleRunCustom(cmd.id)"
                :disabled="store.runningStatus[`${project.id}:${cmd.id}`]"
                class="px-2 py-0.5 text-[10px] rounded border transition-all duration-150 tracking-wider font-medium bg-violet-500/8 text-violet-600 dark:text-violet-400 border-violet-500/15 hover:bg-violet-500/15 disabled:opacity-40 disabled:cursor-not-allowed">
                {{ cmd.name }}
            </button>
        </div>
    </div>
</template>
