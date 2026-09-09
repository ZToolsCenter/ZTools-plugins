<script setup lang="ts">
/***********************快速管理项目切换器*********************/
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Project } from '../../types';
import type { ProjectGitOverview } from '../../utils/projectGitOverview';
import { compareProjectsByPinnedThenOrder } from '../../utils/projectTree';
import { collectAutoExpandedProjectIds, collectVisibleProjectIds } from '../../utils/projectTreeView';
import { buildProjectSearchEntry, projectSearchEntryMatches } from '../../utils/projectSearch';

interface ProjectSwitcherRow {
  project: Project;
  depth: number;
}

const props = withDefaults(defineProps<{
  projects: readonly Project[];
  currentProjectId?: string | null;
  gitOverviewById?: Readonly<Record<string, ProjectGitOverview | undefined>>;
  runningCountByProjectId?: Readonly<Record<string, number>>;
}>(), {
  currentProjectId: null,
  gitOverviewById: undefined,
  runningCountByProjectId: undefined,
});

const emit = defineEmits<{
  (event: 'select', project: Project): void;
}>();

const { t } = useI18n();
const searchQuery = ref('');

const searchEntries = computed(() => new Map(
  props.projects.map(project => [project.id, buildProjectSearchEntry(project)]),
));

const matchingProjectIds = computed(() => props.projects
  .filter(project => {
    const entry = searchEntries.value.get(project.id);
    return entry ? projectSearchEntryMatches(entry, searchQuery.value) : false;
  })
  .map(project => project.id));

const visibleProjectIds = computed(() => {
  if (!searchQuery.value.trim()) return new Set(props.projects.map(project => project.id));
  return collectVisibleProjectIds(props.projects, matchingProjectIds.value);
});

/**
 * 默认只展示一级项目；搜索结果和当前项目的祖先链自动展开，
 * 这样切换器不会在打开时把整棵项目树铺满，但当前上下文仍然可见。
 */
const expandedProjectIds = ref<Set<string>>(new Set());
const currentProjectAncestorIds = computed(() => {
  if (!props.currentProjectId) return new Set<string>();
  return collectAutoExpandedProjectIds(props.projects, [props.currentProjectId]);
});
const searchAutoExpandedProjectIds = computed(() => {
  if (!searchQuery.value.trim()) return new Set<string>();
  return collectAutoExpandedProjectIds(props.projects, matchingProjectIds.value);
});
const effectiveExpandedProjectIds = computed(() => new Set([
  ...expandedProjectIds.value,
  ...currentProjectAncestorIds.value,
  ...searchAutoExpandedProjectIds.value,
]));

const sortedChildrenByParentId = computed(() => {
  const result = new Map<string | undefined, Project[]>();
  for (const project of props.projects) {
    const children = result.get(project.parentId) || [];
    children.push(project);
    result.set(project.parentId, children);
  }
  for (const children of result.values()) {
    children.sort(compareProjectsByPinnedThenOrder);
  }
  return result;
});

const rows = computed<ProjectSwitcherRow[]>(() => {
  const result: ProjectSwitcherRow[] = [];

  const visit = (parentId: string | undefined, depth: number): void => {
    const children = sortedChildrenByParentId.value.get(parentId) || [];
    for (const project of children) {
      if (!visibleProjectIds.value.has(project.id)) continue;
      result.push({ project, depth });
      if (hasChildren(project.id) && effectiveExpandedProjectIds.value.has(project.id)) {
        visit(project.id, depth + 1);
      }
    }
  };

  visit(undefined, 0);

  // Keep malformed/orphaned records selectable without flattening valid branches.
  const renderedIds = new Set(result.map(row => row.project.id));
  const projectIds = new Set(props.projects.map(project => project.id));
  for (const project of [...props.projects].sort(compareProjectsByPinnedThenOrder)) {
    if (
      !renderedIds.has(project.id)
      && visibleProjectIds.value.has(project.id)
      && (!project.parentId || !projectIds.has(project.parentId))
    ) {
      result.push({ project, depth: 0 });
    }
  }
  return result;
});

function hasChildren(projectId: string): boolean {
  return (sortedChildrenByParentId.value.get(projectId)?.length || 0) > 0;
}

function isExpanded(projectId: string): boolean {
  return hasChildren(projectId) && effectiveExpandedProjectIds.value.has(projectId);
}

function toggleExpanded(projectId: string): void {
  const next = new Set(expandedProjectIds.value);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  expandedProjectIds.value = next;
}

function isRunning(projectId: string): boolean {
  return (props.runningCountByProjectId?.[projectId] || 0) > 0;
}

function selectProject(project: Project): void {
  searchQuery.value = '';
  emit('select', project);
}

function handleRowKeydown(event: KeyboardEvent, project: Project): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  selectProject(project);
}
</script>

