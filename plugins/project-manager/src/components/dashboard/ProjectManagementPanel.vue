<script setup lang="ts">
/***********************项目管理共用面板*********************/
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Project, WorkspaceTab } from '../../types';
import { useProjectStore } from '../../stores/project';
import { useRunHistoryStore } from '../../stores/runHistory';
import { useGitStore } from '../../stores/git';
import { useNavMemoryStore } from '../../stores/navMemory.ts';
import { resolveWorkspaceTabFallback } from '../../utils/workspaceTabFallback.ts';
import ConsoleView from '../ConsoleView.vue';
import GitView from '../git/GitView.vue';
import FileManager from '../FileManager.vue';
import ProjectMemo from '../ProjectMemo.vue';
import FrontendEnvPanel from '../FrontendEnvPanel.vue';
import WorkspaceEditor from './WorkspaceEditor.vue';
import { getRunnableProjectScripts } from '../../utils/projectCommands';

const KEEP_ALIVE_MAX = 15;

const props = withDefaults(defineProps<{
  /** 当前右侧管理面板绑定的项目。 */
  project: Project | null;
  /** 打开面板时希望优先进入的页签；不传时复用导航记忆与默认回退规则。 */
  initialTab?: WorkspaceTab | null;
  /** 完整工作区需要标题，快速管理弹窗的标题由弹窗头部负责。 */
  showTitle?: boolean;
  /** 完整工作区启用轻量编辑器，快速管理弹窗显式关闭。 */
  editorEnabled?: boolean;
}>(), {
  initialTab: null,
  showTitle: true,
  editorEnabled: true,
});

const { t } = useI18n();
const projectStore = useProjectStore();
const runHistoryStore = useRunHistoryStore();
const gitStore = useGitStore();
const navMemory = useNavMemoryStore();

/***********************项目能力与页签回退*********************/
const activeProject = computed(() => props.project);
const hasGitRepo = computed(() => {
  const projectId = activeProject.value?.id;
  return projectId ? gitStore.isGitRepo[projectId] === true : false;
});
const gitCapabilityKnown = computed(() => {
  const projectId = activeProject.value?.id;
  return !projectId || projectId in gitStore.isGitRepo;
});
const hasRunnableCommands = computed(() => {
  const project = activeProject.value;
  if (!project) return false;
  return getRunnableProjectScripts(project).length > 0
    || (project.customCommands?.some(command => command.name && command.command) ?? false)
    || runHistoryStore.projectHistory(project.id).length > 0;
});
const hasFrontendEnv = computed(() => (activeProject.value?.frontendEnvGroups?.length || 0) > 0);
const leafTabsDisabled = computed(() => !activeProject.value);
const tabCapabilities = computed(() => ({
  leafTabsDisabled: leafTabsDisabled.value,
  hasRunnableCommands: hasRunnableCommands.value,
  hasGitRepo: hasGitRepo.value,
  hasFrontendEnv: hasFrontendEnv.value,
  editorEnabled: props.editorEnabled,
}));
const defaultTab = computed<WorkspaceTab>(() => {
  if (hasRunnableCommands.value) return 'console';
  if (hasGitRepo.value) return 'git';
  return 'files';
});
const activeTab = ref<WorkspaceTab>('files');
const isResolvingTab = ref(false);
let preserveTabForProjectId: string | null = null;

function resolveInitialTab(tab?: WorkspaceTab | null): WorkspaceTab {
  const project = activeProject.value;
  const remembered = project ? navMemory.getLeafTab(project.id) : null;
  return resolveWorkspaceTabFallback(
    tab ?? remembered ?? defaultTab.value,
    tabCapabilities.value,
  );
}

async function activate(
  tab?: WorkspaceTab | null,
  options: { forceGitCheck?: boolean } = {},
): Promise<void> {
  const project = activeProject.value;
  isResolvingTab.value = true;
  try {
    // 先确认仓库能力，避免切项目时 Git 先被当作不可用而丢掉当前页签。
    if (project && (options.forceGitCheck || !gitCapabilityKnown.value)) {
      await gitStore.checkGitRepo(project.id, project.path, { force: options.forceGitCheck });
      if (activeProject.value?.id !== project.id) return;
    }
    activeTab.value = resolveInitialTab(tab);
    void nextTick(checkTabOverflow);
  } finally {
    isResolvingTab.value = false;
  }
}

function selectTab(tab: WorkspaceTab, remember = true): void {
  activeTab.value = resolveWorkspaceTabFallback(tab, tabCapabilities.value);
  const projectId = activeProject.value?.id;
  if (remember && projectId) {
    navMemory.rememberLeafTab(projectId, activeTab.value);
  }
}

