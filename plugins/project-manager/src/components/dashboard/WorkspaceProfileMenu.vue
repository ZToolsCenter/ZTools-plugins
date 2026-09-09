<script setup lang="ts">
/**
 * 启动组管理菜单：供用户创建、编辑、删除启动组，
 * 以及显示启动组的命令条目。
 * 放在总览面板和左侧顶部工具区。
 */
import { ref, watch } from 'vue';
import type { Project, WorkspaceProfile, WorkspaceProfileItem } from '../../types';
import { useProjectStore } from '../../stores/project';
import { useI18n } from 'vue-i18n';
import {
  decodeWorkspaceProfileSelection,
  encodeWorkspaceProfileSelection,
  WORKSPACE_PROFILE_CUSTOM_PREFIX,
  WORKSPACE_PROFILE_PROJECT_PREFIX,
} from '../../utils/dashboardProfiles';
import { getProjectCommandRunId } from '../../utils/projectCommands';

const { t } = useI18n();
const projectStore = useProjectStore();

const props = defineProps<{
  profiles: WorkspaceProfile[];
  projects: Project[];
}>();

const emit = defineEmits<{
  create: [name: string, items: WorkspaceProfileItem[]];
  delete: [id: string];
  run: [profile: WorkspaceProfile];
  stop: [profile: WorkspaceProfile];
}>();

/** 是否显示新建对话框 */
const showCreateDialog = ref(false);
const newProfileName = ref('');
const newItemProjectId = ref('');
const newItemSelection = ref('');
const newItems = ref<WorkspaceProfileItem[]>([]);

/***********************表单联动*********************/

watch(newItemProjectId, () => {
  newItemSelection.value = '';
});

/** 获取指定项目的可选脚本 */
function getProjectScripts(projectId: string): string[] {
  const project = props.projects.find((p) => p.id === projectId);
  return project?.scripts ?? [];
}

/** 获取指定项目的自定义命令 */
function getProjectCustomCommands(projectId: string): { id: string; name: string }[] {
  const project = props.projects.find((p) => p.id === projectId);
  return (project?.customCommands ?? []).map((c) => ({ id: c.id, name: c.name }));
}

/** 解析当前选择对应的展示文案 */
function getSelectionLabel(projectId: string, encodedValue: string): string {
  if (encodedValue.startsWith(WORKSPACE_PROFILE_PROJECT_PREFIX)) {
    return encodedValue.slice(WORKSPACE_PROFILE_PROJECT_PREFIX.length);
  }

  if (encodedValue.startsWith(WORKSPACE_PROFILE_CUSTOM_PREFIX)) {
    const commandId = encodedValue.slice(WORKSPACE_PROFILE_CUSTOM_PREFIX.length);
    return getProjectCustomCommands(projectId).find((item) => item.id === commandId)?.name ?? commandId;
  }

  return encodedValue;
}

/** 添加一条命令到新建列表 */
function addNewItem() {
  if (!newItemProjectId.value || !newItemSelection.value) return;

  const nextItem = decodeWorkspaceProfileSelection(
    newItemProjectId.value,
    newItemSelection.value,
  );

  if (!nextItem) return;

  newItems.value.push(nextItem);
  newItems.value[newItems.value.length - 1].label = getSelectionLabel(
    newItemProjectId.value,
    newItemSelection.value,
  );
  newItemSelection.value = '';
}

/** 移除一条新建命令 */
function removeNewItem(index: number) {
  newItems.value.splice(index, 1);
}

/** 确认创建 */
function handleCreate() {
  const name = newProfileName.value.trim();
  if (!name) return;
  emit('create', name, [...newItems.value]);
  newProfileName.value = '';
  newItems.value = [];
  showCreateDialog.value = false;
}

/** 检查启动组是否有命令正在运行 */
function isProfileRunning(profile: WorkspaceProfile): boolean {
  return profile.items.some((item) => {
    const runId = getProjectCommandRunId(
      item.projectId,
      item.type === 'custom' ? 'custom' : 'script',
      item.nameOrCommandId,
    );
    return !!projectStore.runningStatus[runId];
  });
}

/** 获取项目名称 */
function getProjectName(projectId: string): string {
  return props.projects.find((p) => p.id === projectId)?.name ?? projectId;
}
</script>