<template>
  <div class="project-switcher-popover">
    <el-input
      v-model="searchQuery"
      class="project-switcher-search"
      size="small"
      clearable
      :placeholder="t('dashboard.searchPlaceholder')"
      :aria-label="t('dashboard.searchPlaceholder')"
    >
      <template #prefix>
        <el-icon><div class="i-mdi-magnify" /></el-icon>
      </template>
    </el-input>

    <div v-if="rows.length > 0" class="project-switcher-list" role="listbox">
      <div
        v-for="row in rows"
        :key="row.project.id"
        class="project-switcher-row"
        :class="{ 'project-switcher-row-active': row.project.id === currentProjectId }"
        :style="{ paddingLeft: `${10 + row.depth * 18}px` }"
        :title="row.project.path"
        :aria-selected="row.project.id === currentProjectId"
        role="option"
        tabindex="0"
        @click.stop="selectProject(row.project)"
        @keydown="handleRowKeydown($event, row.project)"
      >
        <span class="project-switcher-tree-mark">
          <button
            v-if="hasChildren(row.project.id)"
            type="button"
            class="project-switcher-tree-toggle"
            :aria-label="isExpanded(row.project.id) ? t('dashboard.collapseProject') : t('dashboard.expandProject')"
            :aria-expanded="isExpanded(row.project.id)"
            @click.stop="toggleExpanded(row.project.id)"
            @keydown.stop
          >
            <span :class="isExpanded(row.project.id) ? 'i-mdi-chevron-down' : 'i-mdi-chevron-right'" />
          </button>
          <span v-else class="i-mdi-file-outline" aria-hidden="true" />
        </span>
        <span class="project-switcher-row-main">
          <span class="project-switcher-row-title">
            <span class="truncate">{{ row.project.name }}</span>
            <span v-if="row.project.moduleKind" class="project-switcher-kind">
              {{ t(`project.moduleKind.${row.project.moduleKind}`) }}
            </span>
          </span>
          <span class="project-switcher-row-path">{{ row.project.path }}</span>
        </span>
        <span class="project-switcher-row-status" aria-hidden="true">
          <span v-if="row.project.id === currentProjectId" class="i-mdi-check project-switcher-current" />
          <span v-if="isRunning(row.project.id)" class="project-switcher-running" />
          <span
            v-if="gitOverviewById?.[row.project.id]?.isGitRepo && !gitOverviewById[row.project.id]?.clean"
            class="project-switcher-git-dirty"
          >
            <span v-if="gitOverviewById[row.project.id]?.modified">M{{ gitOverviewById[row.project.id]?.modified }}</span>
            <span v-if="gitOverviewById[row.project.id]?.added">A{{ gitOverviewById[row.project.id]?.added }}</span>
            <span v-if="gitOverviewById[row.project.id]?.deleted">D{{ gitOverviewById[row.project.id]?.deleted }}</span>
            <span v-if="gitOverviewById[row.project.id]?.conflicted">!{{ gitOverviewById[row.project.id]?.conflicted }}</span>
          </span>
        </span>
      </div>
    </div>
    <div v-else class="project-switcher-empty">
      {{ t('dashboard.noSearchResults') }}
    </div>
  </div>
</template>

<style scoped>
.project-switcher-popover {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  max-width: min(360px, calc(100vw - 48px));
  gap: 8px;
}
.project-switcher-search {
  flex-shrink: 0;
}
.project-switcher-list {
  display: flex;
  flex-direction: column;
  max-height: min(360px, 48vh);
  overflow-y: auto;
  padding: 2px 0;
}
.project-switcher-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding-top: 5px;
  padding-right: 10px;
  padding-bottom: 5px;
  border: none;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-secondary);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}
.project-switcher-row:hover,
.project-switcher-row-active,
.project-switcher-row:focus-visible {
  background: var(--app-primary-soft);
  color: var(--app-text);
  outline: none;
}
.project-switcher-tree-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
  color: var(--app-text-muted);
  font-size: 14px;
}
.project-switcher-tree-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-xs);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.project-switcher-tree-toggle:hover {
  background: color-mix(in srgb, var(--app-primary) 14%, transparent);
  color: var(--app-primary);
}
.project-switcher-row-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.project-switcher-row-title {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
  font-size: var(--app-font-control);
  font-weight: 600;
}
.project-switcher-kind {
  flex-shrink: 0;
  padding: 1px 5px;
  border: 1px solid color-mix(in srgb, var(--app-primary) 22%, transparent);
  border-radius: var(--app-radius-xs);
  color: var(--app-primary);
  font-size: var(--app-font-caption);
  font-weight: 600;
}
.project-switcher-row-path {
  min-width: 0;
  overflow: hidden;
  color: var(--app-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: var(--app-font-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-switcher-row-status {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex-shrink: 0;
  min-width: 18px;
  font-size: var(--app-font-meta);
  font-weight: 700;
}
.project-switcher-current {
  color: var(--app-primary);
  font-size: var(--app-font-control);
}
.project-switcher-running {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--app-success);
  box-shadow: 0 0 5px color-mix(in srgb, var(--app-success) 70%, transparent);
}
.project-switcher-git-dirty {
  display: inline-flex;
  gap: 3px;
  color: var(--app-warning);
  white-space: nowrap;
}
.project-switcher-empty {
  padding: 20px 8px;
  color: var(--app-text-muted);
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  text-align: center;
}
</style>
