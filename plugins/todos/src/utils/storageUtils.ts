/**
 * 本地存储工具函数
 *
 * 主数据统一存到 ZTools 的 dbStorage（单个版本化快照），
 * 浏览器 / 测试环境下自动回退到 localStorage。
 */
import { StorageData, Task, Workspace, WorkspaceConfig } from '../types';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

const STORAGE_KEY = 'todos-data';
const BACKUP_KEY = 'todos-data-backup';
const LEGACY_CONFIG_KEY = 'workspace-configs';
const CURRENT_VERSION = '1.0.0';

interface StorageApi {
  getItem<T = any>(key: string): T;
  setItem(key: string, value: any): void;
  removeItem(key: string): void;
}

function getZtoolsStorage(): StorageApi | null {
  if (typeof window === 'undefined' || !window.ztools?.dbStorage) {
    return null;
  }
  return window.ztools.dbStorage as StorageApi;
}

function readZtoolsRaw(key: string): unknown {
  const storage = getZtoolsStorage();
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeZtoolsRaw(key: string, value: string): boolean {
  const storage = getZtoolsStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLegacyConfigs(): void {
  const storage = getZtoolsStorage();
  if (storage) {
    try {
      storage.removeItem(LEGACY_CONFIG_KEY);
    } catch {
      // 忽略清理失败。
    }
  }
  try {
    localStorage.removeItem(LEGACY_CONFIG_KEY);
  } catch {
    // 忽略清理失败。
  }
}

function parseJson(raw: unknown): any | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function parseSnapshot(raw: unknown): StorageData | null {
  const value = parseJson(raw);
  if (!value || typeof value !== 'object' || !value.workspaces || typeof value.workspaces !== 'object') {
    return null;
  }
  return migrateData(value);
}

function parseWorkspaceConfigs(raw: unknown): WorkspaceConfig[] | null {
  const value = parseJson(raw);
  if (!Array.isArray(value)) {
    return null;
  }

  const configs = value.filter(
    (item): item is WorkspaceConfig =>
      !!item && typeof item === 'object' && typeof item.id === 'string'
  );

  return configs.length > 0 ? configs : null;
}

function readLegacyWorkspaceConfigs(): WorkspaceConfig[] | null {
  const fromDb = parseWorkspaceConfigs(readZtoolsRaw(LEGACY_CONFIG_KEY));
  if (fromDb) {
    return fromDb;
  }

  try {
    return parseWorkspaceConfigs(localStorage.getItem(LEGACY_CONFIG_KEY));
  } catch {
    return null;
  }
}

/**
 * 读取旧版本单独保存的工作空间配置；没有则返回默认配置。
 * 新版本配置已包含在 todos-data 快照中，此函数仅用于迁移和开发模式兜底。
 */
export function loadWorkspaceConfigs(): WorkspaceConfig[] {
  return readLegacyWorkspaceConfigs() || DEFAULT_WORKSPACE_CONFIGS;
}

/**
 * 保存旧版本工作空间配置，保留用于兼容旧数据。
 * 新版本不再主动调用，配置会随 todos-data 快照一起保存。
 */
export const saveWorkspaceConfigs = (configs: WorkspaceConfig[]): void => {
  const serialized = JSON.stringify(configs);
  if (writeZtoolsRaw(LEGACY_CONFIG_KEY, serialized)) {
    return;
  }

  try {
    localStorage.setItem(LEGACY_CONFIG_KEY, serialized);
  } catch (error) {
    console.error('Failed to save workspace configs:', error);
  }
};

/**
 * 读取应用数据快照。
 *
 * 读取顺序：
 * 1. dbStorage 主快照
 * 2. dbStorage 备份快照
 * 3. 旧版本 localStorage 快照（迁移到 dbStorage）
 * 4. 旧版本单独保存的工作空间配置（迁移成快照）
 */
export function loadData(storageKey: string = STORAGE_KEY): StorageData | null {
  const backupKey = `${storageKey}-backup`;
  const isPrimaryKey = storageKey === STORAGE_KEY;

  if (!getZtoolsStorage()) {
    return parseSnapshot(localStorage.getItem(storageKey));
  }

  const primary = parseSnapshot(readZtoolsRaw(storageKey));
  if (primary) {
    if (isPrimaryKey && primary.workspaceConfigs?.length) {
      removeLegacyConfigs();
    }
    return primary;
  }

  const backup = parseSnapshot(readZtoolsRaw(backupKey));
  if (backup) {
    writeZtoolsRaw(storageKey, JSON.stringify(backup));
    if (isPrimaryKey && backup.workspaceConfigs?.length) {
      removeLegacyConfigs();
    }
    return backup;
  }

  // 自定义 namespace（例如开发模式）不做旧版生产数据迁移。
  if (!isPrimaryKey) {
    return null;
  }

  let legacyLocal: string | null = null;
  try {
    legacyLocal = localStorage.getItem(STORAGE_KEY);
  } catch {
    legacyLocal = null;
  }

  const legacy = parseSnapshot(legacyLocal);
  if (legacy) {
    if (writeZtoolsRaw(STORAGE_KEY, JSON.stringify(legacy))) {
      writeZtoolsRaw(BACKUP_KEY, JSON.stringify(legacy));
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // 忽略清理失败。
      }
      if (legacy.workspaceConfigs?.length) {
        removeLegacyConfigs();
      }
    }
    return legacy;
  }

  const legacyConfigs = readLegacyWorkspaceConfigs();
  if (legacyConfigs) {
    const data = createDefaultData(legacyConfigs);
    writeZtoolsRaw(STORAGE_KEY, JSON.stringify(data));
    writeZtoolsRaw(BACKUP_KEY, JSON.stringify(data));
    removeLegacyConfigs();
    return data;
  }

  return null;
}

/**
 * 保存应用数据快照。
 * dbStorage 可用时写入 dbStorage，并把上一版保留为备份；不可用时回退 localStorage。
 */
export function saveData(data: StorageData, storageKey: string = STORAGE_KEY): void {
  const serialized = JSON.stringify(data);
  const backupKey = `${storageKey}-backup`;
  const storage = getZtoolsStorage();

  if (storage) {
    try {
      const previousRaw = storage.getItem(storageKey);
      const previousText = previousRaw == null
        ? null
        : typeof previousRaw === 'string'
          ? previousRaw
          : JSON.stringify(previousRaw);

      if (previousText && previousText !== serialized && parseSnapshot(previousText)) {
        try {
          storage.setItem(backupKey, previousText);
        } catch {
          // 备份失败不影响主数据写入。
        }
      }

      storage.setItem(storageKey, serialized);
      return;
    } catch {
      // dbStorage 写入失败时回退到 localStorage。
    }
  }

  try {
    localStorage.setItem(storageKey, serialized);
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

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
    layoutMode: validateLayoutMode(data.layoutMode),
    taskViewMode: validateTaskViewMode(data.taskViewMode),
    currentDate: data.currentDate || formatDateForStorage(new Date()),
  };
}

/**
 * 创建默认数据
 */
function createDefaultData(configs: WorkspaceConfig[] = loadWorkspaceConfigs()): StorageData {
  return {
    version: CURRENT_VERSION,
    workspaces: reconcileWorkspaces({}, configs),
    currentWorkspace: validateWorkspace(configs[0]?.id || 'work', configs),
    workspaceConfigs: configs,
    viewMode: 'week',
    layoutMode: 'split',
    taskViewMode: 'tag',
    currentDate: formatDateForStorage(new Date()),
  };
}

/**
 * 迁移到最新版本
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

  if (data.layoutMode) {
    migrated.layoutMode = validateLayoutMode(data.layoutMode);
  }

  if (data.taskViewMode) {
    migrated.taskViewMode = validateTaskViewMode(data.taskViewMode);
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
 */
function validateViewMode(viewMode: any): 'week' | 'month' {
  if (viewMode === 'week' || viewMode === 'month') {
    return viewMode;
  }
  return 'week';
}

/**
 * 验证布局模式值（兼容旧快照里没有该字段的情况）
 * @param layoutMode 布局模式值
 */
function validateLayoutMode(layoutMode: any): 'split' | 'pool-only' {
  if (layoutMode === 'split' || layoutMode === 'pool-only') {
    return layoutMode;
  }
  return 'split';
}

/**
 * 验证日历任务展示密度
 * @param taskViewMode 展示密度值
 */
function validateTaskViewMode(taskViewMode: any): 'tag' | 'block' {
  if (taskViewMode === 'tag' || taskViewMode === 'block') {
    return taskViewMode;
  }
  return 'tag';
}

/**
 * 格式化日期用于存储
 * @param date 日期对象
 */
function formatDateForStorage(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
