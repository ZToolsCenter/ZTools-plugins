<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from 'vue';
import { useProjectStore } from '../stores/project';
import { useGitStore } from '../stores/git';
import { useUsageStore } from '../stores/usage';
import { useSettingsStore } from '../stores/settings';
import AddProjectModal from '../components/AddProjectModal.vue';
import ProjectGroupManager from '../components/ProjectGroupManager.vue';
import ImportScanModal from '../components/ImportScanModal.vue';
import SubProjectScanModal from '../components/SubProjectScanModal.vue';
import ProjectWorkspace from '../components/dashboard/ProjectWorkspace.vue';
import ProjectManagementDialog from '../components/dashboard/ProjectManagementDialog.vue';
import ProjectTreeGroup from '../components/dashboard/ProjectTreeGroup.vue';
// ─── 项目总控能力组件 ─────────────────────────────────────────────────
import ViewPresetChips from '../components/dashboard/ViewPresetChips.vue';
import WorkspaceProfileMenu from '../components/dashboard/WorkspaceProfileMenu.vue';
// ─── 项目总控能力 composable ──────────────────────────────────────────
import { useViewPresets } from '../composables/dashboard/useViewPresets';
import { useProjectBatch } from '../composables/dashboard/useProjectBatch';
import { useProjectHealth } from '../composables/dashboard/useProjectHealth';
import { useWorkspaceProfiles } from '../composables/dashboard/useWorkspaceProfiles';
import type { Project, ProjectHealthSnapshot, WorkspaceTab } from '../types';
import type { ImportNode } from '../api/types';
import { useI18n } from 'vue-i18n';
import { compareProjectsByPinnedThenOrder } from '../utils/projectTree.ts';
import { useListDragSort } from '../composables/useListDragSort.ts';
import { useAppShortcuts } from '../composables/useAppShortcuts.ts';
import {
    DEFAULT_FOCUS_SEARCH_SHORTCUT,
    DEFAULT_NEW_PROJECT_SHORTCUT,
    DEFAULT_REFRESH_PROJECTS_SHORTCUT,
} from '../utils/shortcut.ts';
import { collectProjectTags, projectMatchesSelectedTags } from '../utils/projectTags';
import { summarizeGitStatus, type ProjectGitOverview } from '../utils/projectGitOverview';
import { buildProjectSearchEntry, projectSearchEntryMatches } from '../utils/projectSearch';
import {
    collectAutoExpandedProjectIds,
    collectVisibleProjectIds,
    createProjectTreeExpansionState,
    setProjectTreeConstraint,
} from '../utils/projectTreeView';

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

/** 快捷筛选类型：基础(all/pinned/recent/favorite) + 健康(running/dirty/unhealthy/missing) */
type QuickFilter = 'all' | 'pinned' | 'recent' | 'favorite' | 'running' | 'dirty' | 'unhealthy' | 'missing';

/** *********************钻取状态：为空时显示列表页，否则显示工作区页*********************/
const drilledRootId = ref<string | null>(null);
const workspaceTargetProjectId = ref<string | null>(null);
const managementProjectId = ref<string | null>(null);
const managementInitialTab = ref<WorkspaceTab | null>(null);
const showManagementDialog = ref(false);

/** 按 id 解析弹窗项目，避免编辑/扫描替换 store 对象后继续使用旧引用。 */
const managementProject = computed<Project | null>(() => {
    if (!managementProjectId.value) return null;
    return projectStore.projects.find(project => project.id === managementProjectId.value) || null;
});

/***********************一级项目树状态*********************/
const treeExpansionState = createProjectTreeExpansionState();
const expandedProjectIds = ref(treeExpansionState.expandedIds);

function toggleProjectExpanded(project: Project): void {
    const next = new Set(expandedProjectIds.value);
    if (next.has(project.id)) next.delete(project.id);
    else next.add(project.id);
    expandedProjectIds.value = next;
    treeExpansionState.expandedIds = next;
}

function openProjectManagement(project: Project, initialTab: WorkspaceTab | null = null): void {
    managementProjectId.value = project.id;
    managementInitialTab.value = initialTab;
    showManagementDialog.value = true;
}

/** 打开项目最近运行结果；子树摘要会定位到真正产生该 Session 的项目。 */
function openProjectRunSummary(project: Project): void {
    const summary = projectStore.getSubtreeRunSummary(project.id);
    const target = summary
        ? projectStore.projects.find(candidate => candidate.id === summary.projectId) || project
        : project;
    openProjectManagement(target, 'console');
    if (summary && summary.status !== 'running' && summary.sessionId) {
        projectStore.requestConsoleHistory(target.id, summary.sessionId);
    }
}

