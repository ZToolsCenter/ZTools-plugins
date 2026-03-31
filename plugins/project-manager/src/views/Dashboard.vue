<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useProjectStore } from '../stores/project';
import { useGitStore } from '../stores/git';
import ProjectListItem from '../components/ProjectListItem.vue';
import ConsoleView from '../components/ConsoleView.vue';
import GitView from '../components/git/GitView.vue';
import FileManager from '../components/FileManager.vue';
import ProjectMemo from '../components/ProjectMemo.vue';
import AddProjectModal from '../components/AddProjectModal.vue';
import type { Project } from '../types';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { ElMessage } from 'element-plus';
import { normalizeNvmVersion, findInstalledNodeVersion } from '../utils/nvm';
import { pinyin } from 'pinyin-pro';

const { t } = useI18n();
const projectStore = useProjectStore();
const gitStore = useGitStore();
const showModal = ref(false);
const editingProject = ref<Project | null>(null);
const refreshing = ref(false);

// Right panel tab
const rightTab = ref<'console' | 'git' | 'files' | 'memo'>('console');

// Project list container ref for scroll-to-project
const projectListContainer = ref<HTMLElement | null>(null);

function scrollToActiveProject() {
    if (!projectStore.activeProjectId || !projectListContainer.value) return;
    const el = projectListContainer.value.querySelector(`[data-project-id="${projectStore.activeProjectId}"]`) as HTMLElement;
    if (el) {
        const container = projectListContainer.value;
        const elTop = el.offsetTop;
        const elHeight = el.offsetHeight;
        const containerHeight = container.clientHeight;
        container.scrollTo({
            top: elTop - containerHeight / 2 + elHeight / 2,
            behavior: 'smooth'
        });
    }
}

// Tab bar scroll handling
const tabScrollContainer = ref<HTMLElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

function checkTabOverflow() {
    const el = tabScrollContainer.value;
    if (!el) return;
    canScrollLeft.value = el.scrollLeft > 0;
    canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function scrollTabs(direction: 'left' | 'right') {
    const el = tabScrollContainer.value;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -120 : 120, behavior: 'smooth' });
}

let tabResizeObserver: ResizeObserver | null = null;

onMounted(() => {
    nextTick(checkTabOverflow);
    if (tabScrollContainer.value) {
        tabResizeObserver = new ResizeObserver(checkTabOverflow);
        tabResizeObserver.observe(tabScrollContainer.value);
    }
});

onBeforeUnmount(() => {
    tabResizeObserver?.disconnect();
});

const activeProject = computed(() =>
  projectStore.projects.find(p => p.id === projectStore.activeProjectId)
);

const isGitRepo = computed(() => {
  if (!activeProject.value) return false;
  return gitStore.isGitRepo[activeProject.value.id] || false;
});

const gitChangesCount = computed(() => {
  if (!activeProject.value) return 0;
  return gitStore.getTotalChanges(activeProject.value.id);
});

// Auto-check git repo when project changes
watch(activeProject, async (newProject) => {
  if (newProject) {
    await gitStore.checkGitRepo(newProject.id, newProject.path);
  }
}, { immediate: true });

//************* 搜索功能 *************
const searchQuery = ref('');

function buildPinyinSearchText(text: string): string {
    if (!text) return '';
    const syllables = pinyin(text, { toneType: 'none', type: 'array' }) as string[];
    const full = syllables.join('');
    const initials = syllables.map(s => s[0] || '').join('');
    return `${full} ${initials}`.toLowerCase();
}

const filteredProjects = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const compactQuery = query.replace(/\s+/g, '');

    let list = projectStore.projects;
    if (query) {
        list = list.filter(project => {
            const name = project.name.toLowerCase();
            const projectPath = project.path.toLowerCase();

            if (name.includes(query) || projectPath.includes(query)) {
                return true;
            }

            const namePinyin = buildPinyinSearchText(project.name);
            const pathPinyin = buildPinyinSearchText(project.path);

            return namePinyin.includes(compactQuery) || pathPinyin.includes(compactQuery);
        });
    }

    // Sort: pinned first (by pinOrder), then unpinned in original order
    return [...list].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (a.pinned && b.pinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
        return 0;
    });
});