watch(
  () => [activeProject.value?.id, activeProject.value?.path] as const,
  ([projectId, projectPath], previous) => {
  const [previousProjectId, previousProjectPath] = previous || [];
  const firstActivation = previous === undefined;
  const pathChanged = !firstActivation
    && projectId === previousProjectId
    && projectPath !== previousProjectPath;
  const preferredTab = firstActivation ? props.initialTab : activeTab.value;
  if (!firstActivation && projectId) preserveTabForProjectId = projectId;
  void activate(preferredTab, { forceGitCheck: pathChanged }).finally(() => {
    if (preserveTabForProjectId === projectId) preserveTabForProjectId = null;
  });

  const project = activeProject.value;
  if (project) {
    void gitStore.ensureSummaryAndStatus(project.id, project.path, { force: pathChanged });
  }
  },
  { immediate: true },
);

watch(() => props.initialTab, (tab, previous) => {
  if (tab !== previous) void activate(tab);
});

watch([hasRunnableCommands, hasGitRepo, hasFrontendEnv, leafTabsDisabled, activeTab, () => props.editorEnabled], () => {
  if (isResolvingTab.value || !gitCapabilityKnown.value) return;
  const next = resolveWorkspaceTabFallback(activeTab.value, tabCapabilities.value);
  if (next !== activeTab.value) activeTab.value = next;
});

/** 运行命令或其他面板发起的切页请求只作用于目标项目。 */
watch(() => projectStore.requestedRightTabToken, () => {
  const project = activeProject.value;
  const requestedProjectId = projectStore.requestedRightTabProjectId;
  const requestedTab = projectStore.requestedRightTab;
  if (project && requestedProjectId === project.id && requestedTab) {
    void activate(requestedTab);
  }
});

/** 另一个同项目面板手动切页后，当前实例跟随同一份导航记忆。 */
watch(() => {
  const projectId = activeProject.value?.id;
  return projectId ? navMemory.memory.leafTab[projectId] : undefined;
}, (tab) => {
  if (isResolvingTab.value || !gitCapabilityKnown.value) return;
  if (preserveTabForProjectId === activeProject.value?.id) {
    preserveTabForProjectId = null;
    return;
  }
  if (tab) selectTab(tab, false);
});

/***********************Git 状态与页签栏*********************/
const gitChangesCount = computed(() => {
  const projectId = activeProject.value?.id;
  return projectId ? gitStore.getTotalChanges(projectId) : 0;
});

const tabScrollContainer = useTemplateRef<HTMLElement>('tabScrollContainer');
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

function checkTabOverflow(): void {
  const element = tabScrollContainer.value;
  if (!element) return;
  canScrollLeft.value = element.scrollLeft > 0;
  canScrollRight.value = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
}

function scrollTabs(direction: 'left' | 'right'): void {
  const element = tabScrollContainer.value;
  if (!element) return;
  element.scrollBy({ left: direction === 'left' ? -120 : 120, behavior: 'smooth' });
}

onMounted(() => {
  void nextTick(checkTabOverflow);
  if (tabScrollContainer.value) {
    const observer = new ResizeObserver(checkTabOverflow);
    observer.observe(tabScrollContainer.value);
    tabResizeObserver = observer;
  }
});

let tabResizeObserver: ResizeObserver | null = null;
onBeforeUnmount(() => tabResizeObserver?.disconnect());

watch([activeProject, hasRunnableCommands, hasGitRepo, hasFrontendEnv, () => props.editorEnabled], () => {
  void nextTick(checkTabOverflow);
});

defineExpose({ activate });
</script>

