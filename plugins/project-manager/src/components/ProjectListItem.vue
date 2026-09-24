<script setup lang="ts">
import type { Project, ProjectQuickCommand } from '../types';
import { useProjectStore } from '../stores/project';
import { useWorkspaceEditorStore } from '../stores/workspaceEditor';
import HealthBadge from './dashboard/HealthBadge.vue';
import type { ProjectHealthSnapshot } from '../types';
import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { getCustomCommandDisplayName, getProjectCommandRunId } from '../utils/projectCommands';
import type { ProjectGitOverview } from '../utils/projectGitOverview';
import { resolveProjectQuickCommands } from '../utils/projectQuickCommands';
import { useProjectExternalActions } from '../composables/useProjectExternalActions';
import { formatDuration } from '../utils/runSession';

const { t } = useI18n();
const props = defineProps<{
    project: Project;
    healthSnapshot?: ProjectHealthSnapshot;
    healthLevel?: 'healthy' | 'warn' | 'error' | 'unknown';
    /** 外部指定选中态（用于子项目列表高亮）；不传时回退到 store.activeProjectId 比较 */
    active?: boolean;
    /** 是否显示行首多选框 */
    selectable?: boolean;
    /** 多选是否选中 */
    selected?: boolean;
    /** 卡片布局：inline 用于主列表，stacked 用于窄侧栏子项目列表 */
    layout?: 'inline' | 'stacked';
    /** 仅覆盖界面显示名称，不修改项目数据 */
    displayName?: string;
    /** 一级项目树模式：显示快捷命令、Git 汇总和常驻操作按钮。 */
    treeMode?: boolean;
    /** 一级树行的 Git 状态汇总；未加载时不显示。 */
    gitOverview?: ProjectGitOverview;
    /** 树行是否已展开，供无障碍属性和外部状态使用。 */
    expanded?: boolean;
}>();
const emit = defineEmits<{
    (event: 'edit', project: Project): void;
    (event: 'open', project: Project): void;
    (event: 'toggle-select', projectId: string): void;
    (event: 'open-management', project: Project): void;
    (event: 'open-workspace', project: Project): void;
    (event: 'open-git', project: Project): void;
    (event: 'open-running', project: Project): void;
}>();
const store = useProjectStore();
const editorStore = useWorkspaceEditorStore();
const { openEditor, openTerminal, openFolder } = useProjectExternalActions(() => props.project);

const isActive = computed(() =>
    props.active !== undefined ? props.active : store.activeProjectId === props.project.id
);

/** 直接子项目数量：>0 时该卡片可下钻 */
const childCount = computed(() =>
    store.projects.filter(p => p.parentId === props.project.id).length
);

/** 模块类型徽章文案（前端/后端等） */
const moduleKindLabel = computed(() =>
    props.project.moduleKind ? t(`project.moduleKind.${props.project.moduleKind}`) : ''
);

/***********************运行状态（含子项目）*********************/

/** 项目自身正在运行的命令数 */
const selfRunningCount = computed(() => store.runningProjectCount[props.project.id] || 0);

/**
 * 自身 + 全部后代的运行命令数。
 * 一级项目卡片靠它反映「里面的子项目在跑」——runningProjectCount 只按
 * 发起命令的项目自身计数，父项目上恒为 0。
 */
const subtreeRunningCount = computed(() => store.runningSubtreeCount[props.project.id] || 0);

const isRunning = computed(() => subtreeRunningCount.value > 0);
const runSummary = computed(() => store.getSubtreeRunSummary(props.project.id));

/** 仅后代在跑：用更淡的样式区分，否则用户点进来找不到运行中的命令会困惑 */
const isDescendantOnlyRunning = computed(() => isRunning.value && selfRunningCount.value === 0);

const runningTitle = computed(() => {
    if (!isRunning.value) return '';
    return isDescendantOnlyRunning.value
        ? t('dashboard.subProjectRunning', { count: subtreeRunningCount.value })
        : t('dashboard.running');
});