function handleAdd(project: Project) {
  projectStore.addProject(project);
}

function handleUpdate(project: Project) {
  projectStore.updateProject(project);
  editingProject.value = null;
}

function openAddModal() {
    editingProject.value = null;
    showModal.value = true;
}

function openEditModal(project: Project) {
    editingProject.value = project;
    showModal.value = true;
}

async function refreshProjects() {
    refreshing.value = true;
    try {
        await projectStore.refreshAll();
    } finally {
        refreshing.value = false;
    }
}

async function batchAddProjects() {
    try {
        const selected = await api.openDialog({
            directory: true,
            multiple: true,
        });
        
        if (!selected) return;
        
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length === 0) return;
        
        let addedCount = 0;
        let skipCount = 0;
        let failCount = 0;
        let hasInvalidNvmrc = false;
        
        const pathsToScan: string[] = [];
        const processedInstallVersions = new Set<string>();
        let currentNodeVersions: string[] = [];

        try {
            const nvmList = await api.getNvmList();
            currentNodeVersions = nvmList.map(v => v.version);
        } catch (e) {
            console.error('Failed to load node versions before batch add', e);
        }
        
        // First pass: determine which paths to scan
        for (const path of paths) {
            try {
                // Try to scan the selected path directly
                await api.scanProject(path);
                pathsToScan.push(path);
            } catch (e) {
                // If it fails, it might be a parent directory. Let's check its subdirectories.
                try {
                    const entries = await api.readDir(path);
                    for (const entry of entries) {
                        if (entry.isDirectory) {
                            const subPath = `${path}/${entry.name}`.replace(/\\/g, '/');
                            try {
                                await api.scanProject(subPath);
                                pathsToScan.push(subPath);
                            } catch (subE) {
                                // Not a valid directory, ignore
                            }
                        }
                    }
                } catch (dirE) {
                    console.error(`Failed to read directory ${path}`, dirE);
                    failCount++;
                }
            }
        }
        
        // Second pass: add the valid projects
        for (const path of pathsToScan) {
            // Check if already exists
            if (projectStore.projects.some(p => p.path === path)) {
                skipCount++;
                continue;
            }
            
            try {
                const info = await api.scanProject(path);
                let nodeVersion = 'Default';

                const project: Project = {
                    id: crypto.randomUUID(),
                    name: info.name || path.split(/[/\\]/).pop() || 'Unknown',
                    path: path,
                    type: (info.projectType === 'node' ? 'node' : 'other') as Project['type'],
                };

                if (info.projectType === 'node') {
                    const normalizedNvmVersion = normalizeNvmVersion(info.nvmVersion);
                    if (normalizedNvmVersion) {
                        let installed = findInstalledNodeVersion(currentNodeVersions, normalizedNvmVersion);

                        if (!installed && !processedInstallVersions.has(normalizedNvmVersion)) {
                            processedInstallVersions.add(normalizedNvmVersion);
                            try {
                                ElMessage.info(t('project.autoInstallStart', { version: normalizedNvmVersion }));
                                await api.installNode(normalizedNvmVersion);
                                ElMessage.success(t('project.autoInstallSuccess', { version: normalizedNvmVersion }));

                                const latestList = await api.getNvmList();
                                currentNodeVersions = latestList.map(v => v.version);
                                installed = findInstalledNodeVersion(currentNodeVersions, normalizedNvmVersion);
                            } catch (installErr) {
                                ElMessage.error(`${t('project.autoInstallFailed', { version: normalizedNvmVersion })}: ${String(installErr)}`);
                                console.error('Failed to auto-install node version in batch add', installErr);
                            }
                        }

                        if (!installed) {
                            installed = findInstalledNodeVersion(currentNodeVersions, normalizedNvmVersion);
                        }

                        if (installed) {
                            nodeVersion = installed;
                        }
                    } else if (info.nvmVersion) {
                        hasInvalidNvmrc = true;
                        console.warn('Invalid .nvmrc version in batch add, skipping auto install', info.nvmVersion);
                    }

                    project.nodeVersion = nodeVersion;
                    project.packageManager = info.packageManager || 'npm';
                    project.scripts = info.scripts;
                }

                projectStore.addProject(project);
                addedCount++;
            } catch (e) {
                console.error(`Failed to scan project at ${path}`, e);
                failCount++;
            }
        }
        
        if (addedCount > 0) {
            ElMessage.success(t('dashboard.batchAddSuccess', { count: addedCount }));
        }
        if (skipCount > 0) {
            ElMessage.info(t('dashboard.batchAddSkip', { count: skipCount }));
        }
        if (failCount > 0 && addedCount === 0) {
            ElMessage.warning(t('dashboard.batchAddFail', { count: failCount }));
        }
        if (hasInvalidNvmrc) {
            ElMessage.warning(t('project.invalidNvmrc'));
        }
    } catch (err) {
        console.error('Failed to batch add projects:', err);
        ElMessage.error(t('common.error'));
    }
}
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <!-- Project List Sidebar -->
    <div class="w-72 flex flex-col border-r border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#0f172a] z-20 transition-colors duration-200">
        <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-700/20 flex justify-between items-center">
            <h2 class="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-widest uppercase pl-1">{{ t('dashboard.title') }}</h2>
            <div class="flex gap-1.5">
                <button @click="refreshProjects" :disabled="refreshing" class="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-150 disabled:opacity-40" :title="t('common.refresh') || 'Refresh'">
                    <div class="i-mdi-refresh text-base transition-transform duration-700" :class="{ 'animate-spin': refreshing }" />
                </button>
                <button @click="batchAddProjects" class="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all duration-150" :title="t('dashboard.batchAddProject')">
                    <div class="i-mdi-folder-multiple-plus text-base" />
                </button>
                <button @click="openAddModal" class="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-all duration-150" :title="t('dashboard.addProject')">
                    <div class="i-mdi-plus text-base" />
                </button>
            </div>
        </div>
        
        <!-- 搜索框 -->
        <div class="px-3 py-2 border-b border-slate-200 dark:border-slate-700/20">
            <el-input
                v-model="searchQuery"
                :placeholder="t('dashboard.searchPlaceholder')"
                clearable
                class="w-full"
                size="small"
            >
                <template #prefix>
                    <el-icon><div class="i-mdi-magnify" /></el-icon>
                </template>
            </el-input>
        </div>
        
        <div class="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-2" ref="projectListContainer">
             <ProjectListItem 
                v-for="project in filteredProjects" 
                :key="project.id" 
                :project="project"
                :data-project-id="project.id"
                @edit="openEditModal(project)"
             />
             
             <div v-if="filteredProjects.length === 0 && projectStore.projects.length > 0" class="text-center mt-10 text-slate-400 dark:text-slate-500">
                <div class="i-mdi-magnify text-4xl mb-3 opacity-20 mx-auto" />
                <p class="text-sm font-medium">{{ t('common.search') }}</p>
                <p class="text-xs opacity-50 mt-1">{{ t('dashboard.searchPlaceholder') }}</p>
             </div>
             
             <div v-else-if="projectStore.projects.length === 0" class="text-center mt-20 text-slate-400 dark:text-slate-500">
                <div class="i-mdi-folder-open-outline text-5xl mb-3 opacity-20 mx-auto" />
                <p class="text-sm font-medium">{{ t('dashboard.noProjects') }}</p>
                <p class="text-xs opacity-50 mt-1">{{ t('dashboard.addProject') }}</p>
             </div>
        </div>
    </div>

    <!-- Main Right Panel -->
    <div class="flex-1 overflow-hidden relative bg-slate-50 dark:bg-[#0b1120] transition-colors duration-200 flex flex-col">
        <!-- Empty state when no project selected -->
        <div v-if="!activeProject" class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300 dark:text-slate-600">
            <div class="i-mdi-monitor-dashboard text-6xl opacity-30" />
            <p class="text-sm font-medium">{{ t('dashboard.selectProjectHint') }}</p>
            <p class="text-xs opacity-50">{{ t('dashboard.selectProjectDesc') }}</p>
        </div>

        <!-- Workspace when project selected -->
        <template v-else>
            <!-- Project Name + Tab Bar -->
            <div class="flex items-center border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#0f172a] px-2 shrink-0 min-w-0">
                <!-- Project Name (always visible) -->
                <div class="flex items-center gap-1.5 pr-3 border-r border-slate-200 dark:border-slate-700/20 mr-1 shrink-0">
                    <button @click="scrollToActiveProject" class="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-all duration-150" :title="t('dashboard.locateProject')">
                        <div class="i-mdi-crosshairs-gps text-sm" />
                    </button>
                    <h3 class="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-40 tracking-tight">{{ activeProject.name }}</h3>
                </div>
                <!-- Tab scroll left arrow -->
                <button v-show="canScrollLeft" @click="scrollTabs('left')"
                    class="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0">
                    <div class="i-mdi-chevron-left text-base" />
                </button>
                <!-- Scrollable tabs container -->
                <div ref="tabScrollContainer" @scroll="checkTabOverflow" class="flex items-center overflow-x-auto scrollbar-none min-w-0 flex-1 py-1.5 px-1">
                <div class="flex items-center gap-0.5 bg-slate-100/80 dark:bg-slate-800/50 rounded-lg p-0.5">
                <button
                    @click="rightTab = 'console'"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0"
                    :class="rightTab === 'console'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
                >
                    <div class="i-mdi-console text-sm" />
                    <span>{{ t('dashboard.console') }}</span>
                </button>
                <button
                    @click="rightTab = 'git'"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0"
                    :class="rightTab === 'git'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
                >
                    <div class="i-mdi-git text-sm" />
                    <span>{{ t('git.title') }}</span>
                    <span v-if="isGitRepo && gitChangesCount > 0" class="ml-0.5 px-1.5 py-0 text-[10px] rounded-full bg-orange-500/12 text-orange-600 dark:text-orange-400 font-semibold min-w-4 text-center leading-4">{{ gitChangesCount }}</span>
                </button>
                <button
                    @click="rightTab = 'files'"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0"
                    :class="rightTab === 'files'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
                >
                    <div class="i-mdi-folder-outline text-sm" />
                    <span>{{ t('dashboard.files') }}</span>
                </button>
                <button
                    @click="rightTab = 'memo'"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0"
                    :class="rightTab === 'memo'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
                >
                    <div class="i-mdi-note-text-outline text-sm" />
                    <span>{{ t('dashboard.memo') }}</span>
                </button>
                </div>
                </div>
                <!-- Tab scroll right arrow -->
                <button v-show="canScrollRight" @click="scrollTabs('right')"
                    class="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0">
                    <div class="i-mdi-chevron-right text-base" />
                </button>
            </div>

            <!-- Tab Content -->
            <div class="flex-1 overflow-hidden relative">
                <Transition name="tab-fade" mode="out-in">
                <KeepAlive>
                <ConsoleView v-if="rightTab === 'console'" key="console" />
                <GitView v-else-if="rightTab === 'git'" key="git" />
                <FileManager v-else-if="rightTab === 'files'" :project="activeProject" key="files" />
                <ProjectMemo v-else-if="rightTab === 'memo'" :project="activeProject" key="memo" />
                </KeepAlive>
                </Transition>
            </div>
        </template>
    </div>

    <AddProjectModal 
        v-model="showModal" 
        :edit-project="editingProject"
        @add="handleAdd" 
        @update="handleUpdate"
    />
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 2px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #475569;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
/* Tab panel fade transition */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.15s ease;
}
.tab-fade-enter-from,
.tab-fade-leave-to {
  opacity: 0;
}
</style>
