import { StorageData } from '../types';
import { loadData, saveData, migrateData } from './storageUtils';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

describe('storageUtils', () => {
  beforeEach(() => {
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
        currentDate: '2024-01-15',
      };

      saveData(data);
      const saved = JSON.parse(localStorage.getItem('todos-data') || '{}');
      expect(saved).toEqual(data);
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
  });
});