function getRunSummaryIcon(): string {
    const status = runSummary.value?.status;
    if (status === 'running') return 'i-mdi-circle';
    if (status === 'success') return 'i-mdi-check-circle-outline';
    if (status === 'failed') return 'i-mdi-alert-circle-outline';
    if (status === 'stopped') return 'i-mdi-stop-circle-outline';
    return 'i-mdi-circle-outline';
}

function getRunSummaryLabel(): string {
    const summary = runSummary.value;
    if (!summary) return '';
    const status = t(`dashboard.runStatus${summary.status[0].toUpperCase()}${summary.status.slice(1)}`);
    const duration = summary.durationMs === undefined ? '' : ` · ${formatDuration(summary.durationMs)}`;
    const exit = summary.status === 'failed'
        ? ` · ${t('dashboard.exitCodeShort', { code: summary.exitCode ?? 'null' })}`
        : '';
    return summary.status === 'running'
        ? `${status} · ${summary.displayName}${summary.activeCount > 1 ? ` · ${summary.activeCount}` : ''}`
        : `${t('dashboard.recentRun')} ${status} · ${summary.displayName}${exit}${duration}`;
}

/***********************项目附加信息*********************/

/** 分组名称 */
const groupName = computed(() => {
    if (!props.project.groupId) return '';
    const group = store.projectGroups.find(g => g.id === props.project.groupId);
    return group ? group.name : '';
});

/** 显示的标签（最多 3 个） */
const displayTags = computed(() => {
    if (!props.project.tags || props.project.tags.length === 0) return [];
    return props.project.tags.slice(0, 3);
});

/** 超出的标签数量 */
const extraTagsCount = computed(() => {
    if (!props.project.tags) return 0;
    return Math.max(0, props.project.tags.length - 3);
});

/***********************一级树高频操作*********************/
const treeQuickCommands = computed(() => props.treeMode
    ? resolveProjectQuickCommands(props.project)
    : []);

function isQuickCommandRunning(command: ProjectQuickCommand): boolean {
    return !!store.runningStatus[getProjectCommandRunId(props.project.id, command.type, command.id)];
}

function getQuickCommandLabel(command: ProjectQuickCommand): string {
    if (command.type === 'script') return command.id;
    const customCommand = props.project.customCommands?.find(item => item.id === command.id);
    return customCommand ? getCustomCommandDisplayName(customCommand, t) : command.id;
}

function toggleQuickCommand(command: ProjectQuickCommand): void {
    if (isQuickCommandRunning(command)) {
        void store.stopProject(props.project, command.id, command.type);
        return;
    }

    if (command.type === 'script') {
        void store.runProject(props.project, command.id);
    } else {
        void store.runCustomCommand(props.project, command.id);
    }
}

/***********************交互*********************/

function handleClick() {
    // 由父组件决定语义：列表页 = 钻取进入工作区；子项目列表 = 选中
    emit('open', props.project);
}

function handleToggleSelect() {
    emit('toggle-select', props.project.id);
}

function handleToggleFavorite() {
    store.toggleFavorite(props.project.id);
}

function handleTogglePin() {
    if (props.project.pinned) {
        store.unpinProject(props.project.id);
    } else {
        store.pinProject(props.project.id);
    }
}