<template>
  <div class="project-management-panel flex-1 min-w-0 w-full h-full min-h-0 flex flex-col overflow-hidden app-workspace-panel">
    <div
      class="workspace-topbar app-workspace-topbar flex items-center border-b px-3 shrink-0 min-w-0"
      :class="{ 'project-management-panel-titleless': !showTitle }"
    >
      <div v-if="showTitle" class="project-title-group flex items-center gap-2 pr-3 mr-2 shrink-0 min-w-0">
        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate max-w-40 tracking-tight">
          {{ activeProject?.name }}
        </h3>
      </div>
      <button v-show="canScrollLeft" @click="scrollTabs('left')" class="toolbar-scroll-btn shrink-0" :title="t('dashboard.scrollTabsLeft')">
        <div class="i-mdi-chevron-left text-base" />
      </button>
      <div ref="tabScrollContainer" @scroll="checkTabOverflow" class="flex items-center overflow-x-auto scrollbar-none min-w-0 flex-1 py-2 px-1">
        <div class="workspace-tab-group">
          <button
            v-if="hasRunnableCommands"
            @click="selectTab('console')"
            class="workspace-tab-btn"
            :class="{ 'workspace-tab-btn-active': activeTab === 'console' }"
            :disabled="leafTabsDisabled"
          >
            <div class="i-mdi-console text-sm" />
            <span>{{ t('dashboard.console') }}</span>
          </button>
          <button
            v-if="hasGitRepo"
            @click="selectTab('git')"
            class="workspace-tab-btn"
            :class="{ 'workspace-tab-btn-active': activeTab === 'git' }"
            :disabled="leafTabsDisabled"
          >
            <div class="i-mdi-git text-sm" />
            <span>{{ t('git.title') }}</span>
            <span v-if="hasGitRepo && gitChangesCount > 0" class="workspace-tab-badge">{{ gitChangesCount }}</span>
          </button>
          <button
            v-if="editorEnabled"
            @click="selectTab('editor')"
            class="workspace-tab-btn"
            :class="{ 'workspace-tab-btn-active': activeTab === 'editor' }"
            :disabled="leafTabsDisabled"
          >
            <div class="i-mdi-file-edit-outline text-sm" />
            <span>{{ t('dashboard.editor') }}</span>
          </button>
          <button
            v-if="hasFrontendEnv"
            @click="selectTab('env')"
            class="workspace-tab-btn"
            :class="{ 'workspace-tab-btn-active': activeTab === 'env' }"
            :disabled="leafTabsDisabled"
          >
            <div class="i-mdi-tune-variant text-sm" />
            <span>{{ t('dashboard.envSwitcher') }}</span>
          </button>
          <button @click="selectTab('files')" class="workspace-tab-btn" :class="{ 'workspace-tab-btn-active': activeTab === 'files' }">
            <div class="i-mdi-folder-outline text-sm" />
            <span>{{ t('dashboard.files') }}</span>
          </button>
          <button @click="selectTab('memo')" class="workspace-tab-btn" :class="{ 'workspace-tab-btn-active': activeTab === 'memo' }">
            <div class="i-mdi-note-text-outline text-sm" />
            <span>{{ t('dashboard.memo') }}</span>
          </button>
        </div>
      </div>
      <button v-show="canScrollRight" @click="scrollTabs('right')" class="toolbar-scroll-btn shrink-0" :title="t('dashboard.scrollTabsRight')">
        <div class="i-mdi-chevron-right text-base" />
      </button>
    </div>

    <div class="flex-1 min-w-0 overflow-hidden relative">
      <div
        v-if="!activeProject"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center app-workspace-panel text-slate-400 dark:text-slate-500"
      >
        <div class="i-mdi-gesture-tap text-5xl mb-3 opacity-20" />
        <p class="text-sm">{{ t('dashboard.selectSubProjectHint') }}</p>
      </div>
      <Transition name="tab-fade" mode="out-in">
        <KeepAlive :max="KEEP_ALIVE_MAX">
          <ConsoleView
            v-if="activeTab === 'console' && activeProject"
            :key="`console:${activeProject.id}`"
            :project="activeProject"
          />
          <GitView
            v-else-if="activeTab === 'git' && activeProject && hasGitRepo"
            :key="`git:${activeProject.id}`"
            :project="activeProject"
          />
          <WorkspaceEditor
            v-else-if="activeTab === 'editor' && activeProject && editorEnabled"
            :key="`editor:${activeProject.id}`"
            :project="activeProject"
          />
          <FrontendEnvPanel
            v-else-if="activeTab === 'env' && activeProject"
            :key="`env:${activeProject.id}`"
            :project="activeProject"
          />
          <FileManager
            v-else-if="activeTab === 'files' && activeProject"
            :key="`files:${activeProject.id}`"
            :project="activeProject"
          />
          <ProjectMemo
            v-else-if="activeTab === 'memo' && activeProject"
            :key="`memo:${activeProject.id}`"
            :project="activeProject"
          />
        </KeepAlive>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity var(--app-duration-base) var(--app-ease);
}
.tab-fade-enter-from,
.tab-fade-leave-to {
  opacity: 0;
}
.workspace-topbar {
  box-shadow: inset 0 -1px 0 var(--app-border);
}
.project-management-panel-titleless {
  padding-left: 20px;
  padding-right: 20px;
}
.project-management-panel {
  flex: 1 1 0%;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
}
.project-title-group {
  padding: 3px 6px 3px 3px;
  border-radius: var(--app-radius-lg);
}
.toolbar-scroll-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border: none;
  border-radius: var(--app-radius-md);
  background: var(--app-surface-soft);
  color: var(--app-text-secondary);
  box-shadow: inset 0 0 0 1px var(--app-border);
  transition: background-color var(--app-duration-fast) var(--app-ease), color var(--app-duration-fast) var(--app-ease);
}
.toolbar-scroll-btn:hover {
  color: var(--app-primary);
  background: var(--app-primary-soft);
}
.workspace-tab-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-soft);
  box-shadow: inset 0 0 0 1px var(--app-border);
}
.workspace-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  font-weight: 600;
  white-space: nowrap;
  transition: background-color var(--app-duration-fast) var(--app-ease), color var(--app-duration-fast) var(--app-ease);
}
.workspace-tab-btn:hover:not(:disabled) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 74%, transparent);
}
.workspace-tab-btn:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}
.workspace-tab-btn-active {
  background: var(--app-surface);
  color: var(--app-primary);
  box-shadow: var(--app-shadow-sm), inset 0 0 0 1px color-mix(in srgb, var(--app-primary) 26%, transparent);
}
.workspace-tab-badge {
  margin-left: 2px;
  min-width: 18px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--app-warning) 14%, transparent);
  padding: 0 6px;
  color: var(--app-warning);
  font-size: var(--app-font-caption);
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
</style>
