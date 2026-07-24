<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useProjectStore } from '../stores/project';
import { useGitStore } from '../stores/git';
import { useUsageStore } from '../stores/usage';
import { useSettingsStore } from '../stores/settings';
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
import { calculateDraggedItemCenterY, calculateDraggedItemTranslateY, calculateFlipTransforms } from '../utils/dragPosition';
import { pinyin } from 'pinyin-pro';

const { t } = useI18n();
const projectStore = useProjectStore();
const gitStore = useGitStore();
const usageStore = useUsageStore();
const settingsStore = useSettingsStore();
const showModal = ref(false);
const editingProject = ref<Project | null>(null);
const refreshing = ref(false);
const PROJECT_LIST_ITEM_GAP = 8;
const PROJECT_LIST_OVERSCAN = 4;

// Right panel tab
const rightTab = ref<'console' | 'git' | 'files' | 'memo'>('console');

// Project list container ref for scroll-to-project
const projectListContainer = ref<HTMLElement | null>(null);
const projectListScrollTop = ref(0);
const projectListViewportHeight = ref(0);
const projectItemHeights = ref<Record<string, number>>({});
const projectItemElements = new Map<string, HTMLElement>();

function resolveElementRef(target: unknown): Element | null {
    if (target instanceof Element) return target;
    if (target && typeof target === 'object' && '$el' in target) {
        const maybeElement = (target as { $el?: unknown }).$el;
        return maybeElement instanceof Element ? maybeElement : null;
    }
    return null;
}

function estimateProjectItemHeight(project: Project) {
    const running = (projectStore.runningProjectCount[project.id] || 0) > 0;
    const expanded = projectStore.activeProjectId === project.id || running;
    const scriptCount = (project.visibleScripts?.length || project.scripts?.length || 0) + (project.customCommands?.length || 0);

    if (!expanded || scriptCount === 0) {
        return 88 + PROJECT_LIST_ITEM_GAP;
    }

    const rows = Math.min(3, Math.max(1, Math.ceil(scriptCount / 2)));
    return 116 + rows * 24 + PROJECT_LIST_ITEM_GAP;
}

function handleProjectListScroll() {
    const container = projectListContainer.value;
    if (!container) return;
    projectListScrollTop.value = container.scrollTop;
}

function updateProjectListViewport() {
    const container = projectListContainer.value;
    if (!container) return;
    projectListViewportHeight.value = container.clientHeight;
    projectListScrollTop.value = container.scrollTop;
}

let projectListResizeObserver: ResizeObserver | null = null;
let projectItemResizeObserver: ResizeObserver | null = null;

function registerProjectItemRef(projectId: string, element: Element | null) {
    const existing = projectItemElements.get(projectId);
    if (existing && existing !== element) {
        projectItemResizeObserver?.unobserve(existing);
        projectItemElements.delete(projectId);
    }

    if (!(element instanceof HTMLElement)) return;

    element.dataset.projectId = projectId;
    projectItemElements.set(projectId, element);
    projectItemResizeObserver?.observe(element);
}

function findProjectMetricIndexByOffset(offset: number) {
    const metrics = projectListMetrics.value;
    let low = 0;
    let high = metrics.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const metric = metrics[mid];

        if (offset < metric.start) {
            high = mid - 1;
        } else if (offset >= metric.end) {
            low = mid + 1;
        } else {
            return mid;
        }
    }

    return Math.max(0, Math.min(metrics.length - 1, low));
}

