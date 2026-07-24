// useTabStore.ts
import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { Content, Mode, JSONContent, TextContent } from "vanilla-jsoneditor";

import { useSettingsStore } from "./useSettingsStore";

import { StorageManager } from "@/lib/storage/StorageManager";
import { getSyncManager } from "@/lib/storage/MultiWindowSyncManager";
import { parseJson, stringifyJson } from "@/utils/json";
import { generateUUID } from "@/utils/uuid";

/**
 * Tab 历史记录项
 */
export interface TabHistoryItem {
  key: string; // 历史记录唯一标识
  timestamp: number; // 时间戳
  title: string; // 标题快照
  content: string; // 内容快照
  monacoVersion: number; // 版本号
  vanilla?: Content; // vanilla 内容快照（可选）
}

// 存储管理器实例 - 使用共享的 syncManager
const syncManager = getSyncManager();
const storageManager = new StorageManager(syncManager);

export interface TabItem {
  key: string;
  uuid: string; // Tab 的唯一标识符
  title: string;
  content: string;
  diffModifiedValue?: string; // diff 右边比较值
  monacoVersion: number; // 乐观锁
  vanilla?: Content;
  vanillaVersion: number;
  vanillaMode: Mode;
  closable?: boolean;
  history: TabHistoryItem[]; // Tab 历史记录
  editorSettings: {
    fontSize: number;
    language: string;
    indentSize: number; // 缩进大小
    timestampDecoratorsEnabled?: boolean; // 添加时间戳装饰器设置
    base64DecoratorsEnabled?: boolean; // Base64装饰器设置
    unicodeDecoratorsEnabled?: boolean; // Unicode装饰器设置
    urlDecoratorsEnabled?: boolean; // URL装饰器设置
    imageDecoratorsEnabled?: boolean; // 图片装饰器设置
  };
  extraData?: Record<string, any>;
}

interface TabStore {
  tabs: TabItem[];
  activeTabKey: string;
  nextKey: number;
  activeTab: () => TabItem;
  getTabByKey: (key: string) => TabItem | undefined;
  initTab: () => void;
  addTab: (
    title: string | undefined,
    content: string | undefined,
    extraData?: Record<string, any>,
  ) => void;
  setTabContent: (key: string, content: string) => void;
  updateTabContent: (key: string, content: string) => void;
  setTabModifiedValue: (key: string, content: string) => void;
  setTabVanillaContent: (key: string, content: Content) => void;
  setTabVanillaMode: (key: string, mode: Mode) => void;
  setMonacoVersion: (key: string, version: number) => void;
  setVanillaVersion: (key: string, version: number) => void;
  syncTabStore: () => Promise<void>;
  closeTab: (keyToRemove: string) => void;
  setActiveTab: (key: string) => void;
  renameTab: (key: string, newTitle: string) => void;
  closeOtherTabs: (currentKey: string) => Array<string>;
  closeLeftTabs: (currentKey: string) => Array<string>;
  closeRightTabs: (currentKey: string) => Array<string>;
  closeAllTabs: () => Array<string>;
  vanilla2JsonContent: (key: string) => void;
  jsonContent2VanillaContent: (key: string) => void;
  updateEditorSettings: (
    key: string,
    settings: TabItem["editorSettings"],
  ) => void;
  // 历史记录相关方法
  addTabHistory: (key: string) => void;
  restoreTabHistory: (tabKey: string, historyKey: string) => void;
  deleteTabHistory: (tabKey: string, historyKey: string) => void;
  clearTabHistory: (tabKey: string) => void;
  clearUserData: () => Promise<void>;
}

