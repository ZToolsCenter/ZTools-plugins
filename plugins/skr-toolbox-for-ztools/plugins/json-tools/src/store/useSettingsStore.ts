// useSettingsStore.ts
import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";

import { storage } from "@/lib/indexedDBStore";

// 定义聊天窗口样式类型
export type ChatStyle = "bubble" | "document";

// 定义字体大小类型
export type FontSize = "small" | "medium" | "large";

// 定义 Monaco 编辑器 CDN 类型
export type MonacoEditorCDN = "local" | "cdn";

// 全局设置状态接口
export interface SettingsState {
  // 数据持久化设置
  editDataSaveLocal: boolean;
  // 侧边栏展开状态
  expandSidebar: boolean;
  // Monaco 编辑器 CDN 配置
  monacoEditorCDN: MonacoEditorCDN;
  // 聊天窗口样式
  chatStyle: ChatStyle;
  // 字体大小设置
  fontSize: FontSize;
  // 解码器设置
  timestampDecoderEnabled: boolean;
  base64DecoderEnabled: boolean;
  unicodeDecoderEnabled: boolean;
  urlDecoderEnabled: boolean;
  // 编辑器默认设置
  defaultIndentSize: number;
  // 快捷键设置
  newTabShortcut: string;
  closeTabShortcut: string;

  // Actions
  setEditDataSaveLocal: (value: boolean) => void;
  setExpandSidebar: (value: boolean) => void;
  setMonacoEditorCDN: (value: MonacoEditorCDN) => void;
  setChatStyle: (value: ChatStyle) => void;
  setFontSize: (value: FontSize) => void;
  setTimestampDecoderEnabled: (value: boolean) => void;
  setBase64DecoderEnabled: (value: boolean) => void;
  setUnicodeDecoderEnabled: (value: boolean) => void;
  setUrlDecoderEnabled: (value: boolean) => void;
  setDefaultIndentSize: (value: number) => void;
  setNewTabShortcut: (value: string) => void;
  setCloseTabShortcut: (value: string) => void;
  setSettings: (settings: Partial<SettingsState>) => void;
  syncSettingsStore: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    devtools(
      (set) => ({
        // 初始状态
        editDataSaveLocal: true,
        expandSidebar: false,
        monacoEditorCDN: "local",
        chatStyle: "bubble",
        fontSize: "medium",
        timestampDecoderEnabled: true,
        base64DecoderEnabled: true,
        unicodeDecoderEnabled: true,
        urlDecoderEnabled: true,
        defaultIndentSize: 4,
        newTabShortcut: "Ctrl+Shift+T",
        closeTabShortcut: "Ctrl+Shift+W",

        // Actions 实现
        setEditDataSaveLocal: (value: boolean) =>
          set({ editDataSaveLocal: value }),
        setExpandSidebar: (value: boolean) => set({ expandSidebar: value }),
        setMonacoEditorCDN: (value: MonacoEditorCDN) =>
          set({ monacoEditorCDN: value }),
        setChatStyle: (value: ChatStyle) => set({ chatStyle: value }),
        setFontSize: (value: FontSize) => set({ fontSize: value }),
        setTimestampDecoderEnabled: (value: boolean) =>
          set({ timestampDecoderEnabled: value }),
        setBase64DecoderEnabled: (value: boolean) =>
          set({ base64DecoderEnabled: value }),
        setUnicodeDecoderEnabled: (value: boolean) =>
          set({ unicodeDecoderEnabled: value }),
        setUrlDecoderEnabled: (value: boolean) =>
          set({ urlDecoderEnabled: value }),
        setDefaultIndentSize: (value: number) =>
          set({ defaultIndentSize: value }),
        setNewTabShortcut: (value: string) => set({ newTabShortcut: value }),
        setCloseTabShortcut: (value: string) =>
          set({ closeTabShortcut: value }),
        setSettings: (settings: Partial<SettingsState>) => set(settings),
        // 从 IndexedDB 同步设置数据
        syncSettingsStore: async () => {
          const settings = await storage.getItem<SettingsState>(DB_SETTINGS);

          if (settings) {
            set(settings);
          }
        },
      }),
      { name: "settingsStore", enabled: true },
    ),
  ),
);

const DB_SETTINGS = "settings";

// 防抖保存设置到 IndexedDB
let settingsSaveTimeout: NodeJS.Timeout;
const timeout = 1000;

useSettingsStore.subscribe(
  (state) => state,
  (settings) => {
    clearTimeout(settingsSaveTimeout);
    settingsSaveTimeout = setTimeout(() => {
      storage.setItem(DB_SETTINGS, settings);
    }, timeout);
  },
);
