<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useProjectStore } from '../stores/project';

const { t } = useI18n();
const projectStore = useProjectStore();

const props = defineProps<{
  modelValue: boolean;
}>();
const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

/***********************新增分组*********************/
const newGroupName = ref('');
const addingGroup = ref(false);

function startAddGroup() {
  addingGroup.value = true;
  newGroupName.value = '';
}

function confirmAddGroup() {
  const name = newGroupName.value.trim();
  if (!name) {
    addingGroup.value = false;
    return;
  }
  projectStore.addProjectGroup({ name });
  addingGroup.value = false;
  newGroupName.value = '';
  ElMessage.success(t('common.success'));
}

function cancelAddGroup() {
  addingGroup.value = false;
  newGroupName.value = '';
}

/***********************重命名分组*********************/
const editingGroupId = ref<string | null>(null);
const editingGroupName = ref('');

function startRenameGroup(id: string, currentName: string) {
  editingGroupId.value = id;
  editingGroupName.value = currentName;
}

function confirmRenameGroup() {
  if (!editingGroupId.value) return;
  const name = editingGroupName.value.trim();
  if (!name) {
    editingGroupId.value = null;
    return;
  }
  projectStore.updateProjectGroup(editingGroupId.value, { name });
  editingGroupId.value = null;
  editingGroupName.value = '';
  ElMessage.success(t('common.success'));
}

function cancelRenameGroup() {
  editingGroupId.value = null;
  editingGroupName.value = '';
}

/***********************删除分组*********************/
async function handleDeleteGroup(id: string, name: string) {
  try {
    await ElMessageBox.confirm(
      t('dashboard.deleteGroupConfirm', { name }),
      t('dashboard.deleteGroup'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        customClass: 'dark-message-box',
      },
    );
    projectStore.removeProjectGroup(id);
    ElMessage.success(t('common.success'));
  } catch {
    // 用户取消
  }
}

/***********************折叠状态*********************/
function toggleCollapsed(id: string) {
  projectStore.toggleProjectGroupCollapsed(id);
}

/** 获取分组下的项目数量 */
function getGroupProjectCount(groupId: string): number {
  return projectStore.projects.filter((p) => p.groupId === groupId).length;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('dashboard.manageGroups')"
    width="480px"
    :close-on-click-modal="false"
    destroy-on-close
    align-center
    class="app-dialog"
  >
    <div class="space-y-2">
      <!-- 分组列表 -->
      <div v-if="projectStore.projectGroups.length === 0 && !addingGroup" class="text-center py-8 text-slate-400 dark:text-slate-500">
        <div class="i-mdi-folder-outline text-4xl mb-2 opacity-30 mx-auto" />
        <p class="text-sm">{{ t('dashboard.noGroups') }}</p>
      </div>

      <div
        v-for="group in projectStore.projectGroups"
        :key="group.id"
        class="flex items-center gap-2 rounded-lg border border-slate-200/80 dark:border-slate-700/50 bg-white dark:bg-slate-800/30 px-3 py-2.5 transition-colors"
      >
        <!-- 折叠/展开图标 -->
        <button
          class="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          @click="toggleCollapsed(group.id)"
          :title="group.collapsed ? '展开' : '折叠'"
        >
          <div :class="group.collapsed ? 'i-mdi-chevron-right' : 'i-mdi-chevron-down'" class="text-sm" />
        </button>

        <!-- 分组名（查看/编辑模式） -->
        <div class="flex-1 min-w-0">
          <template v-if="editingGroupId === group.id">
            <el-input
              v-model="editingGroupName"
              size="small"
              @keydown.enter="confirmRenameGroup"
              @keydown.escape="cancelRenameGroup"
              autofocus
            >
              <template #append>
                <el-button @click="confirmRenameGroup" :icon="'i-mdi-check'" />
                <el-button @click="cancelRenameGroup" :icon="'i-mdi-close'" />
              </template>
            </el-input>
          </template>
          <template v-else>
            <span class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block">
              {{ group.name }}
            </span>
            <span class="app-text-meta text-slate-400 dark:text-slate-500">
              {{ getGroupProjectCount(group.id) }} {{ t('dashboard.title').toLowerCase() }}
            </span>
          </template>
        </div>

        <!-- 操作按钮 -->
        <div v-if="editingGroupId !== group.id" class="flex items-center gap-1 flex-shrink-0">
          <button
            class="p-1 rounded text-slate-400 hover:text-blue-500 transition-colors"
            @click="startRenameGroup(group.id, group.name)"
            :title="t('dashboard.renameGroup')"
          >
            <div class="i-mdi-pencil text-xs" />
          </button>
          <button
            class="p-1 rounded text-slate-400 hover:text-red-500 transition-colors"
            @click="handleDeleteGroup(group.id, group.name)"
            :title="t('dashboard.deleteGroup')"
          >
            <div class="i-mdi-delete text-xs" />
          </button>
        </div>
      </div>

      <!-- 新增分组 -->
      <div v-if="addingGroup" class="flex items-center gap-2 rounded-lg border border-blue-200/80 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/10 px-3 py-2">
        <div class="i-mdi-folder-plus text-sm text-blue-400 flex-shrink-0" />
        <el-input
          v-model="newGroupName"
          size="small"
          class="flex-1 min-w-0"
          :placeholder="t('dashboard.groupNamePlaceholder')"
          @keydown.enter="confirmAddGroup"
          @keydown.escape="cancelAddGroup"
          autofocus
        />
        <!-- ─── 文字按钮独立布局，避免挤压 el-input append 区 ─────────────── -->
        <div class="group-add-actions">
          <el-button size="small" @click="confirmAddGroup">{{ t('common.confirm') }}</el-button>
          <el-button size="small" @click="cancelAddGroup">{{ t('common.cancel') }}</el-button>
        </div>
      </div>

      <!-- 添加按钮 -->
      <button
        v-if="!addingGroup"
        class="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-500 transition-colors text-sm"
        @click="startAddGroup"
      >
        <div class="i-mdi-plus text-sm" />
        <span>{{ t('dashboard.addGroup') }}</span>
      </button>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.group-add-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.group-add-actions :deep(.el-button) {
  min-width: 52px;
  margin-left: 0;
  padding-inline: 10px;
}
</style>