export const useTabStore = create<TabStore>()(
  subscribeWithSelector(
    devtools(
      (set, get) => ({
        tabs: [],
        activeTabKey: "1",
        nextKey: 2,
        activeTab: () => {
          const activeTab = get().tabs.find(
            (tab) => tab.key === get().activeTabKey,
          );

          return activeTab || get().tabs[0];
        },
        getTabByKey: (key: string) => get().tabs.find((tab) => tab.key === key),
        addTab: (
          title: string | undefined,
          content: string | undefined,
          extraData?: Record<string, any>,
        ) =>
          set((state) => {
            const settings = useSettingsStore.getState();
            const newTabKey = `${state.nextKey}`;
            const uuid = generateUUID();
            const newTab: TabItem = {
              key: `${state.nextKey}`,
              uuid,
              title: title ? title : `New Tab ${newTabKey}`,
              content: content ? content : ``,
              vanillaMode: Mode.tree,
              closable: true,
              vanillaVersion: 0,
              monacoVersion: 1,
              history: [],
              extraData: extraData,
              editorSettings: {
                fontSize: 14,
                language: "json",
                indentSize: settings.defaultIndentSize,
                timestampDecoratorsEnabled: true,
                base64DecoratorsEnabled: true,
                unicodeDecoratorsEnabled: true,
                urlDecoratorsEnabled: true,
                imageDecoratorsEnabled: true,
              },
            };

            return {
              tabs: [...state.tabs, newTab],
              activeTabKey: newTabKey,
              nextKey: state.nextKey + 1,
            };
          }),
        initTab: () => {
          set((state) => {
            const settings = useSettingsStore.getState();
            const defaultTab = {
              key: "1",
              uuid: generateUUID(),
              title: "New Tab 1",
              content: ``,
              closable: true,
              vanillaMode: Mode.text,
              vanillaVersion: 0,
              monacoVersion: 0,
              history: [],
              editorSettings: {
                fontSize: 14,
                language: "json",
                indentSize: settings.defaultIndentSize,
                timestampDecoratorsEnabled: true,
                base64DecoratorsEnabled: true,
                unicodeDecoratorsEnabled: true,
                urlDecoratorsEnabled: true,
                imageDecoratorsEnabled: true,
              },
            };
            const tabs = [defaultTab];

            return {
              ...state,
              tabs,
            };
          });
        },
        setMonacoVersion: (key: string, version: number) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) =>
              tab.key === key
                ? {
                    ...tab,
                    monacoVersion: version,
                  }
                : tab,
            );

            return { tabs: updatedTabs };
          }),
        setVanillaVersion: (key: string, version: number) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) =>
              tab.key === key
                ? {
                    ...tab,
                    vanillaVersion: version,
                  }
                : tab,
            );

            return { tabs: updatedTabs };
          }),
        setTabContent: (key, content) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) => {
              if (tab.key === key) {
                const updatedTab = {
                  ...tab,
                  content,
                  monacoVersion: tab.monacoVersion + 1,
                };

                // 触发历史记录（不阻塞状态更新）
                setTimeout(() => recordTabHistory(updatedTab), 0);

                return updatedTab;
              }
              return tab;
            });

            return { tabs: updatedTabs };
          }),
        updateTabContent: (key, content) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) => {
              if (tab.key === key) {
                const updatedTab = {
                  ...tab,
                  content,
                  monacoVersion: tab.monacoVersion + 1,
                };

                // 触发历史记录（不阻塞状态更新）
                setTimeout(() => recordTabHistory(updatedTab), 0);

                return updatedTab;
              }
              return tab;
            });

            return { tabs: updatedTabs };
          }),
        setTabModifiedValue: (key, content) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) =>
              tab.key === key
                ? {
                    ...tab,
                    diffModifiedValue: content,
                    monacoVersion: ++tab.monacoVersion,
                  }
                : tab,
            );

            return { tabs: updatedTabs };
          }),
        setTabVanillaContent: (key: string, content: Content) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) => {
              if (tab.key === key) {
                const updatedTab = {
                  ...tab,
                  vanilla: content,
                  vanillaVersion: tab.vanillaVersion + 1,
                };

                // 触发历史记录（不阻塞状态更新）
                setTimeout(() => recordTabHistory(updatedTab), 0);

                return updatedTab;
              }
              return tab;
            });

            return { tabs: updatedTabs };
          }),
        setTabVanillaMode: (key: string, mode: Mode) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) =>
              tab.key === key ? { ...tab, vanillaMode: mode } : tab,
            );

            return { tabs: updatedTabs };
          }),
        // 从存储同步数据
        syncTabStore: async () => {
          // 检查是否启用了数据持久化
          const settings = useSettingsStore.getState();
          if (!settings.persistentDataEnabled) {
            // 如果禁用了持久化，初始化干净的标签页
            get().initTab();
            return;
          }

          const tabs = await storageManager.get<TabItem[]>('tabs');
          const activeTabKey = await storageManager.get<string>('tabs_active_key');
          const nextKey = await storageManager.get<number>('tabs_next_key');
          const data: Record<string, any> = {};

          if (tabs) {
            data.tabs = tabs;
          } else {
            get().initTab();
          }
          if (activeTabKey) {
            data.activeTabKey = activeTabKey;
          }
          if (nextKey) {
            data.nextKey = nextKey;
          }
          set({
            ...data,
          });
        },
        renameTab: (key: string, newTitle: string) =>
          set((state) => {
            // 不允许重命名为空
            if (!newTitle.trim()) return state;

            const updatedTabs = state.tabs.map((tab) =>
              tab.key === key ? { ...tab, title: newTitle.trim() } : tab,
            );

            return { tabs: updatedTabs };
          }),
        closeTab: (keyToRemove) => {
          if (get().tabs.length === 1) {
            get().closeAllTabs();

            return;
          }

          set((state) => {
            const tabIndex = state.tabs.findIndex(
              (tab) => tab.key === keyToRemove,
            );

            const updatedTabs = state.tabs.filter(
              (tab) => tab.key !== keyToRemove,
            );

            let newActiveTab = state.activeTabKey;

            if (keyToRemove === state.activeTabKey && state.tabs.length > 1) {
              if (tabIndex - 1 < 0) {
                newActiveTab = state.tabs[tabIndex + 1].key;
              } else {
                newActiveTab = state.tabs[tabIndex - 1].key;
              }
            }

            return { tabs: updatedTabs, activeTabKey: newActiveTab };
          });
        },
        setActiveTab: (key) => set({ activeTabKey: key }),
        // 关闭其他标签页
        closeOtherTabs: (currentKey): Array<string> => {
          const currentTab = get().tabs.find((tab) => tab.key === currentKey);
          // 将被关闭的key 保存
          const closedTabs = get().tabs.filter((tab) => tab.key !== currentKey);

          const closedKeys = closedTabs.map((tab) => tab.key);

          set(() => {
            return {
              tabs: currentTab ? [currentTab] : [],
              activeTabKey: currentKey,
            };
          });

          return closedKeys;
        },

        // 关闭左侧标签页
        closeLeftTabs: (currentKey): Array<string> => {
          const tabs = get().tabs;
          const currentIndex = tabs.findIndex((tab) => tab.key === currentKey);
          // 将被关闭的key 保存
          const closedTabs = tabs.slice(0, currentIndex);
          const closedKeys = closedTabs.map((tab) => tab.key);
          const updatedTabs = tabs.slice(currentIndex);

          set(() => {
            return {
              tabs: updatedTabs,
              activeTabKey: currentKey,
            };
          });

          return closedKeys;
        },

        // 关闭右侧标签页
        closeRightTabs: (currentKey): Array<string> => {
          const tabs = get().tabs;
          const currentIndex = tabs.findIndex((tab) => tab.key === currentKey);
          // 将被关闭的key 保存
          const closedTabs = tabs.slice(currentIndex + 1);
          const closedKeys = closedTabs.map((tab) => tab.key);

          const updatedTabs = tabs.slice(0, currentIndex + 1);

          set(() => {
            return {
              tabs: updatedTabs,
              activeTabKey: currentKey,
            };
          });

          return closedKeys;
        },
        // 关闭所有标签页，默认保留第一个标签页
        closeAllTabs: (): Array<string> => {
          // 将被关闭的key 保存, 保留key = 1 的标签页
          const closedTabs = get().tabs.filter((tab) => tab.key !== "1");
          const closedKeys = closedTabs.map((tab) => tab.key);

          set(() => {
            const settings = useSettingsStore.getState();
            const defaultTab = {
              key: "1",
              uuid: generateUUID(),
              title: "New Tab 1",
              content: "",
              vanillaMode: Mode.tree,
              closable: true,
              monacoVersion: 0,
              vanillaVersion: 0,
              history: [],
              editorSettings: {
                fontSize: 14,
                language: "json",
                indentSize: settings.defaultIndentSize,
                timestampDecoratorsEnabled: true,
                base64DecoratorsEnabled: true,
                unicodeDecoratorsEnabled: true,
                urlDecoratorsEnabled: true,
                imageDecoratorsEnabled: true,
              },
            };

            return {
              tabs: [defaultTab],
              activeTabKey: "1",
              nextKey: 2,
            };
          });

          return closedKeys;
        },
        vanilla2JsonContent: (key: string) =>
          set((state) => {
            const activeTab = get().getTabByKey(key);

            // 处理空值情况
            if (!activeTab || !activeTab.vanilla) {
              return state;
            }

            const vanilla = activeTab.vanilla;

            // 类型守卫
            const isJSONContent = (content: any): content is JSONContent => {
              return "json" in content;
            };

            const isTextContent = (content: any): content is TextContent => {
              return "text" in content;
            };

            try {
              if (isJSONContent(vanilla)) {
                const indentSize = activeTab.editorSettings.indentSize || 2;

                activeTab.content = stringifyJson(vanilla.json, indentSize);

                // 处理JSON内容
                return {
                  ...state,
                  tabs: state.tabs.map((tab) =>
                    tab.key === activeTab.key ? activeTab : tab,
                  ),
                };
              } else if (isTextContent(vanilla)) {
                activeTab.content = vanilla.text;

                // 处理文本内容
                return {
                  ...state,
                  tabs: state.tabs.map((tab) =>
                    tab.key === activeTab.key ? activeTab : tab,
                  ),
                };
              }

              // 处理未知类型
              console.error("Unknown content type:", vanilla);

              return { ...state, content: "" };
            } catch (error) {
              // 错误处理
              console.error("Error converting content:", error);

              return state;
            }
          }),
        jsonContent2VanillaContent: (key: string) =>
          set((state) => {
            const activeTab = get().getTabByKey(key);

            // 处理空内容情况
            if (!activeTab) {
              return state;
            }

            try {
              // 尝试解析 JSON
              const parsedJson = parseJson(activeTab.content);

              activeTab.vanilla = { json: parsedJson };
              activeTab.vanillaMode = Mode.tree;

              return {
                ...state,
                tabs: state.tabs.map((tab) =>
                  tab.key === activeTab.key ? activeTab : tab,
                ),
              };
            } catch (error) {
              // 解析失败的错误处理
              console.log("jsonContent2VanillaContent 解析失败", error);

              // 可以根据需要返回原状态或者特定的错误状态
              activeTab.vanilla = { text: activeTab.content };
              activeTab.vanillaMode = Mode.text;

              return {
                ...state,
                tabs: state.tabs.map((tab) =>
                  tab.key === activeTab.key ? activeTab : tab,
                ),
              };
            }
          }),
        updateEditorSettings: (
          key: string,
          settings: TabItem["editorSettings"],
        ) =>
          set((state) => {
            const updatedTabs = state.tabs.map((tab) =>
              tab.key === key
                ? {
                    ...tab,
                    editorSettings: {
                      ...tab.editorSettings,
                      ...settings,
                    },
                  }
                : tab,
            );

            return { tabs: updatedTabs };
          }),
        // 添加历史记录（手动触发）
        addTabHistory: (key: string) => {
          const tab = get().getTabByKey(key);
          if (!tab) return;

          recordTabHistory(tab);
        },
        // 恢复历史记录
        restoreTabHistory: (tabKey: string, historyKey: string) => {
          const tab = get().getTabByKey(tabKey);
          if (!tab) {
            console.error('[历史记录] Tab 不存在:', tabKey);
            return;
          }

          const historyItem = tab.history.find((h) => h.key === historyKey);
          if (!historyItem) {
            console.error('[历史记录] 历史记录不存在:', historyKey);
            return;
          }

          console.log('[历史记录] 恢复历史:', {
            tabKey,
            historyKey,
            currentTitle: tab.title,
            historyTitle: historyItem.title,
            currentMonacoVersion: tab.monacoVersion,
            historyMonacoVersion: historyItem.monacoVersion,
          });

          set((state) => {
            // 检查是否有重复的 tab.key
            const duplicateKeys = state.tabs
              .map(t => t.key)
              .filter((k, i, arr) => arr.indexOf(k) !== i);

            if (duplicateKeys.length > 0) {
              console.error('[历史记录] 发现重复的 tab.key:', duplicateKeys);
            }

            return {
              tabs: state.tabs.map((t) => {
                if (t.key === tabKey) {
                  // 保持当前版本号，只恢复内容，避免版本号回退导致问题
                  return {
                    ...t,
                    title: historyItem.title,
                    content: historyItem.content,
                    // 不恢复 monacoVersion 和 vanillaVersion，保持当前版本号
                    vanilla: historyItem.vanilla,
                  };
                }
                return t;
              }),
            };
          });

          console.log('[历史记录] 恢复完成，新的 tabs:', get().tabs.map(t => ({ key: t.key, title: t.title })));
        },
        // 删除指定历史记录
        deleteTabHistory: (tabKey: string, historyKey: string) => {
          set((state) => ({
            tabs: state.tabs.map((t) => {
              if (t.key === tabKey) {
                return {
                  ...t,
                  history: t.history.filter((h) => h.key !== historyKey),
                };
              }
              return t;
            }),
          }));
        },
        // 清空 Tab 的所有历史记录
        clearTabHistory: (tabKey: string) => {
          set((state) => ({
            tabs: state.tabs.map((t) => {
              if (t.key === tabKey) {
                return { ...t, history: [] };
              }
              return t;
            }),
          }));
        },
        // 清除用户数据
        clearUserData: async () => {
          try {
            // 清除用户数据相关的存储键
            await storageManager.remove(DB_TABS);
            await storageManager.remove(DB_TAB_ACTIVE_KEY);
            await storageManager.remove(DB_TAB_NEXT_KEY);

            console.log('用户数据已清除');
          } catch (error) {
            console.error('清除用户数据失败:', error);
            throw error;
          }
        },
      }),
      { name: "tabStore", enabled: true },
    ),
  ),
);