function handleDelete() {
    const hasChildren = childCount.value > 0;
    const projectIds = [props.project.id, ...store.collectDescendantIds(props.project.id)];
    const dirtyWarning = editorStore.hasDirtyDocuments(projectIds)
        ? '\n\n该项目有未保存的编辑器内容，删除后这些文档会关闭。'
        : '';
    ElMessageBox.confirm(
        `${hasChildren
            ? t('dashboard.deleteProjectWithChildrenConfirm', { name: props.project.name, count: childCount.value })
            : t('dashboard.deleteProjectConfirm', { name: props.project.name })}${dirtyWarning}`,
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

</script>

<template>
    <div
        class="project-row group"
        :class="[
            isActive ? 'project-row-active' : 'project-row-idle',
            {
                'project-row-selected': selected,
                'project-row-stacked': layout === 'stacked',
                'project-row-tree': treeMode,
            },
        ]"
        @click="handleClick"
    >
        <div class="project-row-content">
            <!-- ─── 行首：多选框 + 拖拽手柄 + 收藏星 ─────────────── -->
            <div class="project-row-leading" @click.stop>
                <label v-if="selectable" class="row-checkbox" @click.stop>
                    <input type="checkbox" :checked="selected" @change="handleToggleSelect" />
                    <span class="row-checkbox-box">
                        <div v-if="selected" class="i-mdi-check text-white text-sm" />
                    </span>
                </label>
                <slot name="leading" />
                <button
                    class="row-star"
                    :class="[
                        project.favorite
                            ? 'row-star-active text-amber-400'
                            : 'text-slate-300 dark:text-slate-600 hover:text-amber-400',
                    ]"
                    :title="project.favorite ? t('project.unfavorite') : t('project.favorite')"
                    @click.stop="handleToggleFavorite"
                >
                    <div :class="project.favorite ? 'i-mdi-star' : 'i-mdi-star-outline'" class="text-xl" />
                </button>
            </div>

            <!-- ─── 健康状态点 ───────────────────────────────
                 置顶状态不在这里重复显示：行尾操作区的图钉按钮已经用
                 实心/空心 + 琥珀色表达了置顶与否，两处都画会让卡片很杂乱。 -->
            <div v-if="healthSnapshot" class="project-row-status">
                <HealthBadge :snapshot="healthSnapshot" :level="healthLevel ?? 'unknown'" />
            </div>

            <!-- ─── 主体：名称 / 路径 / 标签 ─────────────── -->
            <div class="project-row-main">
                <div class="project-row-title-line">
                    <h3 class="project-row-title" :class="isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'">
                        {{ displayName || project.name }}
                    </h3>
                    <span v-if="moduleKindLabel" class="project-kind-chip shrink-0">{{ moduleKindLabel }}</span>
                    <span class="project-row-path">{{ project.path }}</span>
                    <div
                        v-if="isRunning && !treeMode"
                        class="project-running-dot shrink-0"
                        :class="{ 'project-running-dot-descendant': isDescendantOnlyRunning }"
                        :title="runningTitle"
                    />
                </div>
                <div v-if="project.description || displayTags.length > 0 || groupName || runSummary" class="project-row-meta">
                    <span v-if="project.description" class="app-text-meta text-slate-400 dark:text-slate-500 truncate max-w-40" :title="project.description">
                        {{ project.description }}
                    </span>
                    <span
                        v-for="tag in displayTags"
                        :key="tag"
                        class="project-tag-chip project-tag-chip-primary"
                    >
                        {{ tag }}
                    </span>
                    <span v-if="extraTagsCount > 0" class="app-text-meta text-slate-400 dark:text-slate-500">+{{ extraTagsCount }}</span>
                    <span v-if="groupName" class="project-tag-chip project-tag-chip-muted inline-flex items-center gap-0.5">
                        <div class="i-mdi-folder-network text-xs" />
                        {{ groupName }}
                    </span>
                    <button
                        v-if="runSummary"
                        type="button"
                        class="project-run-summary-inline"
                        :class="`project-run-summary-inline-${runSummary.status}`"
                        :title="getRunSummaryLabel()"
                        @click.stop="emit('open-running', project)"
                    >
                        <div :class="getRunSummaryIcon()" class="text-xs" />
                        <span class="truncate">{{ getRunSummaryLabel() }}</span>
                    </button>
                </div>
            </div>

            <!-- ─── 树行中右侧：快捷命令 / Git / 运行状态 ──────────── -->
            <div v-if="treeMode && (treeQuickCommands.length > 0 || gitOverview?.isGitRepo || isRunning)" class="project-tree-highlights" @click.stop>
                <button
                    v-for="command in treeQuickCommands"
                    :key="`${command.type}:${command.id}`"
                    type="button"
                    class="project-quick-command"
                    :class="{ 'project-quick-command-running': isQuickCommandRunning(command) }"
                    :title="isQuickCommandRunning(command) ? t('dashboard.stop') : t('dashboard.start')"
                    @click.stop="toggleQuickCommand(command)"
                >
                    <div :class="isQuickCommandRunning(command) ? 'i-mdi-stop' : 'i-mdi-play'" class="text-xs" />
                    <span class="truncate">{{ getQuickCommandLabel(command) }}</span>
                </button>
                <button
                    v-if="gitOverview?.isGitRepo"
                    type="button"
                    class="project-git-summary"
                    :class="{ 'project-git-summary-dirty': !gitOverview.clean }"
                    :title="t('dashboard.openGitOverview')"
                    @click.stop="emit('open-git', project)"
                >
                    <span>{{ t('git.title') }}</span>
                    <template v-if="gitOverview.isGitRepo && !gitOverview.clean">
                        <span v-if="gitOverview.modified > 0">M{{ gitOverview.modified }}</span>
                        <span v-if="gitOverview.added > 0">A{{ gitOverview.added }}</span>
                        <span v-if="gitOverview.deleted > 0">D{{ gitOverview.deleted }}</span>
                        <span v-if="gitOverview.conflicted > 0" class="project-git-conflict">!{{ gitOverview.conflicted }}</span>
                    </template>
                    <span v-else-if="gitOverview.isGitRepo">{{ t('dashboard.gitClean') }}</span>
                </button>
                <button
                    v-if="isRunning"
                    type="button"
                    class="project-running-summary"
                    :class="{ 'project-running-summary-descendant': isDescendantOnlyRunning }"
                    :title="runningTitle"
                    @click.stop="emit('open-running', project)"
                >
                    <span class="project-running-summary-dot" />
                    <span>{{ subtreeRunningCount }}</span>
                </button>
            </div>

            <!-- ─── 子项目数量 + 下钻箭头 ─────────────── -->
            <div v-if="childCount > 0 && !treeMode" class="project-row-child">
                <span class="project-child-chip inline-flex items-center gap-0.5" :title="t('dashboard.subProjectCount', { count: childCount })">
                    <div class="i-mdi-file-tree text-xs" />
                    {{ childCount }}
                </span>
                <div class="i-mdi-chevron-right text-base text-slate-400 dark:text-slate-500" />
            </div>
        </div>

        <!-- ─── 行尾：树模式保留原有常驻操作与高频入口 ─────────────── -->
        <div class="project-row-actions" @click.stop>
            <template v-if="treeMode">
                <button class="row-action-btn hover:text-amber-500" :class="{ 'text-amber-500': project.pinned }" :title="project.pinned ? t('dashboard.unpin') : t('dashboard.pin')" @click.stop="handleTogglePin">
                    <div :class="project.pinned ? 'i-mdi-pin' : 'i-mdi-pin-outline'" class="text-sm" />
                </button>
                <button class="row-action-btn hover:text-blue-500" :title="t('dashboard.openInEditor')" @click.stop="openEditor">
                    <div class="i-mdi-code-tags text-sm" />
                </button>
                <button class="row-action-btn hover:text-purple-500" :title="t('dashboard.openInTerminal')" @click.stop="openTerminal">
                    <div class="i-mdi-console-line text-sm" />
                </button>
                <button class="row-action-btn hover:text-amber-500" :title="t('dashboard.openInExplorer')" @click.stop="openFolder">
                    <div class="i-mdi-folder-open text-sm" />
                </button>
                <button class="row-action-btn hover:text-emerald-500" :title="t('project.editProject')" @click.stop="emit('edit', project)">
                    <div class="i-mdi-pencil text-sm" />
                </button>
                <button class="row-action-btn hover:text-blue-500" :title="t('dashboard.quickManage')" @click.stop="emit('open-management', project)">
                    <div class="i-mdi-tune-variant text-sm" />
                </button>
                <button class="row-action-btn hover:text-emerald-500" :title="t('dashboard.openFullWorkspace')" @click.stop="emit('open-workspace', project)">
                    <div class="i-mdi-open-in-new text-sm" />
                </button>
                <button class="row-action-btn hover:text-red-500" :title="t('dashboard.deleteProject')" @click.stop="handleDelete">
                    <div class="i-mdi-delete text-sm" />
                </button>
            </template>
            <template v-else>
            <button class="row-action-btn hover:text-amber-500" :class="{ 'text-amber-500': project.pinned }" :title="project.pinned ? t('dashboard.unpin') : t('dashboard.pin')" @click.stop="handleTogglePin">
                <div :class="project.pinned ? 'i-mdi-pin' : 'i-mdi-pin-outline'" class="text-sm" />
            </button>
            <button class="row-action-btn hover:text-blue-500" :title="t('dashboard.openInEditor')" @click.stop="openEditor">
                <div class="i-mdi-code-tags text-sm" />
            </button>
            <button class="row-action-btn hover:text-purple-500" :title="t('dashboard.openInTerminal')" @click.stop="openTerminal">
                <div class="i-mdi-console-line text-sm" />
            </button>
            <button class="row-action-btn hover:text-amber-500" :title="t('dashboard.openInExplorer')" @click.stop="openFolder">
                <div class="i-mdi-folder-open text-sm" />
            </button>
            <button class="row-action-btn hover:text-emerald-500" :title="t('project.editProject')" @click.stop="emit('edit', project)">
                <div class="i-mdi-pencil text-sm" />
            </button>
            <button class="row-action-btn hover:text-red-500" :title="t('dashboard.deleteProject')" @click.stop="handleDelete">
                <div class="i-mdi-delete text-sm" />
            </button>
            </template>
        </div>

    </div>
