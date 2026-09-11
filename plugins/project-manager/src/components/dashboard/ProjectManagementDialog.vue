<script setup lang="ts">
/***********************快速管理弹窗*********************/
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Project, WorkspaceTab } from '../../types';
import type { ProjectGitOverview } from '../../utils/projectGitOverview';
import ProjectManagementPanel from './ProjectManagementPanel.vue';
import ProjectSwitcherPopover from './ProjectSwitcherPopover.vue';
import { useProjectExternalActions } from '../../composables/useProjectExternalActions';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  project: Project | null;
  projects: readonly Project[];
  gitOverviewById?: Readonly<Record<string, ProjectGitOverview | undefined>>;
  runningCountByProjectId?: Readonly<Record<string, number>>;
  initialTab?: WorkspaceTab | null;
}>(), {
  initialTab: null,
  gitOverviewById: undefined,
  runningCountByProjectId: undefined,
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'select-project', project: Project): void;
  (event: 'open-workspace', project: Project): void;
  (event: 'edit', project: Project): void;
}>();

const { t } = useI18n();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});
const managementPanel = useTemplateRef<InstanceType<typeof ProjectManagementPanel>>('managementPanel');
const { openEditor, openTerminal, openFolder } = useProjectExternalActions(() => props.project);
const switcherVisible = ref(false);

/***********************弹窗尺寸*********************/
/**
 * 通过组件样式直接约束 Element Plus 的 dialog 本体，避免仅依赖 scoped deep
 * 选择器时被组件默认布局覆盖，导致弹窗按内容高度收缩。
 */
const dialogStyle = {
  height: 'min(80vh, calc(100vh - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  minHeight: '0',
};

/***********************打开状态同步*********************/
function activatePanel(): void {
  void nextTick(() => managementPanel.value?.activate(props.initialTab));
}

watch(() => props.modelValue, (opened) => {
  if (opened) activatePanel();
});

watch(() => props.project?.id, () => {
  switcherVisible.value = false;
});

watch(() => props.initialTab, () => {
  if (props.modelValue) activatePanel();
});

function openWorkspace(): void {
  if (!props.project) return;
  emit('open-workspace', props.project);
  visible.value = false;
}

function selectProject(project: Project): void {
  switcherVisible.value = false;
  emit('select-project', project);
}

function editProject(): void {
  if (!props.project) return;
  emit('edit', props.project);
  visible.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="project-management-dialog"
    width="min(80vw, calc(100vw - 32px))"
    :style="dialogStyle"
    align-center
    :close-on-press-escape="true"
    :destroy-on-close="false"
    append-to-body
  >
    <template #header>
      <div class="project-management-dialog-header">
        <div class="project-management-dialog-heading min-w-0">
          <el-popover
            v-model:visible="switcherVisible"
            placement="bottom-start"
            :width="360"
            :teleported="false"
            :disabled="!project"
            popper-class="project-switcher-popper"
          >
            <ProjectSwitcherPopover
              :projects="projects"
              :current-project-id="project?.id"
              :git-overview-by-id="gitOverviewById"
              :running-count-by-project-id="runningCountByProjectId"
              @select="selectProject"
            />
            <template #reference>
              <button
                type="button"
                class="project-management-dialog-title"
                :title="project?.name"
                :disabled="!project"
                @click.stop
              >
                <span class="truncate">{{ project?.name }}</span>
                <div class="i-mdi-chevron-down text-sm shrink-0" aria-hidden="true" />
              </button>
            </template>
          </el-popover>
          <div class="project-management-dialog-path truncate">{{ project?.path }}</div>
        </div>
        <div class="project-management-dialog-actions" @click.stop>
          <button type="button" class="project-management-dialog-action" :title="t('dashboard.openInEditor')" @click.stop="openEditor">
            <div class="i-mdi-code-tags text-sm" />
            <span>{{ t('dashboard.openInEditor') }}</span>
          </button>
          <button type="button" class="project-management-dialog-action" :title="t('dashboard.openInTerminal')" @click.stop="openTerminal">
            <div class="i-mdi-console-line text-sm" />
            <span>{{ t('dashboard.openInTerminal') }}</span>
          </button>
          <button type="button" class="project-management-dialog-action" :title="t('dashboard.openInExplorer')" @click.stop="openFolder">
            <div class="i-mdi-folder-open text-sm" />
            <span>{{ t('dashboard.openInExplorer') }}</span>
          </button>
          <button type="button" class="project-management-dialog-action" :title="t('project.editProject')" @click.stop="editProject">
            <div class="i-mdi-pencil text-sm" />
            <span>{{ t('project.editProject') }}</span>
          </button>
          <button
            type="button"
            class="project-management-dialog-action project-management-dialog-workspace"
            :title="t('dashboard.openFullWorkspace')"
            @click.stop="openWorkspace"
          >
            <div class="i-mdi-open-in-new text-sm" />
            <span>{{ t('dashboard.openFullWorkspace') }}</span>
          </button>
        </div>
      </div>
    </template>

    <div class="project-management-dialog-body">
      <ProjectManagementPanel
        v-if="project"
        ref="managementPanel"
        :project="project"
        :initial-tab="initialTab"
        :show-title="false"
        :editor-enabled="false"
      />
    </div>
  </el-dialog>
</template>

<style scoped>
.project-management-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  width: 100%;
}
.project-management-dialog-heading {
  flex: 1 1 auto;
  min-width: 0;
}
.project-management-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex: 0 1 auto;
  min-width: 0;
  flex-wrap: wrap;
}
.project-management-dialog-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 6px;
  border: none;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text);
  font-size: var(--app-font-subheading);
  font-weight: 700;
  text-align: left;
}
.project-management-dialog-title:hover:not(:disabled) {
  background: var(--app-primary-soft);
  color: var(--app-primary);
}
.project-management-dialog-title:disabled {
  cursor: default;
}
.project-management-dialog-path {
  margin-top: 2px;
  color: var(--app-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: var(--app-font-meta);
}
.project-management-dialog-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-surface-soft);
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  font-weight: 600;
  cursor: pointer;
}
.project-management-dialog-action:hover {
  border-color: color-mix(in srgb, var(--app-primary) 40%, transparent);
  color: var(--app-primary);
}
.project-management-dialog-body {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.project-management-dialog-body > .project-management-panel {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
@media (max-width: 800px) {
  .project-management-dialog-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .project-management-dialog-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .project-management-dialog-action span {
    max-width: 16vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>

<!-- append-to-body 后弹层挂到 body，Element Plus 外层样式需使用非 scoped 选择器命中 -->
<style>
.project-management-dialog.el-dialog {
  display: flex;
  flex-direction: column;
  width: min(80vw, calc(100vw - 32px));
  height: min(80vh, calc(100vh - 32px));
  min-height: 0;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: hidden;
}

.project-management-dialog .el-dialog__header {
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  margin-right: 0;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--app-border);
}

.project-management-dialog .el-dialog__body {
  display: flex;
  flex: 1 1 0%;
  flex-direction: column;
  height: auto;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
}

.project-switcher-popper {
  max-width: calc(100vw - 48px) !important;
  box-sizing: border-box;
}
</style>