/** 健康快照覆盖整棵已导入项目树，支持后代 dirty/unhealthy/missing 筛选。 */
const healthProjects = computed(() => projectStore.projects);
const {
    getHealth,
    healthLevel,
} = useProjectHealth({ filteredProjects: healthProjects });

/** 进入某一级项目的工作区 */
function openProjectWorkspace(project: Project) {
    const rootId = projectStore.getRootProjectId(project.id);
    drilledRootId.value = rootId;
    workspaceTargetProjectId.value = project.id === rootId ? null : project.id;
}

/** 从工作区返回列表 */
function backToList() {
    drilledRootId.value = null;
    projectStore.activeRootId = null;
    projectStore.activeProjectId = null;
    // 必须清掉搜索跳转目标：它非空会让下次进入同一项目时被自动下钻到旧目标，
    // 也会让工作区的导航恢复逻辑一直走「搜索优先」的早退分支
    workspaceTargetProjectId.value = null;
    void nextTick(() => {
        const container = projectListContainer.value;
        if (!container) return;
        container.scrollTop = projectListScrollTop.value;
        projectListResizeObserver?.observe(container);
        updateProjectListViewport();
    });
}

/**
 * 消费外部（如全局搜索）请求打开的工作区信号。
 * immediate: true 覆盖「Dashboard 因 v-if 重新挂载、错过挂载前赋值」的时序问题；
 * 消费后立即置空，避免返回列表后再次被触发。
 */
watch(() => projectStore.pendingWorkspaceRootId, (rootId) => {
    if (!rootId) return;
    const target = projectStore.projects.find(p => p.id === rootId);
    workspaceTargetProjectId.value = projectStore.pendingWorkspaceProjectId;
    projectStore.pendingWorkspaceRootId = null;
    projectStore.pendingWorkspaceProjectId = null;
    if (!target) return;
    // 直接切 rootId 即可。
    // 原先这里要「先返回列表、再于下一帧进入目标」，是因为 ProjectWorkspace 带
    // :key="workspace:${rootId}"，在 Transition mode="out-in" 下同分支换 key 会挂载失败。
    // 现在 key 已是静态值（为让 KeepAlive 缓存跨一级项目存活），同一个 vnode 只换 props，
    // Transition 完全不介入，那套绕法既没必要、又会白白闪一下列表页并销毁整份缓存。
    openProjectWorkspace(target);
}, { immediate: true });

/** 工作区内请求编辑项目 */
function editFromWorkspace(project: Project) {
    openEditModal(project);
}

// Project list container ref for scroll-to-project
const projectListContainer = useTemplateRef<HTMLElement>('projectListContainer');
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
    // 行高固定；含描述/标签的行略高
    const hasMeta = !!(project.description || (project.tags && project.tags.length) || project.groupId || projectStore.getSubtreeRunSummary(project.id));
    return (hasMeta ? 68 : 52) + PROJECT_LIST_ITEM_GAP;
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

onMounted(() => {
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
    projectListResizeObserver?.disconnect();
    projectItemResizeObserver?.disconnect();
    projectItemElements.clear();
});

//************* 搜索功能 *************
const searchQuery = ref('');
/** el-input 实例：聚焦搜索快捷键需要拿到内部的原生 input */
const projectSearchInput = useTemplateRef<{ $el?: HTMLElement } | null>('projectSearchInput');
const showGroupManager = ref(false);
const showImportModal = ref(false);

/***********************筛选状态*********************/
const activeQuickFilter = ref<QuickFilter>('all');
const selectedGroupId = ref('');
const selectedTags = ref<string[]>([]);

/** 基础快捷筛选（segmented 控件） */
const quickFilterOptions = computed(() => [
    { label: t('dashboard.filterAll'), value: 'all' },
    { label: t('dashboard.filterFavorite'), value: 'favorite' },
    { label: t('dashboard.filterPinned'), value: 'pinned' },
    { label: t('dashboard.filterRecent'), value: 'recent' },
]);

/** 健康状态快捷筛选 chips（原「项目总览」的分类） */
const healthFilterChips = computed(() => [
    { key: 'running', label: t('dashboard.overviewRunning'), icon: 'i-mdi-play-circle-outline', tone: 'emerald', count: healthCounts.value.running },
    { key: 'dirty', label: t('dashboard.overviewDirty'), icon: 'i-mdi-git', tone: 'amber', count: healthCounts.value.dirty },
    { key: 'unhealthy', label: t('dashboard.overviewUnhealthy'), icon: 'i-mdi-alert-circle-outline', tone: 'red', count: healthCounts.value.unhealthy },
    { key: 'missing', label: t('dashboard.overviewMissing'), icon: 'i-mdi-folder-alert-outline', tone: 'rose', count: healthCounts.value.missing },
]);