function scrollToActiveProject() {
    if (!projectStore.activeProjectId || !projectListContainer.value) return;
    const metric = projectListMetrics.value.find(item => item.project.id === projectStore.activeProjectId);
    if (!metric) return;

    const container = projectListContainer.value;
    container.scrollTo({
        top: Math.max(0, metric.start - container.clientHeight / 2 + metric.height / 2),
        behavior: 'smooth'
    });
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

    if (projectListContainer.value) {
        projectListResizeObserver = new ResizeObserver(updateProjectListViewport);
        projectListResizeObserver.observe(projectListContainer.value);
        updateProjectListViewport();
    }

    projectItemResizeObserver = new ResizeObserver((entries) => {
        const nextHeights = { ...projectItemHeights.value };
        let changed = false;

        for (const entry of entries) {
            const projectId = (entry.target as HTMLElement).dataset.projectId;
            if (!projectId) continue;

            const measured = Math.ceil(entry.contentRect.height);
            if (nextHeights[projectId] !== measured) {
                nextHeights[projectId] = measured;
                changed = true;
            }
        }

        if (changed) {
            projectItemHeights.value = nextHeights;
        }
    });
});

onBeforeUnmount(() => {
    tabResizeObserver?.disconnect();
    projectListResizeObserver?.disconnect();
    projectItemResizeObserver?.disconnect();
    projectItemElements.clear();
    projectPinyinCache.clear();
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
watch(activeProject, (newProject) => {
  if (newProject) {
    void gitStore.checkGitRepo(newProject.id, newProject.path);
  }
}, { immediate: true });

watch(
    () => projectStore.requestedRightTabToken,
    () => {
        if (projectStore.requestedRightTab) {
            rightTab.value = projectStore.requestedRightTab;
        }
    }
);

//************* 搜索功能 *************
const searchQuery = ref('');

function buildPinyinSearchText(text: string): string {
    if (!text) return '';
    const syllables = pinyin(text, { toneType: 'none', type: 'array' }) as string[];
    const full = syllables.join('');
    const initials = syllables.map(s => s[0] || '').join('');
    return `${full} ${initials}`.toLowerCase();
}

const projectPinyinCache = new Map<string, string>();

function getCachedPinyinSearchText(text: string) {
    if (!text) return '';
    const cached = projectPinyinCache.get(text);
    if (cached) return cached;

    const next = buildPinyinSearchText(text);
    projectPinyinCache.set(text, next);
    return next;
}

const sortMode = computed(() => settingsStore.settings.sortMode ?? 'default');

const sortOptions = computed(() => [
    { label: t('dashboard.sortModeDefault'), value: 'default' },
    { label: t('dashboard.sortModeSmart'), value: 'smart' },
]);

// Whether drag is allowed (default mode + no active search)
const isDraggable = computed(() => sortMode.value === 'default' && !searchQuery.value.trim());

const sortedProjects = computed(() => {
    if (sortMode.value === 'smart') {
        const weights = usageStore.calculateAllWeights();
        return [...projectStore.projects].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            const wa = weights[a.id] ?? 0;
            const wb = weights[b.id] ?? 0;
            if (wa !== wb) return wb - wa;
            if (a.pinned && b.pinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
            return 0;
        });
    }
    // Default sort: pinned first, then by sortOrder (manual), then by original array order
    return [...projectStore.projects].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (a.pinned && b.pinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
        // For unpinned: use sortOrder if available, otherwise maintain original order
        const oa = a.sortOrder ?? Infinity;
        const ob = b.sortOrder ?? Infinity;
        if (oa !== ob) return oa - ob;
        return 0;
    });
});

const projectSearchIndex = computed(() => {
    return sortedProjects.value.map(project => ({
        project,
        normalizedName: project.name.toLowerCase(),
        normalizedPath: project.path.toLowerCase(),
        compactName: project.name.toLowerCase().replace(/\s+/g, ''),
        compactPath: project.path.toLowerCase().replace(/\s+/g, ''),
        namePinyin: getCachedPinyinSearchText(project.name),
        pathPinyin: getCachedPinyinSearchText(project.path),
    }));
});

const filteredProjects = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const compactQuery = query.replace(/\s+/g, '');

    if (!query) {
        return sortedProjects.value;
    }

    return projectSearchIndex.value
        .filter(({ normalizedName, normalizedPath, compactName, compactPath, namePinyin, pathPinyin }) => {
            return normalizedName.includes(query)
                || normalizedPath.includes(query)
                || compactName.includes(compactQuery)
                || compactPath.includes(compactQuery)
                || namePinyin.includes(compactQuery)
                || pathPinyin.includes(compactQuery);
        })
        .map(item => item.project);
});

