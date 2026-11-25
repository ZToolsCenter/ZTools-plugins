import { StorageData } from '../types';
import { loadData, saveData, migrateData } from './storageUtils';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    version: '1.0.0',
    workspaces: { work: [], life: [], study: [] },
    currentWorkspace: 'work',
    workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
    viewMode: 'week',
    layoutMode: 'split',
    taskViewMode: 'tag',
    currentDate: '2024-01-15',
    ...overrides,
  };
}

function installZtoolsStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));

  (window as any).ztools = {
    dbStorage: {
      getItem: jest.fn((key: string) => (store.has(key) ? store.get(key) : null)),
      setItem: jest.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn((key: string) => {
        store.delete(key);
      }),
    },
  };

  return store;
}

describe('storageUtils', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).ztools;
  });

  afterEach(() => {
    delete (window as any).ztools;
    localStorage.clear();
  });

  describe('loadData', () => {
    it('should return null when no data exists', () => {
      expect(loadData()).toBeNull();
    });

    it('should load valid data from localStorage', () => {
      const data: StorageData = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [] },
        currentWorkspace: 'work',
        workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
        viewMode: 'week',
        layoutMode: 'split',
        taskViewMode: 'tag',
        currentDate: '2024-01-15',
      };
      localStorage.setItem('todos-data', JSON.stringify(data));

      const loaded = loadData();
      expect(loaded).toEqual(data);
    });

    it('should return null for invalid JSON', () => {
      localStorage.setItem('todos-data', 'invalid json');
      expect(loadData()).toBeNull();
    });
  });

  describe('saveData', () => {
    it('should save data to localStorage', () => {
      const data: StorageData = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [] },
        currentWorkspace: 'work',
        workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
        viewMode: 'week',
        layoutMode: 'split',
        taskViewMode: 'tag',
        currentDate: '2024-01-15',
      };

      saveData(data);
      const saved = JSON.parse(localStorage.getItem('todos-data') || '{}');
      expect(saved).toEqual(data);
    });
  });

  describe('ZTools dbStorage', () => {
    it('should save and load data from dbStorage', () => {
      const store = installZtoolsStorage();
      const data = createStorageData();

      saveData(data);

      expect(store.get('todos-data')).toBe(JSON.stringify(data));
      expect(localStorage.getItem('todos-data')).toBeNull();
      expect(loadData()).toEqual(data);
    });

    it('should keep the previous snapshot as backup', () => {
      const previous = createStorageData({ currentDate: '2024-01-01' });
      const next = createStorageData({ currentDate: '2024-02-02' });
      const store = installZtoolsStorage({
        'todos-data': JSON.stringify(previous),
      });

      saveData(next);

      expect(store.get('todos-data')).toBe(JSON.stringify(next));
      expect(store.get('todos-data-backup')).toBe(JSON.stringify(previous));
    });

    it('should restore the backup when the primary snapshot is corrupt', () => {
      const backup = createStorageData({ currentDate: '2024-03-03' });
      const store = installZtoolsStorage({
        'todos-data': 'invalid json',
        'todos-data-backup': JSON.stringify(backup),
      });

      expect(loadData()).toEqual(backup);
      expect(store.get('todos-data')).toBe(JSON.stringify(backup));
    });

    it('should migrate legacy localStorage data into dbStorage', () => {
      const legacy = createStorageData({ currentDate: '2024-04-04' });
      localStorage.setItem('todos-data', JSON.stringify(legacy));
      const store = installZtoolsStorage();

      expect(loadData()).toEqual(legacy);
      expect(store.get('todos-data')).toBe(JSON.stringify(legacy));
      expect(store.get('todos-data-backup')).toBe(JSON.stringify(legacy));
      expect(localStorage.getItem('todos-data')).toBeNull();
    });

    it('should migrate legacy workspace configs into a snapshot', () => {
      const customConfigs = [
        ...DEFAULT_WORKSPACE_CONFIGS,
        { id: 'workspace-123', name: '新组', colorScheme: 'teal', order: 3 },
      ];
      const store = installZtoolsStorage({
        'workspace-configs': JSON.stringify(customConfigs),
      });

      const loaded = loadData();

      expect(loaded?.workspaceConfigs).toEqual(customConfigs);
      expect(loaded?.workspaces['workspace-123']).toEqual([]);
      expect(store.get('todos-data')).toBeTruthy();
      expect(store.has('workspace-configs')).toBe(false);
    });

    it('should keep layout preferences across an app restart', () => {
      installZtoolsStorage();

      saveData(createStorageData({ layoutMode: 'pool-only', taskViewMode: 'block' }));

      // 模拟重启：重新读取快照
      const reloaded = loadData();
      expect(reloaded?.layoutMode).toBe('pool-only');
      expect(reloaded?.taskViewMode).toBe('block');
    });

    it('should keep a separate namespace for dev data', () => {
      const production = createStorageData({ currentDate: '2024-01-01' });
      const dev = createStorageData({ currentDate: '2024-05-05' });
      const store = installZtoolsStorage({
        'todos-data': JSON.stringify(production),
      });

      saveData(dev, 'todos-data-dev');

      expect(store.get('todos-data-dev')).toBe(JSON.stringify(dev));
      expect(store.get('todos-data')).toBe(JSON.stringify(production));
      expect(loadData('todos-data-dev')).toEqual(dev);
      expect(loadData()).toEqual(production);
    });

    it('should not migrate production legacy data into a dev namespace', () => {
      const production = createStorageData();
      localStorage.setItem('todos-data', JSON.stringify(production));
      installZtoolsStorage();

      expect(loadData('todos-data-dev')).toBeNull();
      expect(localStorage.getItem('todos-data')).toBe(JSON.stringify(production));
    });

    it('should remove legacy config storage when the snapshot already has configs', () => {
      const data = createStorageData();
      const store = installZtoolsStorage({
        'todos-data': JSON.stringify(data),
        'workspace-configs': JSON.stringify(DEFAULT_WORKSPACE_CONFIGS),
      });

      expect(loadData()).toEqual(data);
      expect(store.has('workspace-configs')).toBe(false);
    });
  });

  describe('migrateData', () => {
    it('should return default data for null input', () => {
      const result = migrateData(null);
      expect(result.version).toBe('1.0.0');
      expect(result.workspaces).toEqual({ work: [], life: [], study: [] });
      expect(result.currentWorkspace).toBe('work');
      expect(result.viewMode).toBe('week');
    });

    it('should return default data for invalid input', () => {
      const result = migrateData('invalid');
      expect(result.version).toBe('1.0.0');
    });

    it('should migrate data with missing fields', () => {
      const oldData = {
        workspaces: { work: [{ id: '1', title: 'Test' }] },
      };
      const result = migrateData(oldData);
      expect(result.version).toBe('1.0.0');
      expect(result.workspaces.work).toHaveLength(1);
    });

    it('should preserve valid data', () => {
      const data: StorageData = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [] },
        currentWorkspace: 'life',
        workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
        viewMode: 'month',
        layoutMode: 'pool-only',
        taskViewMode: 'block',
        currentDate: '2024-06-01',
      };
      const result = migrateData(data);
      expect(result).toEqual(data);
    });

    it('should handle invalid workspace values', () => {
      const data = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [] },
        currentWorkspace: 'invalid',
        workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
        viewMode: 'week',
        currentDate: '2024-01-01',
      };
      const result = migrateData(data);
      expect(result.currentWorkspace).toBe('work');
    });

    it('should preserve custom workspace ids on load', () => {
      const data = {
        version: '1.0.0',
        workspaces: {
          work: [],
          life: [],
          study: [],
          'workspace-123': [{ id: '1', title: 'Custom Group Task' }],
        },
        currentWorkspace: 'workspace-123',
        workspaceConfigs: [
          ...DEFAULT_WORKSPACE_CONFIGS,
          { id: 'workspace-123', name: '新组', colorScheme: 'teal', order: 3 },
        ],
        viewMode: 'week',
        currentDate: '2024-01-01',
      };

      const result = migrateData(data);
      expect(result.workspaces['workspace-123']).toHaveLength(1);
      expect(result.currentWorkspace).toBe('workspace-123');
    });

    it('should keep currentWorkspace when it matches a custom config', () => {
      const data = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [], 'workspace-123': [] },
        currentWorkspace: 'workspace-123',
        workspaceConfigs: [
          ...DEFAULT_WORKSPACE_CONFIGS,
          { id: 'workspace-123', name: '新组', colorScheme: 'teal', order: 3 },
        ],
        viewMode: 'week',
        currentDate: '2024-01-01',
      };

      const result = migrateData(data);
      expect(result.currentWorkspace).toBe('workspace-123');
      expect(result.workspaces['workspace-123']).toEqual([]);
    });

    it('should handle invalid viewMode values', () => {
      const data = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [] },
        currentWorkspace: 'work',
        workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
        viewMode: 'invalid',
        currentDate: '2024-01-01',
      };
      const result = migrateData(data);
      expect(result.viewMode).toBe('week');
    });

    it('should default layout preferences for snapshots saved before they were persisted', () => {
      const legacy = {
        version: '1.0.0',
        workspaces: { work: [], life: [], study: [] },
        currentWorkspace: 'work',
        workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
        viewMode: 'week',
        currentDate: '2024-01-01',
      };
      const result = migrateData(legacy);
      expect(result.layoutMode).toBe('split');
      expect(result.taskViewMode).toBe('tag');
    });

    it('should fall back to defaults for invalid layout values', () => {
      const data = {
        ...createStorageData(),
        layoutMode: 'three-columns',
        taskViewMode: 'huge',
      } as any;
      const result = migrateData(data);
      expect(result.layoutMode).toBe('split');
      expect(result.taskViewMode).toBe('tag');
    });

    it('should keep pool-only layout and block task view', () => {
      const result = migrateData(
        createStorageData({ layoutMode: 'pool-only', taskViewMode: 'block' })
      );
      expect(result.layoutMode).toBe('pool-only');
      expect(result.taskViewMode).toBe('block');
    });
  });
});