function toggleHealthFilter(key: QuickFilter) {
    activeQuickFilter.value = activeQuickFilter.value === key ? 'all' : key;
}

/** 聚合所有项目标签用于筛选下拉 */
const allTags = computed(() => collectProjectTags(projectStore.projects));

const sortMode = computed(() => settingsStore.settings.sortMode ?? 'default');

// ─── 保存视图 composable ──────────────────────────────────────────────
const {
  presets: viewPresets,
  activePresetId,
  saveCurrentView,
  applyPreset,
  deletePreset,
  detectActivePreset,
} = useViewPresets({
  searchQuery,
  activeQuickFilter,
  selectedGroupId,
  selectedTags,
  sortMode,
});

const sortOptions = computed(() => [
    { label: t('dashboard.sortModeDefault'), value: 'default' },
    { label: t('dashboard.sortModeSmart'), value: 'smart' },
]);

// Whether drag is allowed (default mode + no active search + no active filters)
const isDraggable = computed(() =>
    sortMode.value === 'default'
    && !searchQuery.value.trim()
    && activeQuickFilter.value === 'all'
    && !selectedGroupId.value
    && selectedTags.value.length === 0
);

/** 一级项目仍是排序/拖拽单位，树内子项目继续由 parentId 关联。 */
const rootProjects = computed(() => projectStore.projects.filter(p => !p.parentId));

const sortedProjects = computed(() => {
    if (sortMode.value === 'smart') {
        const weights = usageStore.calculateAllWeights();
        return [...rootProjects.value].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            const wa = weights[a.id] ?? 0;
            const wb = weights[b.id] ?? 0;
            if (wa !== wb) return wb - wa;
            if (a.pinned && b.pinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
            return 0;
        });
    }
    return [...rootProjects.value].sort(compareProjectsByPinnedThenOrder);
});

const projectSearchIndex = computed(() => projectStore.projects.map(project => ({
    project,
    ...buildProjectSearchEntry(project),
})));
const projectSearchIndexById = computed(() => new Map(
    projectSearchIndex.value.map(entry => [entry.project.id, entry]),
));

function matchesProjectSearch(project: Project): boolean {
    const entry = projectSearchIndexById.value.get(project.id);
    if (!entry) return false;
    return projectSearchEntryMatches(entry, searchQuery.value);
}

function matchesProjectFilter(project: Project): boolean {
    switch (activeQuickFilter.value) {
        case 'pinned':
            if (!project.pinned) return false;
            break;
        case 'favorite':
            if (!project.favorite) return false;
            break;
        case 'recent': {
            const weights = usageStore.calculateAllWeights();
            if ((weights[project.id] ?? 0) <= 0) return false;
            break;
        }
        case 'running':
            if (!isProjectRunning(project.id)) return false;
            break;
        case 'dirty':
            if (!getHealth(project.id)?.gitDirty) return false;
            break;
        case 'unhealthy':
            if (!isProjectUnhealthy(project.id)) return false;
            break;
        case 'missing':
            if (getHealth(project.id)?.pathExists !== false) return false;
            break;
    }

    if (selectedGroupId.value && project.groupId !== selectedGroupId.value) return false;
    if (selectedTags.value.length > 0 && !projectMatchesSelectedTags(project, selectedTags.value)) return false;
    return matchesProjectSearch(project);
}

const treeConstraintActive = computed(() => Boolean(
    searchQuery.value.trim()
    || activeQuickFilter.value !== 'all'
    || selectedGroupId.value
    || selectedTags.value.length > 0,
));

const matchingProjectIds = computed(() => projectStore.projects
    .filter(matchesProjectFilter)
    .map(project => project.id));

/** 匹配子/孙项目时保留其祖先，用于提供完整路径上下文。 */
const visibleProjectIds = computed(() => {
    if (!treeConstraintActive.value) {
        return new Set(projectStore.projects.map(project => project.id));
    }
    return collectVisibleProjectIds(projectStore.projects, matchingProjectIds.value);
});
const autoExpandedProjectIds = computed(() => treeConstraintActive.value
    ? collectAutoExpandedProjectIds(projectStore.projects, matchingProjectIds.value)
    : new Set<string>());
const effectiveExpandedProjectIds = computed(() => new Set([
    ...expandedProjectIds.value,
    ...autoExpandedProjectIds.value,
]));

watch(treeConstraintActive, (constrained) => {
    setProjectTreeConstraint(treeExpansionState, constrained);
    expandedProjectIds.value = treeExpansionState.expandedIds;
});

/** 批量操作仍默认针对可见一级项目，子项目勾选仍可单独加入 selectedIds。 */
const filteredProjects = computed(() => sortedProjects.value.filter(project => visibleProjectIds.value.has(project.id)));