<template>
  <div class="workspace-profile-menu">
    <!-- 启动组列表 -->
    <div
      v-for="profile in profiles"
      :key="profile.id"
      class="app-text-control flex items-center gap-2 px-2 py-1.5 rounded-md group hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
    >
      <div class="i-mdi-rocket-launch-outline text-sm text-slate-400" />
      <span class="text-slate-700 dark:text-slate-300 truncate flex-1">{{ profile.name }}</span>
      <span class="app-text-meta text-slate-400">{{ profile.items.length }}</span>

      <!-- 运行状态 -->
      <div
        v-if="isProfileRunning(profile)"
        class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
      />

      <!-- 操作按钮 -->
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          class="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-500"
          :title="t('dashboard.profileRun')"
          @click="emit('run', profile)"
        >
          <div class="i-mdi-play text-xs" />
        </button>
        <button
          v-if="isProfileRunning(profile)"
          class="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-400"
          :title="t('dashboard.profileStopAll')"
          @click="emit('stop', profile)"
        >
          <div class="i-mdi-stop text-xs" />
        </button>
        <button
          class="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
          :title="t('common.delete')"
          @click="emit('delete', profile.id)"
        >
          <div class="i-mdi-delete-outline text-xs" />
        </button>
      </div>
    </div>

    <!-- 新建启动组 -->
    <button
      class="dashboard-secondary-action profile-create-button"
      @click="showCreateDialog = true"
    >
      <div class="i-mdi-plus text-sm" />
      <span>{{ t('dashboard.profileNew') }}</span>
    </button>

    <!-- 新建对话框（el-dialog） -->
    <el-dialog
      v-model="showCreateDialog"
      :title="t('dashboard.profileNew')"
      width="420px"
      append-to-body
    >
      <div class="space-y-3">
        <!-- 名称 -->
        <el-input
          v-model="newProfileName"
          :placeholder="t('dashboard.profileNamePlaceholder')"
        />

        <!-- 已添加的命令 -->
        <div v-if="newItems.length > 0" class="space-y-1">
          <div
            v-for="(item, idx) in newItems"
            :key="idx"
            class="app-text-control flex items-center gap-2 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 px-2 py-1.5 rounded"
          >
            <span class="truncate flex-1">{{ getProjectName(item.projectId) }} · {{ item.label || item.nameOrCommandId }}</span>
            <button
              class="text-slate-400 hover:text-red-400"
              @click="removeNewItem(idx)"
            >
              <div class="i-mdi-close text-xs" />
            </button>
          </div>
        </div>

        <!-- 添加命令 -->
        <div class="flex items-center gap-2">
          <el-select
            v-model="newItemProjectId"
            :placeholder="t('dashboard.profileSelectProject')"
            size="small"
            filterable
            class="flex-1"
          >
            <el-option
              v-for="p in projects"
              :key="p.id"
              :label="p.name"
              :value="p.id"
            />
          </el-select>
          <el-select
            v-model="newItemSelection"
            :placeholder="t('dashboard.profileSelectScript')"
            size="small"
            class="flex-1"
          >
            <el-option
              v-for="s in getProjectScripts(newItemProjectId)"
              :key="s"
              :label="s"
              :value="encodeWorkspaceProfileSelection('project', s)"
            />
            <el-option
              v-for="c in getProjectCustomCommands(newItemProjectId)"
              :key="'c-' + c.id"
              :label="`${c.name} (${t('dashboard.profileCustomCommand')})`"
              :value="encodeWorkspaceProfileSelection('custom', c.id)"
            />
          </el-select>
          <button
            class="profile-add-item-button"
            :disabled="!newItemProjectId || !newItemSelection"
            :title="t('dashboard.profileAddItem')"
            @click="addNewItem"
          >
            <div class="i-mdi-plus" />
          </button>
        </div>
      </div>

      <template #footer>
        <el-button @click="showCreateDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleCreate">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace-profile-menu {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.profile-create-button {
  white-space: nowrap;
}

.profile-add-item-button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--app-primary) 58%, var(--app-border));
  border-radius: var(--app-radius-sm);
  background: var(--app-primary-soft);
  color: var(--app-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-primary) 8%, transparent);
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    border-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease),
    transform var(--app-duration-fast) var(--app-ease);
}

.profile-add-item-button:hover:not(:disabled) {
  border-color: var(--app-primary);
  background: var(--app-primary);
  color: white;
  transform: translateY(-1px);
}

.profile-add-item-button:disabled {
  cursor: not-allowed;
  border-color: var(--app-border);
  background: var(--app-surface-soft);
  color: var(--app-text-muted);
  box-shadow: none;
  opacity: 0.55;
}
</style>