/***********************项目列表手动拖拽排序*********************/
const draggableList = ref<Project[]>([]);
const dragState = ref({
    dragging: false,
    projectId: null as string | null,
    pointerOffsetY: 0,
    dragDelta: 0,
    fromIndex: -1,
    currentFromIndex: -1,
    containerEl: null as HTMLElement | null,
});
let flipAnimating = false;

watch(() => sortedProjects.value, (newSorted) => {
    if (!dragState.value.dragging) {
        draggableList.value = [...newSorted];
    }
}, { immediate: true });

function onDragMouseDown(e: MouseEvent, projectId: string) {
    e.preventDefault();
    const handleEl = e.currentTarget as HTMLElement;
    const itemEl = handleEl.closest('.draggable-item') as HTMLElement;
    const listEl = handleEl.closest('.draggable-list') as HTMLElement;
    if (!itemEl || !listEl) return;

    const startIndex = draggableList.value.findIndex(p => p.id === projectId);
    if (startIndex < 0) return;

    const itemRect = itemEl.getBoundingClientRect();

    dragState.value = {
        dragging: true,
        projectId,
        pointerOffsetY: e.clientY - itemRect.top,
        dragDelta: 0,
        fromIndex: startIndex,
        currentFromIndex: startIndex,
        containerEl: listEl,
    };

    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
}

function onDragMouseMove(e: MouseEvent) {
    const state = dragState.value;
    if (!state.dragging || !state.containerEl) return;

    // 按当前 DOM 基准位置计算位移，避免换位后叠加初始位移导致元素远离鼠标。
    const items = Array.from(state.containerEl.children) as HTMLElement[];
    const draggedItem = items[state.currentFromIndex];
    if (!draggedItem) return;

    state.dragDelta = calculateDraggedItemTranslateY({
        pointerClientY: e.clientY,
        listClientTop: state.containerEl.getBoundingClientRect().top,
        pointerOffsetY: state.pointerOffsetY,
        itemOffsetTop: draggedItem.offsetTop,
    });

    let targetIndex = state.currentFromIndex;
    const draggedCenter = calculateDraggedItemCenterY({
        itemOffsetTop: draggedItem.offsetTop,
        itemHeight: draggedItem.offsetHeight,
        translateY: state.dragDelta,
    });

    for (let i = 0; i < items.length; i++) {
        if (i === state.currentFromIndex) continue;
        const itemTop = items[i].offsetTop;
        const itemHeight = items[i].offsetHeight;
        const itemCenter = itemTop + itemHeight / 2;

        if (state.currentFromIndex < i && draggedCenter > itemCenter) {
            targetIndex = i;
        } else if (state.currentFromIndex > i && draggedCenter < itemCenter) {
            targetIndex = i;
        }
    }

    if (targetIndex !== state.currentFromIndex && !flipAnimating) {
        animateReorder(state.currentFromIndex, targetIndex);
        state.currentFromIndex = targetIndex;
    }
}

