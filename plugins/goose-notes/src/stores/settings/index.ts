import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uToolsStorage } from "@/lib/storage";
import { applyAccentColor, syncAccentColorCssVars } from "@/lib/accentColor";
import { normalizeCardThemeId } from "@/lib/imageExport/themes";

import type {
  Theme,
  CodeStyle,
  AISettings,
  UToolsSettings,
  DesktopSettings,
} from "./types";
import {
  normalizeCodeStyle,
  normalizeAccentColor,
  resolveCodeTheme,
  normalizeUIFontSize,
  normalizeAutoCloseInactiveTabsHours,
  normalizeAISettings,
  normalizeDesktopHotkeyStatus,
  mergeSearchProvidersWithDefaults,
  normalizeCustomActions,
  UTOOLS_WINDOW_HEIGHT_MIN,
  UTOOLS_WINDOW_HEIGHT_MAX,
  UTOOLS_WINDOW_HEIGHT_DEFAULT,
  DEFAULT_WAKE_HOTKEY,
  DEFAULT_SEARCH_HOTKEY,
  DEFAULT_CLOSE_TAB_SHORTCUT,
  DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT,
} from "./types";

import { createAISlice, type AISlice } from "./slices/aiSlice";
import {
  createAppearanceSlice,
  type AppearanceSlice,
} from "./slices/appearanceSlice";
import { createUToolsSlice, type UToolsSlice } from "./slices/utoolsSlice";
import {
  createShortcutsSlice,
  type ShortcutsSlice,
  DEFAULT_APP_SHORTCUTS,
} from "./slices/shortcutsSlice";
import { NON_CUSTOMIZABLE_APP_SHORTCUT_IDS } from "@/lib/fixed-app-shortcuts";
import {
  createSearchProvidersSlice,
  type SearchProvidersSlice,
} from "./slices/searchProvidersSlice";
import {
  createLocalFolderSlice,
  type LocalFolderSlice,
} from "./slices/localFolderSlice";
import { createWebdavSlice, type WebdavSlice } from "./slices/webdavSlice";
import { normalizeWatermarkConfig } from "@/lib/imageExport";
import { migrateSettingsPersistedState } from "./migrations";

export type SettingsState = AISlice &
  AppearanceSlice &
  UToolsSlice &
  ShortcutsSlice &
  SearchProvidersSlice &
  LocalFolderSlice &
  WebdavSlice & {
    _hasHydrated: boolean;
  };

// 应用主题到 DOM
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  void applyNativeWindowTheme(theme, isDark);

  // Re-apply code style when theme changes (because light/dark mode changed)
  const state = useSettings.getState();
  if (state) {
    applyCodeStyle(state.codeStyle);
    // 明暗切换后重刷 accent 运行时 token（含行内代码色）。
    // apply 可重复调用；sync 则按当前 data-goose-accent 重写，两者等价于兜底。
    applyAccentColor(state.accentColor);
    syncAccentColorCssVars();
  }
}

async function applyNativeWindowTheme(theme: Theme, isDark: boolean) {
  void theme;
  void isDark;
}

// 应用代码主题到 DOM
function applyCodeStyle(codeStyle: CodeStyle) {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const finalClass = resolveCodeTheme(codeStyle, isDark);

  if (finalClass) {
    root.setAttribute("data-code-theme", finalClass);
  } else {
    root.removeAttribute("data-code-theme");
  }
}

