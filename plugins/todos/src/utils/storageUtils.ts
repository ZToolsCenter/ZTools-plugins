/**
 * 本地存储工具函数
 */

import { StorageData, Task, Workspace, WorkspaceConfig } from '../types';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

const STORAGE_KEY = 'todos-data';
const WORKSPACE_CONFIG_KEY = 'workspace-configs';
const CURRENT_VERSION = '1.0.0';

/**
 * 从 localStorage 加载数据
 * @returns 存储的数据对象，如果不存在或解析失败则返回 null
 */
export function loadData(): StorageData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    return migrateData(data);
  } catch {
    return null;
  }
}

/**
 * 保存数据到 localStorage
 * @param data 要保存的数据对象
 */
export function saveData(data: StorageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

/**
 * 保存工作空间配置到ztools.dbStorage
 */
export const saveWorkspaceConfigs = (configs: WorkspaceConfig[]): void => {
  try {
    if (window.ztools?.dbStorage) {
      window.ztools.dbStorage.setItem(WORKSPACE_CONFIG_KEY, JSON.stringify(configs));
    }
  } catch (error) {
    console.error('Failed to save workspace configs:', error);
  }
};

/**
 * 从ztools.dbStorage加载工作空间配置
 */
export const loadWorkspaceConfigs = (): WorkspaceConfig[] => {
  try {
    if (window.ztools?.dbStorage) {
      const saved = window.ztools.dbStorage.getItem(WORKSPACE_CONFIG_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    }
  } catch (error) {
    console.error('Failed to load workspace configs:', error);
  }
  return DEFAULT_WORKSPACE_CONFIGS;
};

/**
 * 数据迁移（处理旧版本数据）
 * @param data 任意格式的数据
 * @returns 迁移后的标准 StorageData 对象
 */
export function migrateData(data: any): StorageData {
  if (!data || typeof data !== 'object') {
    return createDefaultData();
  }

  if (!data.version || data.version !== CURRENT_VERSION) {
    return migrateToLatest(data);
  }

  const workspaceConfigs = data.workspaceConfigs || loadWorkspaceConfigs();

  return {
    version: CURRENT_VERSION,
    workspaces: reconcileWorkspaces(data.workspaces, workspaceConfigs),
    currentWorkspace: validateWorkspace(data.currentWorkspace, workspaceConfigs),
    workspaceConfigs,
    viewMode: validateViewMode(data.viewMode),
    currentDate: data.currentDate || formatDateForStorage(new Date()),
  };
}

/**
 * 创建默认数据
 * @returns 默认的 StorageData 对象
 */
function createDefaultData(): StorageData {
  const workspaceConfigs = loadWorkspaceConfigs();
  return {
    version: CURRENT_VERSION,
    workspaces: reconcileWorkspaces({}, workspaceConfigs),
    currentWorkspace: validateWorkspace('work', workspaceConfigs),
    workspaceConfigs,
    viewMode: 'week',
    currentDate: formatDateForStorage(new Date()),
  };
}

/**
 * 迁移到最新版本
 * @param data 旧版本数据
 * @returns 迁移后的数据
 */
function migrateToLatest(data: any): StorageData {
  const migrated = createDefaultData();

  if (data.workspaceConfigs) {
    migrated.workspaceConfigs = data.workspaceConfigs;
  }

  if (data.workspaces && typeof data.workspaces === 'object') {
    migrated.workspaces = reconcileWorkspaces(data.workspaces, migrated.workspaceConfigs);
  }

  if (data.currentWorkspace) {
    migrated.currentWorkspace = validateWorkspace(data.currentWorkspace, migrated.workspaceConfigs);
  }

  if (data.viewMode) {
    migrated.viewMode = validateViewMode(data.viewMode);
  }

  if (data.currentDate) {
    migrated.currentDate = data.currentDate;
  }

  return migrated;
}

/**
 * 按配置对齐工作空间任务数据：每个配置都有任务数组，被删除的组不再保留
 * @param workspaces 原始工作空间数据
 * @param configs 工作空间配置列表
 * @returns 对齐后的任务数据
 */
function reconcileWorkspaces(workspaces: any, configs: WorkspaceConfig[]): Record<Workspace, Task[]> {
  const source = workspaces && typeof workspaces === 'object' ? workspaces : {};
  const result: Record<Workspace, Task[]> = {};
  for (const config of configs) {
    result[config.id] = Array.isArray(source[config.id]) ? source[config.id] : [];
  }
  return result;
}

/**
 * 验证工作空间值（支持自定义组 id）
 * @param workspace 工作空间值
 * @param configs 工作空间配置列表
 * @returns 有效的工作空间值
 */
function validateWorkspace(workspace: any, configs: WorkspaceConfig[]): Workspace {
  if (configs.some(c => c.id === workspace)) {
    return workspace;
  }
  return configs[0]?.id || 'work';
}

/**
 * 验证视图模式值
 * @param viewMode 视图模式值
 * @returns 有效的视图模式值
 */
function validateViewMode(viewMode: any): 'week' | 'month' {
  if (viewMode === 'week' || viewMode === 'month') {
    return viewMode;
  }
  return 'week';
}

/**
 * 格式化日期用于存储
 * @param date 日期对象
 * @returns YYYY-MM-DD 格式的日期字符串
 */
function formatDateForStorage(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