function animateReorder(fromIdx: number, toIdx: number) {
    const listEl = dragState.value.containerEl;
    if (!listEl) return;
    flipAnimating = true;

    // 按项目 ID 记录换位前位置，用于 FLIP 动画。
    const children = Array.from(listEl.children) as HTMLElement[];
    const oldPositions = children
        .map(el => ({ id: el.dataset.projectId ?? '', top: el.offsetTop }))
        .filter(item => item.id);

    // 更新列表顺序，让 DOM 进入换位后的真实布局。
    const [moved] = draggableList.value.splice(fromIdx, 1);
    draggableList.value.splice(toIdx, 0, moved);

    // DOM 更新后，让非拖拽元素从旧位置平滑移动到新位置。
    nextTick(() => {
        const newChildren = Array.from(listEl.children) as HTMLElement[];
        const transforms = calculateFlipTransforms({
            oldPositions,
            newPositions: newChildren
                .map(el => ({ id: el.dataset.projectId ?? '', top: el.offsetTop }))
                .filter(item => item.id),
            excludedId: dragState.value.projectId,
        });

        newChildren.forEach((el) => {
            const translateY = transforms.get(el.dataset.projectId ?? '');
            if (translateY !== undefined) {
                el.style.transition = 'none';
                el.style.transform = `translateY(${translateY}px)`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.style.transition = 'transform 0.18s ease';
                        el.style.transform = '';
                        el.addEventListener('transitionend', () => {
                            el.style.transition = '';
                            el.style.transform = '';
                        }, { once: true });
                    });
                });
            }
        });

        setTimeout(() => { flipAnimating = false; }, 200);
    });
}

function onDragMouseUp() {
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragMouseUp);

    const state = dragState.value;
    if (state.dragging && state.currentFromIndex !== state.fromIndex) {
        syncDraggableOrder();
    }

    dragState.value = {
        dragging: false,
        projectId: null,
        pointerOffsetY: 0,
        dragDelta: 0,
        fromIndex: -1,
        currentFromIndex: -1,
        containerEl: null,
    };
}

function syncDraggableOrder() {
    const projectMap = new Map(projectStore.projects.map(p => [p.id, p]));
    let unpinnedIndex = 0;
    draggableList.value.forEach((p, i) => {
        const proj = projectMap.get(p.id);
        if (!proj) return;
        if (p.pinned) {
            proj.pinOrder = i;
        } else {
            proj.sortOrder = unpinnedIndex++;
        }
    });
}

const projectListMetrics = computed(() => {
    let offset = 0;

    return filteredProjects.value.map((project) => {
        const height = projectItemHeights.value[project.id] ?? estimateProjectItemHeight(project);
        const start = offset;
        offset += height;

        return {
            project,
            start,
            end: offset,
            height,
        };
    });
});

const totalProjectListHeight = computed(() => {
    const metrics = projectListMetrics.value;
    return metrics.length ? metrics[metrics.length - 1].end : 0;
});