const applyFns = { applyTheme, applyAccentColor, applyCodeStyle };
const getApply = () => applyFns;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...createAISlice(set as Parameters<typeof createAISlice>[0]),
      ...createAppearanceSlice(
        set as Parameters<typeof createAppearanceSlice>[0],
        getApply,
      ),
      ...createUToolsSlice(set as Parameters<typeof createUToolsSlice>[0]),
      ...createShortcutsSlice(
        set as Parameters<typeof createShortcutsSlice>[0],
      ),
      ...createSearchProvidersSlice(
        set as Parameters<typeof createSearchProvidersSlice>[0],
      ),
      ...createLocalFolderSlice(
        set as Parameters<typeof createLocalFolderSlice>[0],
      ),
      ...createWebdavSlice(set as Parameters<typeof createWebdavSlice>[0]),
      _hasHydrated: false,
    }),
    {
      name: "goose-note-settings",
      version: 2,
      migrate: (persistedState) =>
        migrateSettingsPersistedState(persistedState),
      storage: createJSONStorage(() => uToolsStorage),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        const theme = state?.theme || "system";
        const accentColor = normalizeAccentColor(state?.accentColor);
        const codeStyle = normalizeCodeStyle(
          state?.codeStyle as string | undefined,
        );
        applyTheme(theme);
        applyAccentColor(accentColor);
        applyCodeStyle(codeStyle);
        if (state && state.accentColor !== accentColor) {
          useSettings.setState({ accentColor });
        }
        if (state && state.codeStyle !== codeStyle) {
          useSettings.setState({ codeStyle });
        }
        const imageExportThemeId = normalizeCardThemeId(
          state?.imageExportThemeId,
        );
        if (state && state.imageExportThemeId !== imageExportThemeId) {
          useSettings.setState({ imageExportThemeId });
        }
        if (state && typeof state.defaultCodeBlockWrap !== "boolean") {
          useSettings.setState({ defaultCodeBlockWrap: false });
        }
        if (state && typeof state.hideExpandArrows !== "boolean") {
          useSettings.setState({ hideExpandArrows: false });
        }
        if (state && typeof state.tableEvenColumnWidth !== "boolean") {
          useSettings.setState({ tableEvenColumnWidth: true });
        }
        const normalizedUIFontSize = normalizeUIFontSize(
          state?.uiFontSize as string | undefined,
        );
        if (state && state.uiFontSize !== normalizedUIFontSize) {
          useSettings.setState({ uiFontSize: normalizedUIFontSize });
        }

        const normalizedWindowHeight = Math.min(
          UTOOLS_WINDOW_HEIGHT_MAX,
          Math.max(
            UTOOLS_WINDOW_HEIGHT_MIN,
            state?.utools?.windowHeight ?? UTOOLS_WINDOW_HEIGHT_DEFAULT,
          ),
        );
        if (
          state?.utools &&
          state.utools.windowHeight !== normalizedWindowHeight
        ) {
          useSettings.setState({
            utools: {
              ...state.utools,
              windowHeight: normalizedWindowHeight,
            },
          });
        }

        const normalizedUTools: UToolsSettings | null = state?.utools
          ? {
              globalSearchEnabled: Boolean(state.utools.globalSearchEnabled),
              openSearchInUtools:
                typeof state.utools.openSearchInUtools === "boolean"
                  ? state.utools.openSearchInUtools
                  : true,
              useInternalImageViewer:
                typeof state.utools.useInternalImageViewer === "boolean"
                  ? state.utools.useInternalImageViewer
                  : false,
              windowHeight: normalizedWindowHeight,
            }
          : null;
        if (
          normalizedUTools &&
          JSON.stringify(state?.utools ?? null) !==
            JSON.stringify(normalizedUTools)
        ) {
          useSettings.setState({ utools: normalizedUTools });
        }

        // Apply window height immediately upon rehydration
        if (normalizedUTools) {
          try {
            const hostWindow = window as Window & {
              utools?: {
                setExpendHeight?: (height: number) => void;
              };
            };
            hostWindow.utools?.setExpendHeight?.(normalizedUTools.windowHeight);
          } catch (e) {
            console.error("Failed to apply window height on rehydrate", e);
          }
        }

        const normalizedAI = normalizeAISettings(
          state?.ai as Partial<AISettings> | undefined,
        );
        if (
          JSON.stringify(state?.ai ?? null) !== JSON.stringify(normalizedAI)
        ) {
          useSettings.setState({ ai: normalizedAI });
        }

        if (state) {
          if (typeof state.webdavUrl !== "string") {
            useSettings.setState({ webdavUrl: "https://example.com/dav/" });
          }
          if (typeof state.webdavUsername !== "string") {
            useSettings.setState({ webdavUsername: "" });
          }
          if (typeof state.webdavPassword !== "string") {
            useSettings.setState({ webdavPassword: "" });
          }
          if (typeof state.webdavRemoteDir !== "string") {
            useSettings.setState({ webdavRemoteDir: "goose-notes" });
          }
          const retention = state.webdavRetentionDays;
          if (
            typeof retention !== "number" ||
            !Number.isFinite(retention) ||
            retention <= 0
          ) {
            useSettings.setState({ webdavRetentionDays: 365 });
          }
          if (typeof state.webdavAutoBackupEnabled !== "boolean") {
            useSettings.setState({ webdavAutoBackupEnabled: true });
          }
          if (typeof state.showRecentInSearch !== "boolean") {
            useSettings.setState({ showRecentInSearch: true });
          }
          const normalizedPrivacy = {
            autoOpenLastNote:
              typeof state.privacy?.autoOpenLastNote === "boolean"
                ? state.privacy.autoOpenLastNote
                : true,
            autoCloseInactiveTabs:
              typeof state.privacy?.autoCloseInactiveTabs === "boolean"
                ? state.privacy.autoCloseInactiveTabs
                : false,
            autoCloseInactiveTabsHours: normalizeAutoCloseInactiveTabsHours(
              state.privacy?.autoCloseInactiveTabsHours,
            ),
          };
          if (
            JSON.stringify(state.privacy ?? null) !==
            JSON.stringify(normalizedPrivacy)
          ) {
            useSettings.setState({ privacy: normalizedPrivacy });
          }

          const normalizedCloseTabShortcut =
            typeof state.closeTabShortcut === "string"
              ? state.closeTabShortcut.trim()
              : DEFAULT_CLOSE_TAB_SHORTCUT;
          const normalizedSearchPanelCloseShortcut =
            typeof state.searchPanelCloseShortcut === "string"
              ? state.searchPanelCloseShortcut.trim()
              : DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT;
          if (
            state.closeTabShortcut !== normalizedCloseTabShortcut ||
            state.searchPanelCloseShortcut !==
              normalizedSearchPanelCloseShortcut
          ) {
            useSettings.setState({
              closeTabShortcut: normalizedCloseTabShortcut,
              searchPanelCloseShortcut: normalizedSearchPanelCloseShortcut,
            });
          }

          const mergedProviders = mergeSearchProvidersWithDefaults(
            state.searchProviders,
          );
          if (
            JSON.stringify(state.searchProviders) !==
            JSON.stringify(mergedProviders)
          ) {
            useSettings.setState({ searchProviders: mergedProviders });
          }

          const normalizedCustomActions = normalizeCustomActions(
            state.customActions,
          );
          if (
            JSON.stringify(state.customActions ?? []) !==
            JSON.stringify(normalizedCustomActions)
          ) {
            useSettings.setState({ customActions: normalizedCustomActions });
          }

          // 只恢复可自定义快捷键。固定动作按当前系统即时计算，不从云端配置继承。
          const storedAppShortcuts =
            (state as { appShortcuts?: Record<string, string> }).appShortcuts ??
            {};
          const mergedAppShortcuts: Record<string, string> = {
            ...DEFAULT_APP_SHORTCUTS,
            ...Object.fromEntries(
              Object.entries(storedAppShortcuts).filter(
                ([id]) => !NON_CUSTOMIZABLE_APP_SHORTCUT_IDS.has(id),
              ),
            ),
          };
          if (
            JSON.stringify(state.appShortcuts) !==
            JSON.stringify(mergedAppShortcuts)
          ) {
            useSettings.setState({ appShortcuts: mergedAppShortcuts });
          }

          const storedDesktop = state.desktop as
            | Partial<DesktopSettings>
            | undefined;
          const mergedDesktop: DesktopSettings = {
            wakeHotkey: storedDesktop?.wakeHotkey ?? DEFAULT_WAKE_HOTKEY,
            wakeHotkeyEnabled: storedDesktop?.wakeHotkeyEnabled ?? true,
            searchHotkey: storedDesktop?.searchHotkey ?? DEFAULT_SEARCH_HOTKEY,
            searchHotkeyEnabled: storedDesktop?.searchHotkeyEnabled ?? true,
            wakeHotkeyStatus: normalizeDesktopHotkeyStatus(
              storedDesktop?.wakeHotkeyStatus,
            ),
            searchHotkeyStatus: normalizeDesktopHotkeyStatus(
              storedDesktop?.searchHotkeyStatus,
            ),
          };
          if (JSON.stringify(state.desktop) !== JSON.stringify(mergedDesktop)) {
            useSettings.setState({ desktop: mergedDesktop });
          }

          const mergedWatermark = normalizeWatermarkConfig(
            state.imageExportWatermark,
          );
          if (
            JSON.stringify(state.imageExportWatermark) !==
            JSON.stringify(mergedWatermark)
          ) {
            useSettings.setState({ imageExportWatermark: mergedWatermark });
          }
        }

        if (state) {
          const normalizedLocalFolderFileManager =
            typeof state.localFolderFileManager === "string"
              ? state.localFolderFileManager.trim()
              : "";
          const normalizedLocalFolderExternalEditor =
            typeof state.localFolderExternalEditor === "string"
              ? state.localFolderExternalEditor.trim()
              : "";
          const normalizedLocalFolderTerminal =
            typeof state.localFolderTerminal === "string"
              ? state.localFolderTerminal.trim()
              : "";
          const normalizedLocalFolderHiddenFolders = Array.isArray(
            state.localFolderHiddenFolders,
          )
            ? state.localFolderHiddenFolders.filter(
                (item: unknown): item is string =>
                  typeof item === "string" && item.length > 0,
              )
            : ["assets"];
          if (
            state.localFolderFileManager !== normalizedLocalFolderFileManager ||
            state.localFolderExternalEditor !==
              normalizedLocalFolderExternalEditor ||
            state.localFolderTerminal !== normalizedLocalFolderTerminal ||
            state.localFolderHiddenFolders !==
              normalizedLocalFolderHiddenFolders
          ) {
            useSettings.setState({
              localFolderFileManager: normalizedLocalFolderFileManager,
              localFolderExternalEditor: normalizedLocalFolderExternalEditor,
              localFolderTerminal: normalizedLocalFolderTerminal,
              localFolderHiddenFolders: normalizedLocalFolderHiddenFolders,
            });
          }
        }
        // 标记 hydration 完成
        useSettings.setState({ _hasHydrated: true });
      },
    },
  ),
);