</template>

<style scoped>
.project-row {
  display: flex;
  align-items: center;
  container-type: inline-size;
  gap: 10px;
  padding: var(--app-row-padding-y) 12px;
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  cursor: pointer;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    border-color var(--app-duration-fast) var(--app-ease);
}

.project-row-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.project-row-leading,
.project-row-status,
.project-row-actions,
.project-row-child {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.project-row-leading {
  gap: 8px;
}

.project-row-status {
  gap: 6px;
}

.project-row-actions {
  gap: 2px;
}

.project-row-child {
  gap: 4px;
  padding-left: 4px;
  border-left: 1px solid var(--app-border);
}

.project-row-main {
  flex: 1;
  min-width: 0;
}

.project-row-tree {
  gap: 6px;
  padding: var(--app-row-padding-y) 10px;
}

.project-row-tree {
  border-radius: var(--app-radius-md);
}

.project-tree-highlights {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  max-width: 52%;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.project-quick-command,
.project-git-summary,
.project-running-summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: var(--app-control-height-sm);
  max-width: 132px;
  padding: 0 7px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-surface-soft);
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  font-weight: 600;
  white-space: nowrap;
  flex: 0 1 auto;
  transition: background-color var(--app-duration-fast) var(--app-ease), color var(--app-duration-fast) var(--app-ease), border-color var(--app-duration-fast) var(--app-ease);
}
.project-quick-command:hover,
.project-git-summary:hover,
.project-running-summary:hover {
  border-color: color-mix(in srgb, var(--app-primary) 36%, transparent);
  color: var(--app-primary);
}
.project-quick-command-running {
  border-color: color-mix(in srgb, var(--app-success) 42%, transparent);
  background: color-mix(in srgb, var(--app-success) 10%, transparent);
  color: var(--app-success);
}
.project-git-summary-dirty {
  border-color: color-mix(in srgb, var(--app-warning) 40%, transparent);
  color: var(--app-warning);
}
.project-git-conflict {
  color: var(--app-danger, #ef4444);
}
.project-running-summary {
  color: var(--app-success);
}
.project-running-summary-descendant {
  opacity: 0.65;
}
.project-running-summary-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 5px currentColor;
}

