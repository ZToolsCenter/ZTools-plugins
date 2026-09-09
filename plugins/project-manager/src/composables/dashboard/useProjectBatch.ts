import { computed } from 'vue';
import { useProjectStore } from '../../stores/project';
import { useWorkspaceEditorStore } from '../../stores/workspaceEditor';
import { api } from '../../api';
import type { Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { normalizeProjectGroupId } from '../../utils/dashboardProfiles';

/**
 * 批量操作 composable：进入多选状态后可批量设置分组、添加/移除标签、
 * 置顶/取消置顶、刷新、打开文件夹、删除。
 * 不影响普通点击选中项目的行为。
 */
export function useProjectBatch(options: {
  filteredProjectIds: Ref<string[]>;
}) {
  const projectStore = useProjectStore();
  const editorStore = useWorkspaceEditorStore();
  const { t } = useI18n();

  /** 批量模式开关 */
  const batchMode = computed(() => projectStore.batchMode);
  const selectedIds = computed(() => projectStore.selectedIds);

  /** 选中数量 */
  const selectedCount = computed(() => projectStore.selectedIds.size);

  /** 是否全选了当前可见项目 */
  const isAllSelected = computed(() => {
    const visible = options.filteredProjectIds.value;
    return visible.length > 0 && visible.every((id) => projectStore.selectedIds.has(id));
  });

  /** 进入批量模式 */
  function enterBatchMode(initialIds: string[] = []) {
    projectStore.enterBatchMode(initialIds);
  }

  /** 退出批量模式 */
  function exitBatchMode() {
    projectStore.exitBatchMode();
  }

  /** 切换项目选中状态 */
  function toggleSelect(id: string) {
    projectStore.toggleSelect(id);
  }

  /** 全选 / 取消全选 */
  function toggleSelectAll() {
    if (isAllSelected.value) {
      projectStore.clearSelection();
    } else {
      projectStore.selectAllVisible(options.filteredProjectIds.value);
    }
  }

  /** 清空选择 */
  function clearSelection() {
    projectStore.clearSelection();
  }

  /***********************批量操作*********************/

  /** 批量设置分组 */
  async function batchSetGroup(groupId: string | undefined) {
    const ids = [...projectStore.selectedIds];
    await projectStore.batchUpdate(ids, {
      groupId: normalizeProjectGroupId(groupId),
    });
    ElMessage.success(t('dashboard.batchGroupApplied', { count: ids.length }));
  }

  /** 批量添加单条标签 */
  async function batchAddTag(tag: string) {
    const ids = [...projectStore.selectedIds];
    await projectStore.batchSetTags(ids, [tag], true);
    ElMessage.success(t('dashboard.batchTagAdded', { count: ids.length }));
  }

  /** 批量移除单条标签 */
  async function batchRemoveTag(tag: string) {
    const ids = [...projectStore.selectedIds];
    await projectStore.batchSetTags(ids, [tag], false);
    ElMessage.success(t('dashboard.batchTagRemoved', { count: ids.length }));
  }

  /** 批量置顶 */
  async function batchPin() {
    const ids = [...projectStore.selectedIds];
    for (const id of ids) {
      projectStore.pinProject(id);
    }
    ElMessage.success(t('dashboard.batchPinApplied', { count: ids.length }));
  }

  /** 批量取消置顶 */
  async function batchUnpin() {
    const ids = [...projectStore.selectedIds];
    for (const id of ids) {
      projectStore.unpinProject(id);
    }
    ElMessage.success(t('dashboard.batchUnpinApplied', { count: ids.length }));
  }

  /** 批量刷新项目信息 */
  async function batchRefresh() {
    const ids = [...projectStore.selectedIds];
    const targets = projectStore.projects.filter((p) => ids.includes(p.id));
    // 复用 projectStore.refreshAll 逻辑，但只刷新选中的
    const updates = await Promise.all(
      targets.map(async (p) => {
        try {
          const info: any = await api.scanProject(p.path);
          if (p.type === 'node') {
            return { ...p, scripts: info.scripts || [] };
          }
          return p;
        } catch (e) {
          console.error(`Failed to refresh project ${p.name}`, e);
          return p;
        }
      })
    );
    for (const updated of updates) {
      projectStore.updateProject(updated);
    }
    ElMessage.success(t('dashboard.batchRefreshDone', { count: ids.length }));
  }

  /** 批量打开文件夹 */
  async function batchOpenFolder() {
    const ids = [...projectStore.selectedIds];
    const targets = projectStore.projects.filter((p) => ids.includes(p.id));
    for (const p of targets) {
      try {
        await api.openFolder(p.path);
      } catch (e) {
        console.error(`Failed to open folder for ${p.name}`, e);
      }
    }
  }

  /** 批量删除（带二次确认） */
  async function batchRemove() {
    const ids = [...projectStore.selectedIds];
    const count = ids.length;
    try {
      await ElMessageBox.confirm(
        `${t('dashboard.batchRemoveConfirm', { count })}${editorStore.hasDirtyDocuments(ids)
          ? '\n\n所选项目有未保存的编辑器内容，删除后这些文档会关闭。'
          : ''}`,
        t('dashboard.batchRemoveTitle'),
        { confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel'), type: 'warning' }
      );
      await projectStore.batchRemove(ids);
      projectStore.exitBatchMode();
      ElMessage.success(t('dashboard.batchRemoveDone', { count }));
    } catch (_) {
      // 用户取消
    }
  }

  return {
    batchMode,
    selectedIds,
    selectedCount,
    isAllSelected,
    enterBatchMode,
    exitBatchMode,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    batchSetGroup,
    batchAddTag,
    batchRemoveTag,
    batchPin,
    batchUnpin,
    batchRefresh,
    batchOpenFolder,
    batchRemove,
  };
}