const visibleProjectMetrics = computed(() => {
    const metrics = projectListMetrics.value;
    if (metrics.length === 0) return [];

    const viewportStart = Math.max(0, projectListScrollTop.value);
    const viewportEnd = viewportStart + Math.max(projectListViewportHeight.value, 1);
    const startIndex = Math.max(0, findProjectMetricIndexByOffset(viewportStart) - PROJECT_LIST_OVERSCAN);
    const endIndex = Math.min(metrics.length, findProjectMetricIndexByOffset(viewportEnd) + PROJECT_LIST_OVERSCAN + 1);

    return metrics.slice(startIndex, endIndex);
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
            <div class="sidebar-header-actions">
                <button @click="refreshProjects" :disabled="refreshing" class="sidebar-header-btn" :title="t('common.refresh') || 'Refresh'">
                    <div class="i-mdi-refresh text-base transition-transform duration-700" :class="{ 'animate-spin': refreshing }" />
                </button>
                <button @click="batchAddProjects" class="sidebar-header-btn" :title="t('dashboard.batchAddProject')">
                    <div class="i-mdi-folder-multiple-plus text-base" />
                </button>
                <button @click="openAddModal" class="sidebar-header-btn" :title="t('dashboard.addProject')">
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
            <div class="flex items-center justify-between mt-1.5 sort-mode-control">
                <span class="text-[10px] text-slate-400 dark:text-slate-500">{{ t('dashboard.sortMode') }}</span>
                <el-tooltip :content="sortMode === 'smart' ? t('dashboard.sortModeSmartHint') : t('dashboard.sortModeDefaultHint')" placement="top" :show-after="300">
                    <el-segmented v-model="settingsStore.settings.sortMode" :options="sortOptions" size="small" />
                </el-tooltip>
            </div>
        </div>
        
        <div class="flex-1 overflow-y-auto p-3 custom-scrollbar" ref="projectListContainer" @scroll="handleProjectListScroll">
             <!-- Draggable list (default sort mode, no search) -->
             <div v-if="isDraggable && draggableList.length > 0" class="draggable-list">
                 <div
                     v-for="project in draggableList"
                     :key="project.id"
                     :data-project-id="project.id"
                     class="draggable-item group/item"
                     :class="{ 'draggable-item-active': dragState.dragging && dragState.projectId === project.id }"
                     :style="dragState.dragging && dragState.projectId === project.id
                         ? `transform: translateY(${dragState.dragDelta}px); z-index: 50; transition: none;`
                         : ''"
                 >
                     <div
                         class="drag-handle"
                         @mousedown.prevent="onDragMouseDown($event, project.id)"
                     >
                         <div class="i-mdi-drag text-[11px] text-slate-300 dark:text-slate-600 group-hover/item:text-slate-400 dark:group-hover/item:text-slate-500 transition-colors" />
                     </div>
                     <ProjectListItem
                         :project="project"
                         @edit="openEditModal(project)"
                     />
                 </div>
             </div>

             <!-- Virtual scroll list (smart sort mode or searching) -->
             <div v-else-if="filteredProjects.length > 0" class="relative min-h-full" :style="{ height: `${totalProjectListHeight}px` }">
                <div
                    v-for="item in visibleProjectMetrics"
                    :key="item.project.id"
                    :ref="(el) => registerProjectItemRef(item.project.id, resolveElementRef(el))"
                    class="absolute left-0 right-0"
                    :style="{ transform: `translateY(${item.start}px)` }"
                >
                    <div :style="{ paddingBottom: `${PROJECT_LIST_ITEM_GAP}px` }">
                        <ProjectListItem
                            :project="item.project"
                            @edit="openEditModal(item.project)"
                        />
                    </div>
                </div>
             </div>

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
            <div class="workspace-topbar flex items-center border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#0f172a] px-3 shrink-0 min-w-0">
                <!-- Project Name (always visible) -->
                <div class="project-title-group flex items-center gap-2 pr-3 mr-2 shrink-0 min-w-0">
                    <button @click="scrollToActiveProject" class="toolbar-icon-btn" :title="t('dashboard.locateProject')">
                        <div class="i-mdi-crosshairs-gps text-sm" />
                    </button>
                    <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate max-w-48 tracking-tight">{{ activeProject.name }}</h3>
                </div>
                <!-- Tab scroll left arrow -->
                <button v-show="canScrollLeft" @click="scrollTabs('left')"
                    class="toolbar-scroll-btn shrink-0">
                    <div class="i-mdi-chevron-left text-base" />
                </button>
                <!-- Scrollable tabs container -->
                <div ref="tabScrollContainer" @scroll="checkTabOverflow" class="flex items-center overflow-x-auto scrollbar-none min-w-0 flex-1 py-2 px-1">
                <div class="workspace-tab-group">
                <button
                    @click="rightTab = 'console'"
                    class="workspace-tab-btn"
                    :class="{ 'workspace-tab-btn-active': rightTab === 'console' }"
                >
                    <div class="i-mdi-console text-sm" />
                    <span>{{ t('dashboard.console') }}</span>
                </button>
                <button
                    @click="rightTab = 'git'"
                    class="workspace-tab-btn"
                    :class="{ 'workspace-tab-btn-active': rightTab === 'git' }"
                >
                    <div class="i-mdi-git text-sm" />
                    <span>{{ t('git.title') }}</span>
                    <span v-if="isGitRepo && gitChangesCount > 0" class="workspace-tab-badge">{{ gitChangesCount }}</span>
                </button>
                <button
                    @click="rightTab = 'files'"
                    class="workspace-tab-btn"
                    :class="{ 'workspace-tab-btn-active': rightTab === 'files' }"
                >
                    <div class="i-mdi-folder-outline text-sm" />
                    <span>{{ t('dashboard.files') }}</span>
                </button>
                <button
                    @click="rightTab = 'memo'"
                    class="workspace-tab-btn"
                    :class="{ 'workspace-tab-btn-active': rightTab === 'memo' }"
                >
                    <div class="i-mdi-note-text-outline text-sm" />
                    <span>{{ t('dashboard.memo') }}</span>
                </button>
                </div>
                </div>
                <!-- Tab scroll right arrow -->
                <button v-show="canScrollRight" @click="scrollTabs('right')"
                    class="toolbar-scroll-btn shrink-0">
                    <div class="i-mdi-chevron-right text-base" />
                </button>
            </div>

            <!-- Tab Content -->
            <div class="flex-1 overflow-hidden relative">
                <Transition name="tab-fade" mode="out-in">
                <KeepAlive>
                <ConsoleView v-if="rightTab === 'console'" />
                <GitView v-else-if="rightTab === 'git'" />
                <FileManager v-else-if="rightTab === 'files'" :project="activeProject" />
                <ProjectMemo v-else-if="rightTab === 'memo'" :project="activeProject" />
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

.workspace-topbar {
  box-shadow: inset 0 -1px 0 rgba(148, 163, 184, 0.08);
}

.project-title-group {
  padding: 3px 6px 3px 3px;
  border-radius: 16px;
}

.sidebar-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(248, 250, 252, 0.42));
  backdrop-filter: blur(18px) saturate(1.08);
  -webkit-backdrop-filter: blur(18px) saturate(1.08);
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    inset 0 0 0 1px rgba(226, 232, 240, 0.46);
}