.project-row-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project-row-tree .project-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-row-tree .project-row-title-line {
  flex: 1 1 auto;
}

.project-row-tree .project-row-meta {
  display: none;
}

.project-row-tree .row-action-btn {
  width: 26px;
  height: 26px;
}

.project-row-title {
  min-width: 0;
  font-size: var(--app-font-body);
  line-height: var(--app-line-height-body);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-row-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  color: var(--app-text-muted);
}

.project-row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  max-height: 20px;
  margin-top: 2px;
  overflow: hidden;
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
}

.project-row-stacked {
  min-height: 112px;
  align-items: stretch;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px 12px;
}

.project-row-stacked .project-row-content {
  align-items: flex-start;
  gap: 8px;
}

.project-row-stacked .project-row-leading {
  padding-top: 4px;
}

.project-row-stacked .project-row-main {
  padding-top: 0;
}

.project-row-stacked .project-row-title-line {
  flex-wrap: wrap;
  row-gap: 4px;
}

@container (max-width: 1180px) {
  .project-row-tree .project-tree-highlights {
    flex-wrap: wrap;
    align-content: center;
    overflow: visible;
  }
}

.project-run-summary-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: min(100%, 300px);
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  text-align: left;
}
.project-run-summary-inline:hover {
  border-color: var(--app-border);
  background: var(--app-surface-soft);
  color: var(--app-primary);
}
.project-run-summary-inline-running { color: var(--app-primary); }
.project-run-summary-inline-success { color: var(--app-success); }
.project-run-summary-inline-failed { color: var(--app-danger); }
.project-run-summary-inline-stopped { color: var(--app-text-secondary); }