// ─── 多选批量操作 composable ──────────────────────────────────────────
const filteredProjectIds = computed(() => filteredProjects.value.map((p) => p.id));
const {
  selectedIds,
  selectedCount,
  isAllSelected,
  toggleSelect,
  toggleSelectAll,
  clearSelection,
  batchSetGroup,
  batchPin,
  batchRemove,
} = useProjectBatch({ filteredProjectIds });

/** 批量设置分组的下拉可见性 */
const showBatchGroupMenu = ref(false);
const batchGroupTarget = ref('');

async function applyBatchGroup() {
    await batchSetGroup(batchGroupTarget.value || undefined);
    showBatchGroupMenu.value = false;
    batchGroupTarget.value = '';
}

// ─── 启动组 composable ────────────────────────────────────────────────
const {
  profiles: workspaceProfiles,
  createProfile,
  deleteProfile,
  runProfile,
  stopAll: stopProfile,
} = useWorkspaceProfiles();

/***********************健康状态统计与判定*********************/
// 读聚合值而非 runningProjectCount：后者只按发起命令的项目自身计数，
// 一级项目卡片会漏掉「子项目正在运行」。
function isProjectRunning(projectId: string): boolean {
    return (projectStore.runningSubtreeCount[projectId] ?? 0) > 0;
}

function getRealHealthIssues(snapshot: ProjectHealthSnapshot | undefined) {
    return snapshot?.issues.filter((issue) => issue.code !== 'not_git') ?? [];
}

function isProjectUnhealthy(projectId: string): boolean {
    const snapshot = getHealth(projectId);
    if (!snapshot) return false;
    return !snapshot.pathExists || getRealHealthIssues(snapshot).length > 0;
}

/** 健康分类计数（仅统计一级项目） */
const healthCounts = computed(() => {
    const list = rootProjects.value;
    return {
        running: list.filter(p => isProjectRunning(p.id)).length,
        dirty: list.filter(p => !!getHealth(p.id)?.gitDirty).length,
        unhealthy: list.filter(p => isProjectUnhealthy(p.id)).length,
        missing: list.filter(p => getHealth(p.id)?.pathExists === false).length,
    };
});

/***********************树节点状态映射与 Git 汇总*********************/
const healthById = computed<Record<string, ProjectHealthSnapshot | undefined>>(() => {
    const result: Record<string, ProjectHealthSnapshot | undefined> = {};
    for (const project of projectStore.projects) result[project.id] = getHealth(project.id);
    return result;
});
const healthLevelById = computed<Record<string, 'healthy' | 'warn' | 'error' | 'unknown'>>(() => {
    const result: Record<string, 'healthy' | 'warn' | 'error' | 'unknown'> = {};
    for (const project of projectStore.projects) result[project.id] = healthLevel(getHealth(project.id));
    return result;
});
const gitOverviewById = computed<Record<string, ProjectGitOverview | undefined>>(() => {
    const result: Record<string, ProjectGitOverview | undefined> = {};
    for (const project of projectStore.projects) {
        const overview = summarizeGitStatus(gitStore.getStatus(project.id), gitStore.isGitRepo[project.id]);
        // 非 Git 项目不向一级行传递 overview，避免渲染成「No Git」伪入口。
        if (overview?.isGitRepo) result[project.id] = overview;
    }
    return result;
});

function collectRenderedProjectIds(project: Project, result: Set<string>, depth = 1): void {
    if (!visibleProjectIds.value.has(project.id)) return;
    result.add(project.id);
    if (depth >= 3 || !effectiveExpandedProjectIds.value.has(project.id)) return;

    for (const child of projectStore.getChildren(project.id)) {
        if (child.parentId === project.id && child && visibleProjectIds.value.has(child.id)) {
            collectRenderedProjectIds(child, result, depth + 1);
        }
    }
}

function handleTreeDragStart(event: MouseEvent, project: Project): void {
    onDragMouseDown(event, project.id);
}

function estimateProjectGroupHeight(project: Project): number {
    let height = estimateProjectItemHeight(project);
    const visit = (node: Project, depth: number) => {
        if (depth >= 3 || !effectiveExpandedProjectIds.value.has(node.id)) return;
        for (const child of projectStore.getChildren(node.id)) {
            if (!visibleProjectIds.value.has(child.id)) continue;
            height += 6 + estimateProjectItemHeight(child);
            visit(child, depth + 1);
        }
    };
    visit(project, 1);
    return height;
}

/** 自动检测活跃视图 */
watch([searchQuery, activeQuickFilter, selectedGroupId, selectedTags, sortMode], () => {
  detectActivePreset();
});

