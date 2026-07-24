// useSidebarStore.ts

import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";

import { storage } from "@/lib/indexedDBStore";
import { SidebarKeys } from "@/components/sidebar/Items.tsx";

interface SidebarStore {
  activeKey: SidebarKeys;
  clickSwitchKey: SidebarKeys;
  updateActiveKey: (key: SidebarKeys) => void;
  updateClickSwitchKey: (key: SidebarKeys) => void;
  syncSidebarStore: () => Promise<void>;
  switchActiveKey: () => void;
}

const BD_SIDEBAR_ACTIVE_KEY = "sidebar";

export const useSidebarStore = create<SidebarStore>()(
  subscribeWithSelector(
    devtools(
      (set) => ({
        activeKey: SidebarKeys.textView,
        clickSwitchKey: SidebarKeys.textView,
        updateActiveKey: (key) => set({ activeKey: key }),
        updateClickSwitchKey: (key) => set({ clickSwitchKey: key }),
        switchActiveKey: () =>
          set((state) => ({ activeKey: state.clickSwitchKey })),
        syncSidebarStore: async () => {
          const activeKey = await storage.getItem(BD_SIDEBAR_ACTIVE_KEY);
          const data: Record<string, any> = {};

          if (activeKey) {
            data.activeKey = activeKey;
            data.clickSwitchKey = activeKey;
          }
          set(data);
        },
      }),
      {
        name: "SidebarStore",
        enabled: true,
      },
    ),
  ),
);

// 只监听 activeKey 的变化
useSidebarStore.subscribe(
  (state) => state.activeKey,
  (activeKey) => {
    // 本地存储始终启用
    storage.setItem(BD_SIDEBAR_ACTIVE_KEY, activeKey).catch((error) => {
      console.error("保存侧边栏状态失败:", error);
    });
  },
);
