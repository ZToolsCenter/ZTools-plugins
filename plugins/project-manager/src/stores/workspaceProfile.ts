import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useProjectStore } from './project';
import { useSettingsStore } from './settings';
import type { WorkspaceProfile, WorkspaceProfileItem } from '../types';
import { getProjectCommandRunId } from '../utils/projectCommands';

/**
 * 启动组 store：管理 WorkspaceProfile 的 CRUD 与执行逻辑。
 * 运行状态全部复用 project store 的 runningStatus，不另存状态。
 */
export const useWorkspaceProfileStore = defineStore('workspaceProfile', () => {
  const settingsStore = useSettingsStore();
  const projectStore = useProjectStore();

  /** 所有启动组配置 */
  const profiles = computed<WorkspaceProfile[]>(() => {
    return settingsStore.settings.workspaceProfiles ?? [];
  });

  /***********************CRUD*********************/

  /** 创建一个启动组 */
  function createProfile(name: string, items: WorkspaceProfileItem[] = []): WorkspaceProfile {
    const profile: WorkspaceProfile = {
      id: crypto.randomUUID(),
      name,
      items,
      createdAt: new Date().toISOString(),
    };
    if (!settingsStore.settings.workspaceProfiles) {
      settingsStore.settings.workspaceProfiles = [];
    }
    settingsStore.settings.workspaceProfiles.push(profile);
    return profile;
  }

  /** 删除启动组 */
  function deleteProfile(id: string): void {
    if (!settingsStore.settings.workspaceProfiles) return;
    settingsStore.settings.workspaceProfiles = settingsStore.settings.workspaceProfiles.filter(
      (p) => p.id !== id
    );
  }

  /** 重命名启动组 */
  function renameProfile(id: string, name: string): void {
    const profile = profiles.value.find((p) => p.id === id);
    if (profile) profile.name = name;
  }

  /** 向启动组添加一条命令 */
  function addItem(profileId: string, item: WorkspaceProfileItem): void {
    const profile = profiles.value.find((p) => p.id === profileId);
    if (profile) profile.items.push(item);
  }

  /** 从启动组中移除一条命令 */
  function removeItem(profileId: string, index: number): void {
    const profile = profiles.value.find((p) => p.id === profileId);
    if (profile && index >= 0 && index < profile.items.length) {
      profile.items.splice(index, 1);
    }
  }

  /** 替换启动组的全部命令项 */
  function setItems(profileId: string, items: WorkspaceProfileItem[]): void {
    const profile = profiles.value.find((p) => p.id === profileId);
    if (profile) profile.items = items;
  }

  /***********************执行*********************/

  /** 构建 runId（与 project store 一致） */
  function buildRunId(item: WorkspaceProfileItem): string {
    return getProjectCommandRunId(
      item.projectId,
      item.type === 'custom' ? 'custom' : 'script',
      item.nameOrCommandId,
    );
  }

  /** 一键启动整个启动组（已 running 的跳过） */
  async function runProfile(profile: WorkspaceProfile): Promise<{ launched: number; skipped: number }> {
    let launched = 0;
    let skipped = 0;

    for (const item of profile.items) {
      const project = projectStore.projects.find((p) => p.id === item.projectId);
      if (!project) {
        skipped++;
        continue;
      }

      const runId = buildRunId(item);
      if (projectStore.runningStatus[runId]) {
        skipped++;
        continue;
      }

      if (item.type === 'project') {
        await projectStore.runProject(project, item.nameOrCommandId);
      } else if (item.type === 'custom') {
        await projectStore.runCustomCommand(project, item.nameOrCommandId);
      }
      launched++;
    }
    return { launched, skipped };
  }

  /** 停止启动组中所有正在运行的命令 */
  async function stopAll(profile: WorkspaceProfile): Promise<{ stopped: number; alreadyStopped: number }> {
    let stopped = 0;
    let alreadyStopped = 0;

    for (const item of profile.items) {
      const runId = buildRunId(item);
      if (projectStore.runningStatus[runId]) {
        const project = projectStore.projects.find((p) => p.id === item.projectId);
        if (project) {
          await projectStore.stopProject(
            project,
            item.nameOrCommandId,
            item.type === 'custom' ? 'custom' : 'script',
          );
          stopped++;
        }
      } else {
        alreadyStopped++;
      }
    }
    return { stopped, alreadyStopped };
  }

  /** 检查启动组是否有任何命令正在运行 */
  function isAnyRunning(profile: WorkspaceProfile): boolean {
    return profile.items.some((item) => {
      const runId = buildRunId(item);
      return !!projectStore.runningStatus[runId];
    });
  }

  /** 获取启动组中有多少条命令正在运行 */
  function runningCount(profile: WorkspaceProfile): number {
    return profile.items.filter((item) => {
      const runId = buildRunId(item);
      return !!projectStore.runningStatus[runId];
    }).length;
  }

  return {
    profiles,
    createProfile,
    deleteProfile,
    renameProfile,
    addItem,
    removeItem,
    setItems,
    runProfile,
    stopAll,
    isAnyRunning,
    runningCount,
    buildRunId,
  };
});