.sidebar-header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: rgb(148 163 184);
  transition: all 0.2s ease, background-color 0.2s ease, color 0.2s ease;
}

.sidebar-header-btn:hover:not(:disabled) {
  color: rgb(37 99 235);
  background: rgba(255, 255, 255, 0.44);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.38),
    inset 0 0 0 1px rgba(191, 219, 254, 0.32);
}

.sidebar-header-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-icon-btn,
.toolbar-scroll-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border: none;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(248, 250, 252, 0.36));
  color: rgb(100 116 139);
  backdrop-filter: blur(16px) saturate(1.08);
  -webkit-backdrop-filter: blur(16px) saturate(1.08);
  box-shadow:
    0 8px 18px rgba(15, 23, 42, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    inset 0 0 0 1px rgba(226, 232, 240, 0.42);
  transition: all 0.2s ease, background-color 0.2s ease, color 0.2s ease;
}

.toolbar-icon-btn:hover,
.toolbar-scroll-btn:hover {
  color: rgb(37 99 235);
  background: rgba(255, 255, 255, 0.62);
  box-shadow:
    0 10px 20px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.48),
    inset 0 0 0 1px rgba(191, 219, 254, 0.28);
}

.workspace-tab-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.56), rgba(248, 250, 252, 0.4));
  backdrop-filter: blur(18px) saturate(1.08);
  -webkit-backdrop-filter: blur(18px) saturate(1.08);
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.48),
    inset 0 0 0 1px rgba(226, 232, 240, 0.44);
}

.workspace-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: rgb(100 116 139);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.18s ease, background-color 0.18s ease, color 0.18s ease;
}

.workspace-tab-btn:hover {
  color: rgb(51 65 85);
  background: rgba(255, 255, 255, 0.34);
}

.workspace-tab-btn-active {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(248, 250, 252, 0.44));
  color: rgb(37 99 235);
  backdrop-filter: blur(14px) saturate(1.1);
  -webkit-backdrop-filter: blur(14px) saturate(1.1);
  box-shadow:
    0 8px 18px rgba(15, 23, 42, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    inset 0 0 0 1px rgba(191, 219, 254, 0.32);
}

.workspace-tab-badge {
  margin-left: 2px;
  min-width: 18px;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.14);
  padding: 0 6px;
  color: rgb(234 88 12);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

