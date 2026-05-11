/**
 * 历史记录 Zustand Store
 * 管理历史记录的状态和操作
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { useTabStore } from "./useTabStore";

import { HistoryItem, HistoryStore, HistoryStats } from "@/types/history";
import { HistoryStorageManager } from "@/lib/historyStorage";

export const useHistoryStore = create<HistoryStore>()(
  devtools(
    (set, get) => ({
      histories: [],
      isLoading: false,
      stats: {
        total: 0,
        monacoCount: 0,
        vanillaCount: 0,
      },

      /**
       * 加载所有历史记录
       */
      loadHistories: async () => {
        set({ isLoading: true });
        try {
          const histories = await HistoryStorageManager.getAllHistories();
          const stats = get().calculateStats(histories);

          set({ histories, stats, isLoading: false });
        } catch (error) {
          console.error("加载历史记录失败:", error);
          set({ isLoading: false });
        }
      },

      /**
       * 添加历史记录
       */
      addHistory: async (tab) => {
        try {
          // 生成历史记录唯一 key（使用 tab.uuid 确保唯一性）
          const historyKey = `history_${Date.now()}_${tab.uuid}`;

          // 确定编辑器类型
          const type = tab.vanilla ? "vanilla" : "monaco";

          const historyItem: HistoryItem = {
            key: historyKey,
            tabUuid: tab.uuid,
            title: tab.title,
            content: tab.content,
            vanilla: tab.vanilla,
            editorSettings: tab.editorSettings,
            timestamp: Date.now(),
            type,
            createdAt: new Date().toISOString(),
            monacoVersion: tab.monacoVersion,
            vanillaVersion: tab.vanillaVersion,
          };

          // 保存到 IndexedDB
          await HistoryStorageManager.addHistory(historyItem);

          // 更新状态
          set((state) => {
            const newHistories = [historyItem, ...state.histories];
            const stats = get().calculateStats(newHistories);

            return { histories: newHistories, stats };
          });
        } catch (error) {
          console.error("添加历史记录失败:", error);
        }
      },

      /**
       * 通过 UUID 更新历史记录（用于定时同步）
       * 只有当版本号更新时才进行同步，避免不必要的 I/O 操作
       */
      updateHistoryByUuid: async (tabUuid, tab) => {
        try {
          // 查找现有的历史记录
          const existingHistory = get().histories.find(
            (h) => h.tabUuid === tabUuid,
          );

          if (!existingHistory) {
            // 如果不存在，创建新的历史记录
            await get().addHistory(tab);

            return;
          }

          // 版本号比较：只有当任一版本号大于历史记录中的版本号时才更新
          const shouldUpdate =
            tab.monacoVersion > existingHistory.monacoVersion ||
            tab.vanillaVersion > existingHistory.vanillaVersion;

          if (!shouldUpdate) {
            // 版本号未更新，跳过同步
            return;
          }

          // 确定编辑器类型
          const type = tab.vanilla ? "vanilla" : "monaco";
          const updatedHistory: HistoryItem = {
            ...existingHistory,
            title: tab.title,
            content: tab.content,
            vanilla: tab.vanilla,
            editorSettings: tab.editorSettings,
            timestamp: Date.now(),
            type,
            monacoVersion: tab.monacoVersion,
            vanillaVersion: tab.vanillaVersion,
          };

          // 更新 IndexedDB
          await HistoryStorageManager.addHistory(updatedHistory);

          // 更新状态
          set((state) => {
            const newHistories = state.histories.map((h) =>
              h.tabUuid === tabUuid ? updatedHistory : h,
            );
            const stats = get().calculateStats(newHistories);

            return { histories: newHistories, stats };
          });
        } catch (error) {
          console.error("更新历史记录失败:", error);
        }
      },

      /**
       * 删除历史记录
       */
      removeHistory: async (key) => {
        try {
          await HistoryStorageManager.removeHistory(key);
          set((state) => {
            const newHistories = state.histories.filter((h) => h.key !== key);
            const stats = get().calculateStats(newHistories);

            return { histories: newHistories, stats };
          });
        } catch (error) {
          console.error("删除历史记录失败:", error);
        }
      },

      /**
       * 清空所有历史记录
       */
      clearHistories: async () => {
        try {
          await HistoryStorageManager.clearHistories();
          set({
            histories: [],
            stats: {
              total: 0,
              monacoCount: 0,
              vanillaCount: 0,
            },
          });
        } catch (error) {
          console.error("清空历史记录失败:", error);
        }
      },

      /**
       * 恢复历史记录到新 Tab
       * 返回新创建的 tab 的 key
       */
      restoreHistory: async (historyKey) => {
        try {
          const history = get().getHistory(historyKey);

          if (!history) {
            console.error("历史记录不存在");

            return null;
          }

          // 创建新 Tab
          const tabStore = useTabStore.getState();

          // 获取当前 nextKey
          const currentNextKey = tabStore.nextKey;

          tabStore.addTab(history.title, history.content, {
            restoredFromHistory: true,
            historyKey,
          });

          // 使用 setTimeout 确保 addTab 的状态更新完成
          setTimeout(async () => {
            // 获取新创建的 tab（key 就是 currentNextKey）
            const newTab = tabStore.getTabByKey(`${currentNextKey}`);

            if (!newTab) {
              console.error("无法找到新创建的 tab");

              return;
            }

            // 如果是 vanilla 类型，恢复 vanilla 内容
            if (history.type === "vanilla" && history.vanilla) {
              tabStore.setTabVanillaContent(newTab.key, history.vanilla);
            }

            // 确保切换到新创建的 tab
            tabStore.setActiveTab(newTab.key);

            // 再等一个 tick，确保 vanilla 内容更新完成
            setTimeout(async () => {
              // 立即同步到 IndexedDB，避免被后续的同步覆盖
              const { storage } = await import("@/lib/indexedDBStore");
              const DB_TABS = "tabs";
              const DB_TAB_ACTIVE_KEY = "tabs_active_key";
              const DB_TAB_NEXT_KEY = "tabs_next_key";

              // 获取最新的状态
              const latestTabStore = useTabStore.getState();

              // 立即保存当前状态
              await storage.setItem(DB_TABS, latestTabStore.tabs);
              await storage.setItem(
                DB_TAB_ACTIVE_KEY,
                latestTabStore.activeTabKey,
              );
              await storage.setItem(DB_TAB_NEXT_KEY, latestTabStore.nextKey);

              console.log("历史记录恢复并已同步到 IndexedDB");
            }, 0);
          }, 0);

          // 返回新 tab 的 key，供调用方使用
          return `${currentNextKey}`;
        } catch (error) {
          console.error("恢复历史记录失败:", error);

          return null;
        }
      },

      /**
       * 获取指定历史记录
       */
      getHistory: (key) => {
        return get().histories.find((h) => h.key === key);
      },

      /**
       * 通过 UUID 获取历史记录
       */
      getHistoryByUuid: (tabUuid) => {
        return get().histories.find((h) => h.tabUuid === tabUuid);
      },

      /**
       * 搜索历史记录
       */
      searchHistories: (keyword) => {
        const { histories } = get();
        const lowerKeyword = keyword.toLowerCase();

        return histories.filter(
          (item) =>
            item.title.toLowerCase().includes(lowerKeyword) ||
            item.content.toLowerCase().includes(lowerKeyword),
        );
      },

      /**
       * 计算历史记录统计信息
       */
      calculateStats: (histories: HistoryItem[]): HistoryStats => {
        const monacoCount = histories.filter((h) => h.type === "monaco").length;
        const vanillaCount = histories.filter(
          (h) => h.type === "vanilla",
        ).length;

        const timestamps = histories
          .map((h) => h.timestamp)
          .sort((a, b) => a - b);

        return {
          total: histories.length,
          monacoCount,
          vanillaCount,
          oldestTimestamp: timestamps[0],
          newestTimestamp: timestamps[timestamps.length - 1],
        };
      },
    }),
    { name: "historyStore" },
  ),
);