/***********************项目列表手动拖拽排序*********************/
// 拖拽逻辑抽到 composables/useListDragSort.ts，与工作区的子项目列表共用；
// 这里只负责把新顺序写回项目数据。
const { draggableList, dragState, onDragMouseDown } = useListDragSort<Project>({
    items: sortedProjects,
    onCommit: (ordered) => projectStore.applyManualOrder(ordered),
});

const projectListMetrics = computed(() => {
    let offset = 0;

    return filteredProjects.value.map((project) => {
        const height = projectItemHeights.value[project.id] ?? estimateProjectGroupHeight(project);
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

/**
 * 默认模式下整组都在 DOM 中，虚拟模式下只刷新视口及 overscan 内的 root 分组。
 * 这样 Git 状态加载跟随真实可见项，不会因项目总数增长而一次性请求全部仓库。
 */
const renderedRootProjects = computed(() =>
    isDraggable.value
        ? filteredProjects.value
        : visibleProjectMetrics.value.map(metric => metric.project),
);
const renderedProjectIds = computed(() => {
    const result = new Set<string>();
    for (const root of renderedRootProjects.value) collectRenderedProjectIds(root, result);
    return result;
});
const renderedProjectIdList = computed(() => [...renderedProjectIds.value]);

async function refreshRenderedGitStatuses(force = false): Promise<void> {
    const projectsById = new Map(projectStore.projects.map(project => [project.id, project]));
    await Promise.all(renderedProjectIdList.value.map(async id => {
        const project = projectsById.get(id);
        if (project) await gitStore.ensureSummaryAndStatus(project.id, project.path, { force });
    }));
}

watch(renderedProjectIdList, () => {
    void refreshRenderedGitStatuses();
}, { immediate: true });

/** 待选择层级的新建项目（父项目已入库，等待用户决定挂载哪些子级） */
const pendingLevelProject = ref<Project | null>(null);
/** 该项目扫描到的候选树 */
const pendingLevelNodes = ref<ImportNode[]>([]);
const showLevelModal = ref(false);

function handleAdd(project: Project, subProjectTree: ImportNode[] = []) {
  projectStore.addProject(project);
  if (subProjectTree.length === 0) return;

  // 扫描到子级/孙级：弹出树形层级选择弹窗，由用户决定挂载到哪一级。
  // 父项目已先行入库，因此这里直接把它当作已有项目传给弹窗，
  // 用户取消也不影响父项目本身——他之后还能在编辑页再次调整层级。
  pendingLevelProject.value = project;
  pendingLevelNodes.value = subProjectTree;
  showLevelModal.value = true;
}

/** 层级选择弹窗彻底关闭后再清理暂存，避免关闭动画被截断 */
function handleLevelClosed() {
  pendingLevelProject.value = null;
  pendingLevelNodes.value = [];
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
        // 手动刷新后强制更新当前树中已渲染项目的 Git 状态，避免沿用旧缓存。
        await refreshRenderedGitStatuses(true);
    } finally {
        refreshing.value = false;
    }
}

/***********************列表页快捷键*********************/
// 只在列表页生效：Dashboard 挂载期间注册，工作区那套键位写在 ProjectWorkspace 里。
// 键位可在设置页改，缺省值见 utils/shortcut.ts。
useAppShortcuts([
    {
        keys: () => settingsStore.settings.focusSearchShortcut || DEFAULT_FOCUS_SEARCH_SHORTCUT,
        // 搜索框本身也要能用这个键重新聚焦并全选，所以允许在输入框内触发
        allowInEditable: true,
        enabled: () => !drilledRootId.value,
        handler: () => {
            const input = projectSearchInput.value?.$el?.querySelector?.('input');
            if (input instanceof HTMLInputElement) {
                input.focus();
                input.select();
            }
        },
    },
    {
        keys: () => settingsStore.settings.newProjectShortcut || DEFAULT_NEW_PROJECT_SHORTCUT,
        enabled: () => !drilledRootId.value,
        handler: openAddModal,
    },
    {
        keys: () => settingsStore.settings.refreshProjectsShortcut || DEFAULT_REFRESH_PROJECTS_SHORTCUT,
        enabled: () => !drilledRootId.value && !refreshing.value,
        handler: () => void refreshProjects(),
    },
]);
</script>

<template>
  <div class="h-full overflow-hidden">
    <!-- 列表页 ↔ 工作区页过渡：进入工作区滑入，返回列表滑出。 -->
    <Transition name="dashboard-page" mode="out-in">
      <!-- ═══ 钻取后：项目工作区页 ═══ -->
      <ProjectWorkspace
        v-if="drilledRootId"
        key="workspace"
        :root-id="drilledRootId"
        :target-project-id="workspaceTargetProjectId"
        :git-overview-by-id="gitOverviewById"
        :running-count-by-project-id="projectStore.runningSubtreeCount"
        @back="backToList"
        @edit="editFromWorkspace"
        @open-project="openProjectWorkspace"
      />

      <!-- ═══ 默认：项目列表页（全宽） ═══ -->
      <div v-else key="project-list" class="h-full flex flex-col app-surface-sidebar">
        <!-- 顶部工具栏 -->
        <div class="app-page-header">
          <div class="app-content-container app-page-header-main">
            <div class="app-page-heading">
                <h2 class="app-page-title">{{ t('dashboard.title') }}</h2>
                <p class="app-page-description">{{ t('dashboard.projectCount', { count: rootProjects.length }) }}</p>
            </div>
            <div class="app-page-actions">
                <button @click="showImportModal = true" class="toolbar-text-btn">
                    <div class="i-mdi-folder-search-outline text-base" />
                    <span>{{ t('dashboard.batchAddProject') }}</span>
                </button>
                <button @click="showGroupManager = true" class="toolbar-text-btn">
                    <div class="i-mdi-folder-plus-outline text-base" />
                    <span>{{ t('dashboard.manageGroups') }}</span>
                </button>
                <button @click="refreshProjects" :disabled="refreshing" class="toolbar-text-btn">
                    <div class="i-mdi-refresh text-base transition-transform duration-700" :class="{ 'animate-spin': refreshing }" />
                    <span>{{ t('common.refresh') }}</span>
                </button>
                <button @click="openAddModal" class="toolbar-primary-btn">
                    <div class="i-mdi-plus text-base" />
                    <span>{{ t('dashboard.addProject') }}</span>
                </button>
            </div>
          </div>
        </div>

        <!-- 选择操作栏（有选中项时显示） -->
        <div v-if="selectedCount > 0" class="selection-bar app-section-divider px-6 py-2.5 border-b flex items-center justify-between">
            <div class="flex items-center gap-3">
                <span class="text-sm font-semibold text-blue-600 dark:text-blue-400">{{ t('dashboard.batchSelected', { count: selectedCount }) }}</span>
                <button class="selection-link" @click="toggleSelectAll">{{ isAllSelected ? t('dashboard.batchDeselectAll') : t('dashboard.batchSelectAll') }}</button>
                <button class="selection-link" @click="clearSelection">{{ t('common.cancel') }}</button>
            </div>
            <div class="flex items-center gap-2">
                <button class="selection-action-btn" @click="batchPin"><div class="i-mdi-pin-outline text-sm" />{{ t('dashboard.batchPin') }}</button>
                <button class="selection-action-btn" @click="showBatchGroupMenu = true"><div class="i-mdi-folder-outline text-sm" />{{ t('dashboard.batchSetGroup') }}</button>
                <button class="selection-action-btn selection-action-danger" @click="batchRemove"><div class="i-mdi-delete-outline text-sm" />{{ t('dashboard.batchRemove') }}</button>
            </div>
        </div>

        <!-- 筛选工具栏 -->
        <div class="app-section-divider px-6 py-3 border-b filter-toolbar">
          <div class="app-content-container space-y-3">
            <!-- 第一行：搜索 + 分组/标签 + 排序 -->
            <div class="flex items-center gap-3">
                <el-input
                    v-model="searchQuery"
                    ref="projectSearchInput"
                    :placeholder="t('dashboard.searchPlaceholder')"
                    clearable
                    style="width: 280px"
                >
                    <template #prefix>
                        <el-icon><div class="i-mdi-magnify" /></el-icon>
                    </template>
                </el-input>

                <el-select v-model="selectedGroupId" clearable :placeholder="t('dashboard.group')" style="width: 150px">
                    <el-option :label="t('dashboard.filterAll')" value="" />
                    <el-option v-for="group in projectStore.projectGroups" :key="group.id" :label="group.name" :value="group.id" />
                </el-select>
                <el-select v-model="selectedTags" multiple clearable collapse-tags collapse-tags-tooltip :placeholder="t('dashboard.tags')" style="width: 180px">
                    <el-option v-for="tag in allTags" :key="tag" :label="tag" :value="tag" />
                </el-select>

                <div class="flex-1" />

                <span class="app-text-meta text-slate-400 dark:text-slate-500">{{ t('dashboard.sortMode') }}</span>
                <el-tooltip :content="sortMode === 'smart' ? t('dashboard.sortModeSmartHint') : t('dashboard.sortModeDefaultHint')" placement="top" :show-after="300">
                    <el-segmented v-model="settingsStore.settings.sortMode" :options="sortOptions" />
                </el-tooltip>
            </div>

            <!-- 第二行：基础快捷筛选 + 健康状态 chips + 保存视图/启动组 -->
            <div class="flex items-center gap-2 flex-wrap">
                <el-segmented v-model="activeQuickFilter" :options="quickFilterOptions" />
                <span class="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
                <button
                    v-for="chip in healthFilterChips"
                    :key="chip.key"
                    @click="toggleHealthFilter(chip.key as any)"
                    class="health-chip"
                    :class="[`health-chip-${chip.tone}`, { 'health-chip-active': activeQuickFilter === chip.key }]"
                    :title="chip.label"
                >
                    <div :class="chip.icon" class="text-sm" />
                    <span>{{ chip.label }}</span>
                    <span class="health-chip-count">{{ chip.count }}</span>
                </button>

                <div class="flex-1" />

                <ViewPresetChips
                    :presets="viewPresets"
                    :active-preset-id="activePresetId"
                    @apply="applyPreset"
                    @delete="deletePreset"
                    @save="saveCurrentView"
                />
                <WorkspaceProfileMenu
                    :profiles="workspaceProfiles"
                    :projects="projectStore.projects"
                    @create="createProfile"
                    @delete="deleteProfile"
                    @run="runProfile"
                    @stop="stopProfile"
                />
            </div>
          </div>
        </div>

        <!-- 项目列表 -->
        <div class="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar" ref="projectListContainer" @scroll="handleProjectListScroll">
              <!-- Draggable list：root 仍是拖拽单位，展开后的整组随 root 一起移动。 -->
              <div v-if="isDraggable && draggableList.length > 0" class="draggable-list app-content-container space-y-2">
                  <div
                     v-for="project in draggableList"
                     :key="project.id"
                     :data-project-id="project.id"
                     class="draggable-item"
                     :class="{ 'draggable-item-active': dragState.dragging && dragState.projectId === project.id }"
                     :style="dragState.dragging && dragState.projectId === project.id
                         ? `transform: translateY(${dragState.dragDelta}px); z-index: 50; transition: none;`
                         : ''"
                  >
                     <ProjectTreeGroup
                         :root-project="project"
                         :visible-ids="visibleProjectIds"
                         :expanded-ids="effectiveExpandedProjectIds"
                         :git-overview-by-id="gitOverviewById"
                         :health-by-id="healthById"
                         :health-level-by-id="healthLevelById"
                         :selected-ids="selectedIds"
                         draggable
                         @toggle-expand="toggleProjectExpanded"
                         @open-management="openProjectManagement"
                         @open-workspace="openProjectWorkspace"
                         @open-git="openProjectManagement($event, 'git')"
                         @open-running="openProjectRunSummary"
                         @toggle-select="toggleSelect"
                         @edit="openEditModal"
                         @drag-start="handleTreeDragStart"
                     />
                  </div>
             </div>

             <!-- Virtual scroll list (smart sort mode or searching) -->
             <div v-else-if="filteredProjects.length > 0" class="relative min-h-full app-content-container" :style="{ height: `${totalProjectListHeight}px` }">
                <div
                    v-for="item in visibleProjectMetrics"
                    :key="item.project.id"
                    :ref="(el) => registerProjectItemRef(item.project.id, resolveElementRef(el))"
                    class="absolute left-0 right-0"
                    :style="{ transform: `translateY(${item.start}px)`, paddingBottom: `${PROJECT_LIST_ITEM_GAP}px` }"
                >
                     <ProjectTreeGroup
                         :root-project="item.project"
                         :visible-ids="visibleProjectIds"
                         :expanded-ids="effectiveExpandedProjectIds"
                         :git-overview-by-id="gitOverviewById"
                         :health-by-id="healthById"
                         :health-level-by-id="healthLevelById"
                         :selected-ids="selectedIds"
                         @toggle-expand="toggleProjectExpanded"
                         @open-management="openProjectManagement"
                         @open-workspace="openProjectWorkspace"
                         @open-git="openProjectManagement($event, 'git')"
                         @open-running="openProjectRunSummary"
                         @toggle-select="toggleSelect"
                         @edit="openEditModal"
                     />
                  </div>
             </div>

             <div v-if="filteredProjects.length === 0 && rootProjects.length > 0" class="text-center mt-16 text-slate-400 dark:text-slate-500">
                <div class="i-mdi-magnify text-4xl mb-3 opacity-20 mx-auto" />
                <p class="text-sm font-medium">{{ t('common.search') }}</p>
                <p class="app-text-meta mt-1 text-slate-500 dark:text-slate-400">{{ t('dashboard.searchPlaceholder') }}</p>
             </div>

             <div v-else-if="rootProjects.length === 0" class="text-center mt-20 text-slate-400 dark:text-slate-500">
                <div class="i-mdi-folder-open-outline text-5xl mb-3 opacity-20 mx-auto" />
                <p class="text-sm font-medium">{{ t('dashboard.noProjects') }}</p>
                <p class="app-text-meta mt-1 text-slate-500 dark:text-slate-400">{{ t('dashboard.addProject') }}</p>
             </div>
         </div>
    </div>
    </Transition>

    <AddProjectModal
        v-model="showModal"
        :edit-project="editingProject"
        @add="handleAdd"
        @update="handleUpdate"
    />

    <!-- 单个添加后的层级选择：让用户决定扫描到的子级/孙级挂到哪一级 -->
    <SubProjectScanModal
        v-if="pendingLevelProject"
        v-model="showLevelModal"
        :parent-project="pendingLevelProject"
        :preset-nodes="pendingLevelNodes"
        @closed="handleLevelClosed"
    />

    <ProjectGroupManager v-model="showGroupManager" />

    <ImportScanModal v-model="showImportModal" />

    <ProjectManagementDialog
        v-model="showManagementDialog"
        :project="managementProject"
        :projects="projectStore.projects"
        :git-overview-by-id="gitOverviewById"
        :running-count-by-project-id="projectStore.runningSubtreeCount"
        :initial-tab="managementInitialTab"
        @select-project="managementProjectId = $event.id"
        @open-workspace="openProjectWorkspace"
        @edit="openEditModal"
    />

    <!-- 批量设置分组 -->
    <el-dialog v-model="showBatchGroupMenu" :title="t('dashboard.batchSetGroup')" width="360px" align-center>
      <el-select v-model="batchGroupTarget" :placeholder="t('dashboard.group')" clearable class="w-full">
        <el-option :label="t('dashboard.ungrouped')" value="" />
        <el-option v-for="group in projectStore.projectGroups" :key="group.id" :label="group.name" :value="group.id" />
      </el-select>
      <template #footer>
        <el-button @click="showBatchGroupMenu = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="applyBatchGroup">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
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
  background: color-mix(in srgb, var(--app-text-muted) 56%, transparent);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--app-text-muted) 72%, transparent);
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

/* 顶部工具栏文字按钮 */
.toolbar-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--app-control-height);
  padding: 0 12px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  font-weight: 500;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease);
}
.toolbar-text-btn:hover:not(:disabled) {
  color: var(--app-primary);
  background: var(--app-primary-soft);
}
.toolbar-text-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--app-control-height);
  padding: 0 16px;
  border: none;
  border-radius: var(--app-radius-md);
  background: var(--app-primary);
  color: #fff;
  font-size: var(--app-font-control);
  font-weight: 600;
  box-shadow: var(--app-shadow-sm);
  transition: filter var(--app-duration-fast) var(--app-ease);
}
.toolbar-primary-btn:hover {
  filter: brightness(1.08);
}