const DB_TABS = "tabs";
const DB_TAB_ACTIVE_KEY = "tabs_active_key";
const DB_TAB_NEXT_KEY = "tabs_next_key";

let tabsSaveTimeout: NodeJS.Timeout;
let tabActiveSaveTimeout: NodeJS.Timeout;
const timeout = 2000;

// 历史记录最大保存数量
const MAX_HISTORY_COUNT = 50;

// 历史记录防抖
const historyRecordTimeouts: Record<string, NodeJS.Timeout> = {};

// 记录历史的辅助函数
const recordTabHistory = (tab: TabItem) => {
  console.log('[历史记录] 准备记录历史:', tab.key, tab.title);

  // 清除之前的定时器
  if (historyRecordTimeouts[tab.key]) {
    clearTimeout(historyRecordTimeouts[tab.key]);
  }

  // 延迟记录，避免频繁记录
  historyRecordTimeouts[tab.key] = setTimeout(() => {
    const currentTab = useTabStore.getState().getTabByKey(tab.key);
    if (!currentTab) {
      console.log('[历史记录] Tab 不存在，跳过记录');
      return;
    }

    // 检查最新历史记录，避免重复
    const latestHistory = currentTab.history[0];
    if (latestHistory) {
      const contentChanged = latestHistory.content !== currentTab.content;
      const titleChanged = latestHistory.title !== currentTab.title;

      // 如果内容和标题都没变化，不记录
      if (!contentChanged && !titleChanged) {
        console.log('[历史记录] 内容未变化，跳过记录');
        return;
      }
    }

    console.log('[历史记录] 记录新的历史:', currentTab.key, currentTab.history.length + 1);

    // 创建新的历史记录（使用更精确的时间戳确保唯一性）
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newHistoryItem: TabHistoryItem = {
      key: `history_${timestamp}_${randomSuffix}_${currentTab.uuid}`,
      timestamp: timestamp,
      title: currentTab.title,
      content: currentTab.content,
      monacoVersion: currentTab.monacoVersion,
      vanilla: currentTab.vanilla,
    };

    // 更新 tab 的历史记录
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.key === currentTab.key) {
          // 限制历史记录数量，最多保存50条
          const history = [newHistoryItem, ...t.history].slice(0, MAX_HISTORY_COUNT);
          console.log('[历史记录] 历史记录已保存，总数:', history.length);
          return { ...t, history };
        }
        return t;
      }),
    }));
  }, 1000); // 延迟 1 秒记录
};

