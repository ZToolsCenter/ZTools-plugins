// storage.ts
import localforage from "localforage";

// 初始化 localforage
localforage.config({
  name: "json-tools",
  storeName: "store",
});

export const storage = {
  setItem: async <T>(key: string, value: T): Promise<T> => {
    try {
      await localforage.setItem(key, value);

      return value;
    } catch (error) {
      console.error("Error setting item:", error);
      throw error;
    }
  },

  getItem: async <T>(key: string): Promise<T | null> => {
    try {
      const value = await localforage.getItem<T>(key);

      return value;
    } catch (error) {
      console.error("Error getting item:", error);
      throw error;
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      await localforage.removeItem(key);
    } catch (error) {
      console.error("Error removing item:", error);
      throw error;
    }
  },

  clear: async (): Promise<void> => {
    try {
      await localforage.clear();
    } catch (error) {
      console.error("Error clearing storage:", error);
      throw error;
    }
  },

  keys: async (): Promise<string[]> => {
    try {
      return await localforage.keys();
    } catch (error) {
      console.error("Error getting keys:", error);
      throw error;
    }
  },
};