/* 选择操作栏 */
.selection-bar {
  background: color-mix(in srgb, var(--app-primary) 6%, transparent);
}
.selection-link {
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  transition: color var(--app-duration-fast) var(--app-ease);
}
.selection-link:hover {
  color: var(--app-primary);
}
.selection-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: var(--app-control-height-sm);
  padding: 0 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  font-weight: 500;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease),
    border-color var(--app-duration-fast) var(--app-ease);
}
.selection-action-btn:hover {
  color: var(--app-primary);
  border-color: color-mix(in srgb, var(--app-primary) 40%, transparent);
}
.selection-action-danger:hover {
  color: var(--app-danger, #ef4444);
  border-color: color-mix(in srgb, #ef4444 40%, transparent);
}

/* 健康状态快捷筛选 chips */
.health-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: var(--app-font-meta);
  font-weight: 600;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease),
    border-color var(--app-duration-fast) var(--app-ease);
}
.health-chip:hover {
  border-color: var(--app-border-strong);
  color: var(--app-text);
}
.health-chip-count {
  min-width: 18px;
  text-align: center;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--app-surface-soft);
  font-size: var(--app-font-caption);
  font-weight: 700;
}
.health-chip-active {
  color: #fff;
}
.health-chip-emerald.health-chip-active { background: var(--app-success); border-color: var(--app-success); }
.health-chip-amber.health-chip-active { background: var(--app-warning); border-color: var(--app-warning); }
.health-chip-red.health-chip-active,
.health-chip-rose.health-chip-active { background: var(--app-danger, #ef4444); border-color: var(--app-danger, #ef4444); }
.health-chip-active .health-chip-count {
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
}

/* 列表页 ↔ 工作区页过渡：工作区从下方滑入，返回时列表从下方回到原位。 */
.dashboard-page-enter-active,
.dashboard-page-leave-active {
  transition: opacity 180ms var(--app-ease), transform 180ms var(--app-ease);
}
.dashboard-page-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.dashboard-page-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