// 监听系统主题变化
if (typeof window !== "undefined") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChange = () => {
    const { theme, codeStyle } = useSettings.getState();
    if (theme === "system") {
      applyTheme("system");
    }
    applyCodeStyle(codeStyle);
  };
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleSystemThemeChange);
  } else {
    mediaQuery.addListener(handleSystemThemeChange);
  }

  // 立即初始化主题（确保在 DOM 加载后立即应用）
  const initThemes = () => {
    const state = useSettings.getState();
    applyTheme(state.theme);
    applyAccentColor(state.accentColor);
    applyCodeStyle(state.codeStyle);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemes);
  } else {
    initThemes();
  }
}

// Re-export all types from types.ts for backward compatibility
export type {
  SearchProvider,
  Theme,
  AccentColor,
  CodeStyle,
  UToolsSettings,
  AISettings,
  DesktopHotkeyStatusState,
  DesktopHotkeyStatus,
  DesktopSettings,
  PrivacySettings,
  FontConfig,
  CustomFonts,
  CustomAction,
  UIFontSize,
} from "./types";

export {
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_DEFAULT,
  DEFAULT_WAKE_HOTKEY,
  DEFAULT_SEARCH_HOTKEY,
  DEFAULT_CLOSE_TAB_SHORTCUT,
  DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT,
  AUTO_CLOSE_INACTIVE_TABS_HOURS_MIN,
  AUTO_CLOSE_INACTIVE_TABS_HOURS_MAX,
  AUTO_CLOSE_INACTIVE_TABS_HOURS_DEFAULT,
  UTOOLS_WINDOW_HEIGHT_MIN,
  UTOOLS_WINDOW_HEIGHT_MAX,
  UTOOLS_WINDOW_HEIGHT_DEFAULT,
  DEFAULT_SEARCH_PROVIDERS,
  ACCENT_COLORS,
  DEFAULT_ACCENT_COLOR,
} from "./types";

export { DEFAULT_APP_SHORTCUTS } from "./slices/shortcutsSlice";
