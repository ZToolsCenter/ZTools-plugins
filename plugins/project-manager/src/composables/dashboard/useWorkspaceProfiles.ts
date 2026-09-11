import { computed } from 'vue';
import { useWorkspaceProfileStore } from '../../stores/workspaceProfile';
import { useProjectStore } from '../../stores/project';
import { useUsageStore } from '../../stores/usage';
import type { WorkspaceProfile, WorkspaceProfileItem } from '../../types';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';

/**
 * 启动组 composable：聚合启动组 CRUD、运行/停止动作和最近使用数据，
 * 供 WorkspaceOverview 和 WorkspaceProfileMenu 统一调用。
 */
export function useWorkspaceProfiles() {
  const profileStore = useWorkspaceProfileStore();
  const projectStore = useProjectStore();
  const usageStore = useUsageStore();
  const { t } = useI18n();

  /** 所有启动组 */
  const profiles = computed(() => profileStore.profiles);

  /** 最近使用的项目（按使用权重排序，取 Top N） */
  function getRecentProjects(limit = 5) {
    const weights = usageStore.calculateAllWeights();
    return [...projectStore.projects]
      .filter((p) => (weights[p.id] ?? 0) > 0)
      .sort((a, b) => (weights[b.id] ?? 0) - (weights[a.id] ?? 0))
      .slice(0, limit);
  }

  /** 创建新的启动组 */
  function createProfile(name: string, items: WorkspaceProfileItem[] = []): WorkspaceProfile {
    const profile = profileStore.createProfile(name, items);
    ElMessage.success(t('dashboard.profileCreated', { name }));
    return profile;
  }

  /** 删除启动组（带确认） */
  async function deleteProfile(id: string) {
    profileStore.deleteProfile(id);
    ElMessage.success(t('dashboard.profileDeleted'));
  }

  /** 向启动组添加命令 */
  function addItem(profileId: string, item: WorkspaceProfileItem) {
    profileStore.addItem(profileId, item);
  }

  /** 从启动组移除命令 */
  function removeItem(profileId: string, index: number) {
    profileStore.removeItem(profileId, index);
  }

  /** 一键运行启动组 */
  async function runProfile(profile: WorkspaceProfile) {
    const result = await profileStore.runProfile(profile);
    if (result.launched > 0) {
      ElMessage.success(
        t('dashboard.profileRunResult', {
          launched: result.launched,
          skipped: result.skipped,
        })
      );
    } else {
      ElMessage.info(t('dashboard.profileAllSkipped'));
    }
  }

  /** 停止启动组中所有命令 */
  async function stopAll(profile: WorkspaceProfile) {
    const result = await profileStore.stopAll(profile);
    if (result.stopped > 0) {
      ElMessage.success(
        t('dashboard.profileStopResult', {
          stopped: result.stopped,
        })
      );
    } else {
      ElMessage.info(t('dashboard.profileNoneRunning'));
    }
  }

  /** 检查是否有任何命令正在运行 */
  function isAnyRunning(profile: WorkspaceProfile): boolean {
    return profileStore.isAnyRunning(profile);
  }

  /** 获取启动组运行中的命令数 */
  function runningCount(profile: WorkspaceProfile): number {
    return profileStore.runningCount(profile);
  }

  return {
    profiles,
    getRecentProjects,
    createProfile,
    deleteProfile,
    addItem,
    removeItem,
    runProfile,
    stopAll,
    isAnyRunning,
    runningCount,
  };
}
