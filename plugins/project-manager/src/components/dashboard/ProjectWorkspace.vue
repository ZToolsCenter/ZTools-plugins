<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Project } from '../../types';
import { useProjectStore } from '../../stores/project';
import { useNavMemoryStore } from '../../stores/navMemory.ts';
import { useAppShortcuts } from '../../composables/useAppShortcuts.ts';
import { useI18n } from 'vue-i18n';
import type { ProjectGitOverview } from '../../utils/projectGitOverview';
import WorkspaceProjectExplorer from './WorkspaceProjectExplorer.vue';
import ProjectManagementPanel from './ProjectManagementPanel.vue';
import ProjectSwitcherPopover from './ProjectSwitcherPopover.vue';
import SubProjectScanModal from '../SubProjectScanModal.vue';

const props = defineProps<{
  rootId: string;
  targetProjectId?: string | null;
  gitOverviewById?: Readonly<Record<string, ProjectGitOverview | undefined>>;
  runningCountByProjectId?: Readonly<Record<string, number>>;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'edit', project: Project): void;
  (e: 'open-project', project: Project): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const navMemory = useNavMemoryStore();
const selectedProjectId = ref<string | null>(null);
const scanTarget = ref<Project | null>(null);
const showScanModal = ref(false);
const switcherVisible = ref(false);

const rootProject = computed(() => projectStore.projects.find(project => project.id === props.rootId) || null);
const currentNode = rootProject;
const selectedLeafId = selectedProjectId;

function isProjectInWorkspace(project: Project | null): boolean {
  const root = rootProject.value;
  if (!project || !root) return false;
  let current: Project | undefined = project;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.id === root.id) return true;
    seen.add(current.id);
    current = current.parentId
      ? projectStore.projects.find(candidate => candidate.id === current?.parentId)
      : undefined;
  }
  return false;
}

const activeLeaf = computed<Project | null>(() => {
  if (!selectedLeafId.value) return currentNode.value;
  const selected = projectStore.projects.find(project => project.id === selectedLeafId.value) || null;
  return selected && isProjectInWorkspace(selected) ? selected : currentNode.value;
});
const workspaceProject = computed<Project | null>(() => activeLeaf.value || currentNode.value);
const selectedProject = workspaceProject;

function syncActiveProject(): void {
  projectStore.activeRootId = rootProject.value?.id || null;
  projectStore.activeProjectId = selectedProject.value?.id || null;
}

function resolveSelection(): void {
  const root = rootProject.value;
  if (!root) {
    selectedProjectId.value = null;
    syncActiveProject();
    return;
  }
  const target = props.targetProjectId
    ? projectStore.projects.find(project => project.id === props.targetProjectId) || null
    : null;
  const remembered = navMemory.getLevelLeaf(root.id, rememberedId => {
    const project = projectStore.projects.find(candidate => candidate.id === rememberedId) || null;
    return isProjectInWorkspace(project);
  });
  const nextProjectId = target && isProjectInWorkspace(target)
    ? target.id
    : remembered || root.id;
  selectedProjectId.value = nextProjectId;
  navMemory.rememberLevelLeaf(root.id, nextProjectId === root.id ? null : nextProjectId);
  syncActiveProject();
}

function selectProject(project: Project): void {
  if (!isProjectInWorkspace(project)) return;
  selectedProjectId.value = project.id;
  if (rootProject.value) {
    navMemory.rememberLevelLeaf(rootProject.value.id, project.id === rootProject.value.id ? null : project.id);
  }
  syncActiveProject();
}

function selectSwitcherProject(project: Project): void {
  switcherVisible.value = false;
  if (isProjectInWorkspace(project)) {
    selectProject(project);
    return;
  }
  emit('open-project', project);
}

function openScan(project: Project): void {
  scanTarget.value = project;
  showScanModal.value = true;
}

function handleScanClosed(): void {
  scanTarget.value = null;
}

function openHeaderScan(): void {
  const project = selectedProject.value || rootProject.value;
  if (project) openScan(project);
}

function handleBack(): void {
  emit('back');
}