:global(html.dark) .project-title-group {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0)),
    rgba(15, 23, 42, 0.14);
}

:global(html.dark) .sidebar-header-actions {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0)),
    linear-gradient(180deg, rgba(30, 41, 59, 0.24), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(18px) saturate(1.02);
  -webkit-backdrop-filter: blur(18px) saturate(1.02);
  box-shadow:
    0 10px 24px rgba(2, 6, 23, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}

:global(html.dark) .toolbar-icon-btn,
:global(html.dark) .toolbar-scroll-btn {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
    linear-gradient(180deg, rgba(30, 41, 59, 0.24), rgba(15, 23, 42, 0.18));
  color: rgb(148 163 184);
  backdrop-filter: blur(16px) saturate(1.02);
  -webkit-backdrop-filter: blur(16px) saturate(1.02);
  box-shadow:
    0 8px 18px rgba(2, 6, 23, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}

:global(html.dark) .sidebar-header-btn {
  background: transparent;
  color: rgb(148 163 184);
}

:global(html.dark) .sidebar-header-btn:hover:not(:disabled) {
  color: rgb(96 165 250);
  background: rgba(255, 255, 255, 0.05);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    inset 0 0 0 1px rgba(96, 165, 250, 0.12);
}

:global(html.dark) .toolbar-icon-btn:hover,
:global(html.dark) .toolbar-scroll-btn:hover {
  color: rgb(96 165 250);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.028), rgba(255, 255, 255, 0)),
    linear-gradient(180deg, rgba(30, 41, 59, 0.28), rgba(15, 23, 42, 0.2));
  box-shadow:
    0 10px 20px rgba(2, 6, 23, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    inset 0 0 0 1px rgba(96, 165, 250, 0.12);
}

:global(html.dark) .workspace-tab-group {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0)),
    linear-gradient(180deg, rgba(30, 41, 59, 0.24), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(18px) saturate(1.02);
  -webkit-backdrop-filter: blur(18px) saturate(1.02);
  box-shadow:
    0 10px 24px rgba(2, 6, 23, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}

:global(html.dark) .workspace-tab-btn {
  color: rgb(124 140 164);
}

:global(html.dark) .workspace-tab-btn:hover {
  color: rgb(203 213 225);
  background: rgba(255, 255, 255, 0.045);
}

:global(html.dark) .workspace-tab-btn-active {
  background:
    linear-gradient(180deg, rgba(96, 165, 250, 0.12), rgba(59, 130, 246, 0.04)),
    linear-gradient(180deg, rgba(51, 65, 85, 0.34), rgba(15, 23, 42, 0.22));
  color: rgb(165 206 255);
  backdrop-filter: blur(16px) saturate(1.05);
  -webkit-backdrop-filter: blur(16px) saturate(1.05);
  box-shadow:
    0 8px 18px rgba(2, 6, 23, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    inset 0 0 0 1px rgba(96, 165, 250, 0.12);
}

:global(html.dark) .workspace-tab-badge {
  background: rgba(249, 115, 22, 0.16);
  color: rgb(251 146 60);
}

/* Draggable list items */
.draggable-list {
  position: relative;
}

.draggable-item {
  position: relative;
  margin-bottom: 8px;
}

.draggable-item-active {
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  border-radius: 8px;
  opacity: 0.92;
}

.dark .draggable-item-active {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

/* Drag handle - inside item top-left corner, no space taken */
.drag-handle {
  position: absolute;
  left: 6px;
  top: 6px;
  width: 16px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 30;
}

.draggable-item:hover .drag-handle {
  opacity: 1;
}

.drag-handle:active {
  cursor: grabbing;
}

/* Sort mode segmented control font size */
.sort-mode-control :deep(.el-segmented) {
  font-size: 10px;
}

.sort-mode-control :deep(.el-segmented__item) {
  padding: 2px 8px;
  min-height: 22px;
}

.sort-mode-control :deep(.el-segmented__item-label) {
  font-size: 10px;
  line-height: 1.2;
}
</style>