@container (max-width: 760px) {
  .project-row-tree {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .project-row-tree .project-row-content {
    flex: 1 1 100%;
  }
  .project-row-tree .project-tree-highlights {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .project-row-tree .project-row-actions {
    margin-left: auto;
  }
}

.project-row-stacked .project-row-title {
  flex: 1 1 0;
  font-size: var(--app-font-body);
}

.project-row-stacked .project-row-path {
  flex-basis: 100%;
}

.project-row-stacked .project-row-actions {
  width: 100%;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--app-border);
}

.project-row-stacked .row-action-btn {
  width: 32px;
  height: 32px;
}

.project-row-idle:hover {
  background: var(--app-surface-soft);
  border-color: var(--app-border-strong);
}

.project-row-active {
  background: var(--app-primary-soft);
  border-color: color-mix(in srgb, var(--app-primary) 30%, transparent);
}

.project-row-selected {
  border-color: color-mix(in srgb, var(--app-primary) 45%, transparent);
  background: color-mix(in srgb, var(--app-primary) 8%, transparent);
}

/* 多选框 */
.row-checkbox {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.row-checkbox input {
  display: none;
}
.row-checkbox-box {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1.5px solid var(--app-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color var(--app-duration-fast) var(--app-ease), border-color var(--app-duration-fast) var(--app-ease);
}
.row-checkbox input:checked + .row-checkbox-box {
  background: var(--app-primary);
  border-color: var(--app-primary);
}

.row-star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  /* 未收藏时不显示：每张卡片左侧都挂一颗灰色空心星会把列表压得很杂乱，
     尤其是 stacked 的子项目卡片。用 opacity 而非 display 隐藏，
     保住占位以免 hover 时标题左右跳动。 */
  opacity: 0;
  transition:
    color var(--app-duration-fast) var(--app-ease),
    opacity var(--app-duration-fast) var(--app-ease);
}

/* 已收藏：常显，这是需要一眼看到的状态 */
.row-star-active {
  opacity: 1;
}

/* 悬停卡片时露出，让未收藏的项目也能被点收藏 */
.project-row:hover .row-star {
  opacity: 1;
}

/* 键盘 Tab 到它时必须可见，否则焦点会落在一个看不见的按钮上 */
.row-star:focus-visible {
  opacity: 1;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-text-muted);
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease);
}
.row-action-btn:hover {
  background: var(--app-surface-soft);
}

.project-running-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--app-success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--app-success) 58%, transparent);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* 仅子项目在跑：不发光、降低不透明度，与「本项目自己在跑」区分开 */
.project-running-dot-descendant {
  opacity: 0.5;
  box-shadow: none;
}

.project-tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: var(--app-radius-xs);
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  font-weight: 600;
}
.project-tag-chip-primary {
  background: var(--app-primary-soft);
  border: 1px solid color-mix(in srgb, var(--app-primary) 24%, transparent);
  color: var(--app-primary);
}
.project-tag-chip-muted {
  background: var(--app-surface-soft);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
}

.project-kind-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: var(--app-radius-xs);
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  font-weight: 600;
  background: color-mix(in srgb, var(--app-primary) 12%, transparent);
  color: var(--app-primary);
  border: 1px solid color-mix(in srgb, var(--app-primary) 22%, transparent);
}

.project-child-chip {
  padding: 0 5px;
  border-radius: var(--app-radius-xs);
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  font-weight: 600;
  background: var(--app-surface-soft);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
}
</style>
