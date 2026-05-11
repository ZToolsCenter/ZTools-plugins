import { create } from "zustand";

import { storage } from "@/lib/indexedDBStore";

interface DataState {
  data: any;
  setData: (newData: any) => Promise<void>;
  loadData: () => Promise<void>;
  clearData: () => Promise<void>;
}

const STORAGE_KEY = "app_data";

export const useDBStore = create<DataState>((set) => ({
  data: null,
  setData: async (newData) => {
    await storage.setItem(STORAGE_KEY, newData);
    set({ data: newData });
  },
  loadData: async () => {
    const loadedData = await storage.getItem(STORAGE_KEY);

    set({ data: loadedData });
  },
  clearData: async () => {
    await storage.removeItem(STORAGE_KEY);
    set({ data: null });
  },
}));