useTabStore.subscribe(
  (state) => state.tabs,
  (tabs) => {
    // 如果是远程更新,不重复广播
    if (isRemoteTabUpdate) return;

    // 检查是否启用了数据持久化
    const persistentDataEnabled = useSettingsStore.getState().persistentDataEnabled;
    if (!persistentDataEnabled) {
      // 如果禁用了持久化，不保存数据
      return;
    }

    clearTimeout(tabsSaveTimeout);
    tabsSaveTimeout = setTimeout(async () => {
      await storageManager.set(DB_TABS, tabs);
      // storageManager 内部会自动广播,无需手动调用
    }, timeout);
  },
);

useTabStore.subscribe(
  (state) => [state.activeTabKey, state.nextKey],
  (arr) => {
    // 如果是远程更新,不重复广播
    if (isRemoteTabUpdate) return;

    // 检查是否启用了数据持久化
    const persistentDataEnabled = useSettingsStore.getState().persistentDataEnabled;
    if (!persistentDataEnabled) {
      // 如果禁用了持久化，不保存数据
      return;
    }

    clearTimeout(tabActiveSaveTimeout);
    tabActiveSaveTimeout = setTimeout(async () => {
      await storageManager.transaction([
        { type: 'set', key: DB_TAB_ACTIVE_KEY, value: arr[0] },
        { type: 'set', key: DB_TAB_NEXT_KEY, value: arr[1] },
      ]);
      // storageManager 内部会自动广播,无需手动调用
    }, timeout);
  },
);