const breadcrumb = computed(() => {
  const root = rootProject.value;
  const selected = selectedProject.value;
  if (!root || !selected) return root ? [root] : [];
  const result: Project[] = [];
  const seen = new Set<string>();
  let current: Project | undefined = selected;
  while (current && !seen.has(current.id)) {
    result.unshift(current);
    if (current.id === root.id) break;
    seen.add(current.id);
    current = current.parentId
      ? projectStore.projects.find(candidate => candidate.id === current?.parentId)
      : undefined;
  }
  return result[0]?.id === root.id ? result : [root];
});

watch(
  () => [props.rootId, props.targetProjectId, projectStore.projects.map(project => project.id).join('|')],
  resolveSelection,
  { immediate: true },
);
watch(() => props.rootId, () => {
  switcherVisible.value = false;
});
watch(selectedProject, syncActiveProject, { immediate: true });

onBeforeUnmount(() => {
  if (projectStore.activeRootId === props.rootId) projectStore.activeRootId = null;
  if (selectedProjectId.value && projectStore.activeProjectId === selectedProjectId.value) {
    projectStore.activeProjectId = null;
  }
});

useAppShortcuts([
  {
    keys: 'Escape', enabled: () => !!rootProject.value, handler: handleBack,
    allowInEditable: false,
  },
  {
    keys: 'Alt+ArrowLeft',
    allowInEditable: false,
    enabled: () => !!rootProject.value,
    handler: handleBack,
  },
]);
</script>

<template>
  <div class="project-workspace flex h-full w-full min-w-0 flex-col overflow-hidden">
    <div class="workspace-header app-section-divider flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <button type="button" class="toolbar-icon-btn shrink-0" :title="t('dashboard.back')" @click="handleBack">
        <div class="i-mdi-arrow-left text-base" />
      </button>
      <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        <template v-for="(node, index) in breadcrumb" :key="node.id">
          <div v-if="index > 0" class="i-mdi-chevron-right shrink-0 text-xs text-slate-400" />
          <el-popover
            v-if="index === 0"
            v-model:visible="switcherVisible"
            placement="bottom-start"
            :width="360"
            :teleported="false"
            :disabled="!rootProject"
            popper-class="project-switcher-popper"
          >
            <ProjectSwitcherPopover
              :projects="projectStore.projects"
              :current-project-id="selectedProject?.id"
              :git-overview-by-id="gitOverviewById"
              :running-count-by-project-id="runningCountByProjectId"
              @select="selectSwitcherProject"
            />
            <template #reference>
              <button
                type="button"
                class="breadcrumb-item workspace-project-switcher shrink-0"
                :class="{ 'breadcrumb-item-active': index === breadcrumb.length - 1 }"
                :title="node.path"
                :disabled="!rootProject"
                @click.stop
              >
                <span class="truncate">{{ node.name }}</span>
                <span class="i-mdi-chevron-down shrink-0 text-sm" aria-hidden="true" />
              </button>
            </template>
          </el-popover>
          <button
            v-else
            type="button"
            class="breadcrumb-item shrink-0"
            :class="{ 'breadcrumb-item-active': index === breadcrumb.length - 1 }"
            @click="selectProject(node)"
          >
            {{ node.name }}
          </button>
        </template>
      </div>
      <button
        type="button"
        class="toolbar-icon-btn shrink-0"
        :title="t('dashboard.manageSubProjects')"
        :disabled="!selectedProject"
        @click="openHeaderScan"
      >
        <div class="i-mdi-file-tree text-base" />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 min-w-0 overflow-hidden">
      <WorkspaceProjectExplorer
        :root-id="props.rootId"
        :selected-project-id="selectedProject?.id || null"
        @select-project="selectProject"
        @edit-project="emit('edit', $event)"
        @scan-project="openScan"
      />
      <ProjectManagementPanel :project="workspaceProject" />
    </div>

    <SubProjectScanModal
      v-if="scanTarget"
      v-model="showScanModal"
      :parent-project="scanTarget"
      @closed="handleScanClosed"
    />
  </div>
</template>

<style scoped>
.workspace-header {
  box-shadow: inset 0 -1px 0 var(--app-border);
}

.scrollbar-none::-webkit-scrollbar {
  display: none;
}

.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.breadcrumb-item {
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  font-weight: 600;
  padding: 3px 8px;
  white-space: nowrap;
}

.breadcrumb-item:hover {
  background: var(--app-primary-soft);
  color: var(--app-primary);
}

.breadcrumb-item-active {
  color: var(--app-primary);
  cursor: default;
}
</style>
