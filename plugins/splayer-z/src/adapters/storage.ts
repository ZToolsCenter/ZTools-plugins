/**
 * 存储适配层 - 将 Electron Store 适配到 ZTools LMDB
 */
export const createStorageAdapter = () => {
  if (typeof window.ztools === 'undefined') {
    console.warn('ZTools API not available, using fallback storage');
    return createFallbackStorage();
  }

  return {
    async get(key: string, defaultValue?: any) {
      try {
        const doc = await window.ztools.db.promises.get(key);
        return doc?.data ?? defaultValue;
      } catch {
        return defaultValue;
      }
    },

    async set(key: string, value: any) {
      try {
        const existing = await window.ztools.db.promises.get(key).catch(() => null);
        if (existing) {
          await window.ztools.db.promises.put({ _id: key, _rev: existing._rev, data: value });
        } else {
          await window.ztools.db.promises.put({ _id: key, data: value });
        }
      } catch (error) {
        console.error('Storage set error:', error);
      }
    },

    async delete(key: string) {
      try {
        const doc = await window.ztools.db.promises.get(key);
        if (doc) {
          await window.ztools.db.promises.remove(doc);
        }
      } catch (error) {
        console.error('Storage delete error:', error);
      }
    },

    async has(key: string) {
      try {
        const doc = await window.ztools.db.promises.get(key);
        return doc !== null;
      } catch {
        return false;
      }
    },
  };
};

// Fallback 存储 (使用 localStorage)
const createFallbackStorage = () => ({
  async get(key: string, defaultValue?: any) {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : defaultValue;
  },
  async set(key: string, value: any) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  async delete(key: string) {
    localStorage.removeItem(key);
  },
  async has(key: string) {
    return localStorage.getItem(key) !== null;
  },
});

export const setupStorageAdapter = () => {
  const adapter = createStorageAdapter();
  
  if (typeof (window as any).api === 'undefined') {
    (window as any).api = {};
  }
  
  (window as any).api.store = adapter;
  console.log('✅ Storage adapter initialized');
};