// 多窗口同步：监听来自其他窗口的更新
// 使用标志位防止循环触发
let isRemoteTabUpdate = false;

syncManager.onUpdate(DB_TABS, (data) => {
  if (data && Array.isArray(data) && !isRemoteTabUpdate) {
    isRemoteTabUpdate = true;

    // 使用 setState 方法正确更新状态,触发响应式更新
    useTabStore.setState({ tabs: data });

    // 持久化到本地存储
    storageManager.set(DB_TABS, data, { sync: false });

    setTimeout(() => {
      isRemoteTabUpdate = false;
    }, 100);
  }
});

syncManager.onUpdate('tabs_meta', (data) => {
  if (data && data.activeTabKey && !isRemoteTabUpdate) {
    isRemoteTabUpdate = true;

    useTabStore.setState({
      activeTabKey: data.activeTabKey,
      nextKey: data.nextKey
    });

    // 持久化到本地存储
    storageManager.transaction([
      { type: 'set', key: DB_TAB_ACTIVE_KEY, value: data.activeTabKey },
      { type: 'set', key: DB_TAB_NEXT_KEY, value: data.nextKey }
    ], { sync: false });

    setTimeout(() => {
      isRemoteTabUpdate = false;
    }, 100);
  }
});

// 页面关闭前强制保存
if (typeof window !== "undefined") {
  window.addEventListener('beforeunload', async () => {
    await storageManager.flush();
  });

  // 页面隐藏时也保存（移动端友好）
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      await storageManager.flush();
    }
  });
}
