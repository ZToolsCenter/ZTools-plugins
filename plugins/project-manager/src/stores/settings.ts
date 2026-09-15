import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import type { AiChannelConfig, AiServiceConfig, ManagedRuntimeLocation, Settings } from '../types';
import { MAX_AI_FALLBACK_SLOTS } from '../types';
import type { TerminalInfo } from '../api/types';
import { api } from '../api';
import i18n from '../i18n';
import { normalizeTerminalConfigs } from '../utils/terminalConfig';
import {
  DEFAULT_QUICK_SEARCH_APP_SHORTCUT,
  DEFAULT_QUICK_SEARCH_GLOBAL_SHORTCUT,
  DEFAULT_FOCUS_SEARCH_SHORTCUT,
  DEFAULT_NEW_PROJECT_SHORTCUT,
  DEFAULT_REFRESH_PROJECTS_SHORTCUT,
  DEFAULT_SIDEBAR_MENU_SHORTCUTS,
  SUPERSEDED_SHORTCUT_DEFAULTS,
  SUPERSEDED_SIDEBAR_MENU_SHORTCUTS,
  normalizeShortcut,
} from '../utils/shortcut';
import { createImageDataUrl } from '../utils/backgroundImage';
import { clampWorkspaceExplorerWidth, WORKSPACE_EXPLORER_DEFAULT_WIDTH } from '../utils/workspaceExplorerLayout';
import { applyUiSizeToRoot, DEFAULT_UI_SIZE, normalizeUiSize } from '../utils/uiSize';

function createDefaultAiService(overrides: Partial<AiServiceConfig> = {}): AiServiceConfig {
  return {
    apiType: 'chat_completions',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

function normalizeAiService(value: unknown, fallback: AiServiceConfig): AiServiceConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultAiService(fallback);
  }

  const service = value as Partial<AiServiceConfig>;
  return createDefaultAiService({
    apiType: service.apiType === 'responses' || service.apiType === 'chat_completions'
      ? service.apiType
      : fallback.apiType,
    baseUrl: typeof service.baseUrl === 'string' ? service.baseUrl : fallback.baseUrl,
    apiKey: typeof service.apiKey === 'string' ? service.apiKey : fallback.apiKey,
    model: typeof service.model === 'string' ? service.model : fallback.model,
  });
}

/***********************AI 多渠道回退配置的归一化与迁移*********************/

/**
 * 把 AI 配置补齐成「两种回退模式都可用」的形态。
 *
 * 迁移策略：老版本只有单一的 gitAiPrimaryService，把它同时展开成
 * 单渠道模式的第一个模型和多渠道模式的第一个渠道，默认停在单渠道模式。
 * **继续保留并回写 gitAiPrimaryService**，这样用户降级回旧版本也不丢配置。
 */
function normalizeAiFallbackConfig(target: Partial<Settings>): void {
  const primary = normalizeAiService(target.gitAiPrimaryService, createDefaultAiService());
  target.gitAiPrimaryService = primary;

  if (target.gitAiFallbackMode !== 'multi_channel' && target.gitAiFallbackMode !== 'single_channel') {
    target.gitAiFallbackMode = 'single_channel';
  }

  // 单渠道多模型：服务沿用 primary，模型列表至少含 primary.model
  const single = target.gitAiSingleChannel;
  const singleService = normalizeAiService(single?.service, primary);
  const rawModels = Array.isArray(single?.models) ? single!.models : [];
  const models = rawModels
    .filter((model): model is string => typeof model === 'string')
    .map(model => model.trim())
    .filter(Boolean)
    .slice(0, MAX_AI_FALLBACK_SLOTS);
  if (models.length === 0 && singleService.model.trim()) {
    models.push(singleService.model.trim());
  }
  target.gitAiSingleChannel = { service: singleService, models };

  // 多渠道多模型：至少给一个由 primary 展开的槽位
  const rawChannels = Array.isArray(target.gitAiChannels) ? target.gitAiChannels : [];
  const channels: AiChannelConfig[] = rawChannels
    .slice(0, MAX_AI_FALLBACK_SLOTS)
    .map((channel) => {
      const service = normalizeAiService(channel, primary);
      const id = typeof (channel as AiChannelConfig)?.id === 'string' && (channel as AiChannelConfig).id
        ? (channel as AiChannelConfig).id
        : crypto.randomUUID();
      return {
        ...service,
        id,
        enabled: (channel as AiChannelConfig)?.enabled !== false,
      };
    });
  if (channels.length === 0) {
    channels.push({ ...primary, id: crypto.randomUUID(), enabled: true });
  }
  target.gitAiChannels = channels;

  // 兼容旧版本：回写当前模式真正会优先尝试的服务。
  const activePrimary = target.gitAiFallbackMode === 'multi_channel'
    ? channels.find(channel => channel.enabled !== false) ?? primary
    : { ...singleService, model: models[0] || singleService.model };
  target.gitAiPrimaryService = normalizeAiService(activePrimary, primary);
  target.gitAiBaseUrl = target.gitAiPrimaryService.baseUrl;
  target.gitAiApiKey = target.gitAiPrimaryService.apiKey;
  target.gitAiModel = target.gitAiPrimaryService.model;
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({
    editorPath: 'code',
    defaultTerminal: 'cmd',
    customTerminals: [],
    managedNodeRuntimeLocation: { mode: 'app-data' },
    layoutState: {},
    workspaceExplorerWidth: WORKSPACE_EXPLORER_DEFAULT_WIDTH,
    locale: 'zh',
    themeMode: 'auto',
    uiSize: DEFAULT_UI_SIZE,
    backgroundImagePath: '',
    backgroundImageOpacity: 0.35,
    autoUpdate: true,
    trayEnabled: true,
    closeAction: 'ask',
    autoLaunch: false,
    quickSearchAppShortcut: DEFAULT_QUICK_SEARCH_APP_SHORTCUT,
    quickSearchGlobalShortcutEnabled: false,
    quickSearchGlobalShortcut: DEFAULT_QUICK_SEARCH_GLOBAL_SHORTCUT,
    focusSearchShortcut: DEFAULT_FOCUS_SEARCH_SHORTCUT,
    newProjectShortcut: DEFAULT_NEW_PROJECT_SHORTCUT,
    refreshProjectsShortcut: DEFAULT_REFRESH_PROJECTS_SHORTCUT,
    sidebarMenuShortcuts: [...DEFAULT_SIDEBAR_MENU_SHORTCUTS],
    gitAiEnabled: false,
    gitAiPrimaryService: createDefaultAiService(),
    gitAiStream: true,
    gitAiBaseUrl: 'https://api.openai.com/v1',
    gitAiApiKey: '',
    gitAiModel: 'gpt-4o-mini',
    gitAiPromptTemplate: '',
    gitPullStrategy: 'default',
    gitConfirmDestructive: true,
  });

  const availableTerminals = ref<TerminalInfo[]>([]);

  const fetchAvailableTerminals = async (force = false) => {
    if (availableTerminals.value.length === 0 || force) {
      try {
        const terminals = await api.detectAvailableTerminals();
        // Keep current selection if valid, or default to first
        availableTerminals.value = terminals;
      } catch (e) {
        console.error('Failed to detect terminals:', e);
      }
    }
    return availableTerminals.value;
  };

  // Initial fetch on app start (lazy)
  // We don't want to block app start, so just call it
  fetchAvailableTerminals();

  const stored = localStorage.getItem('settings');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Migrate old themeColor to themeMode if needed, or just ignore
      if (parsed.themeColor && !parsed.themeMode) {
          delete parsed.themeColor;
          parsed.themeMode = 'auto';
      }
      parsed.uiSize = normalizeUiSize(parsed.uiSize);
      // Migrate single editorPath to editors array
      if (!parsed.editors && parsed.editorPath) {
        parsed.editors = [{ id: crypto.randomUUID(), name: parsed.editorPath === 'code' ? 'VS Code' : parsed.editorPath.split(/[/\\]/).pop() || 'Editor', path: parsed.editorPath }];
      }
      if (!parsed.gitAiPrimaryService) {
        parsed.gitAiPrimaryService = createDefaultAiService({
          baseUrl: typeof parsed.gitAiBaseUrl === 'string' && parsed.gitAiBaseUrl ? parsed.gitAiBaseUrl : 'https://api.openai.com/v1',
          apiKey: typeof parsed.gitAiApiKey === 'string' ? parsed.gitAiApiKey : '',
          model: typeof parsed.gitAiModel === 'string' && parsed.gitAiModel ? parsed.gitAiModel : 'gpt-4o-mini',
        });
      }
      if (!parsed.layoutState || typeof parsed.layoutState !== 'object' || Array.isArray(parsed.layoutState)) {
        parsed.layoutState = {};
      }
      parsed.customTerminals = normalizeTerminalConfigs(parsed.customTerminals);
      parsed.gitAiPrimaryService = normalizeAiService(parsed.gitAiPrimaryService, createDefaultAiService());
      // 旧配置只有单一 AI 服务，在这里展开成两种回退模式都可用的形态
      normalizeAiFallbackConfig(parsed);
      if (typeof parsed.gitAiStream !== 'boolean') {
        parsed.gitAiStream = true;
      }
      // Migrate usageWeightEnabled to sortMode
      if (!parsed.sortMode) {
        parsed.sortMode = parsed.usageWeightEnabled ? 'smart' : 'default';
      }
      // 项目总控能力新字段兜底
      if (!Array.isArray(parsed.projectViewPresets)) {
        parsed.projectViewPresets = [];
      }
      if (!Array.isArray(parsed.workspaceProfiles)) {
        parsed.workspaceProfiles = [];
      }
      settings.value = { ...settings.value, ...parsed };
    } catch (e) {
      console.error(e);
    }
  }
  settings.value.gitAiPrimaryService = normalizeAiService(settings.value.gitAiPrimaryService, createDefaultAiService());
  // 没有本地存档时也要补齐回退配置（首次启动、或存档里没有这些字段）
  normalizeAiFallbackConfig(settings.value);
  if (typeof settings.value.gitAiStream !== 'boolean') {
    settings.value.gitAiStream = true;
  }
  settings.value.customTerminals = normalizeTerminalConfigs(settings.value.customTerminals);
  const managedLocation = settings.value.managedNodeRuntimeLocation as Partial<ManagedRuntimeLocation> | undefined;
  if (managedLocation?.mode !== 'app-data' && managedLocation?.mode !== 'custom' && managedLocation?.mode !== 'portable') {
    settings.value.managedNodeRuntimeLocation = { mode: 'app-data' };
  } else if (managedLocation.mode === 'custom') {
    const customPath = typeof managedLocation.customPath === 'string' ? managedLocation.customPath.trim() : '';
    settings.value.managedNodeRuntimeLocation = customPath
      ? { mode: 'custom', customPath }
      : { mode: 'app-data' };
  } else {
    settings.value.managedNodeRuntimeLocation = { mode: managedLocation.mode };
  }
  if (!Array.isArray(settings.value.projectViewPresets)) {
    settings.value.projectViewPresets = [];
  }
  if (!Array.isArray(settings.value.workspaceProfiles)) {
    settings.value.workspaceProfiles = [];
  }
  // Ensure at least one editor exists
  if (!settings.value.editors || settings.value.editors.length === 0) {
    settings.value.editors = [{ id: crypto.randomUUID(), name: 'VS Code', path: settings.value.editorPath || 'code' }];
  }
  // Ensure defaultEditorId is valid
  if (!settings.value.defaultEditorId || !settings.value.editors.find(e => e.id === settings.value.defaultEditorId)) {
    settings.value.defaultEditorId = settings.value.editors[0].id;
  }
  if (!settings.value.layoutState || typeof settings.value.layoutState !== 'object' || Array.isArray(settings.value.layoutState)) {
    settings.value.layoutState = {};
  }
  settings.value.workspaceExplorerWidth = clampWorkspaceExplorerWidth(settings.value.workspaceExplorerWidth);
  if (typeof settings.value.quickSearchAppShortcut !== 'string') {
    settings.value.quickSearchAppShortcut = DEFAULT_QUICK_SEARCH_APP_SHORTCUT;
  } else {
    settings.value.quickSearchAppShortcut = normalizeShortcut(settings.value.quickSearchAppShortcut);
  }
  if (typeof settings.value.quickSearchGlobalShortcutEnabled !== 'boolean') {
    settings.value.quickSearchGlobalShortcutEnabled = false;
  }
  if (typeof settings.value.quickSearchGlobalShortcut !== 'string') {
    settings.value.quickSearchGlobalShortcut = DEFAULT_QUICK_SEARCH_GLOBAL_SHORTCUT;
  } else {
    settings.value.quickSearchGlobalShortcut = normalizeShortcut(settings.value.quickSearchGlobalShortcut);
  }
  // 应用内常用操作快捷键：缺省或写坏时回落到方案默认键位。
  // 只迁移仍等于上一版临时 Alt 默认值的情况，用户自己改过的键位一律尊重。
  for (const [key, fallback] of [
    ['focusSearchShortcut', DEFAULT_FOCUS_SEARCH_SHORTCUT],
    ['newProjectShortcut', DEFAULT_NEW_PROJECT_SHORTCUT],
    ['refreshProjectsShortcut', DEFAULT_REFRESH_PROJECTS_SHORTCUT],
  ] as const) {
    const current = settings.value[key];
    const normalized = typeof current === 'string' ? normalizeShortcut(current) : '';
    const superseded = SUPERSEDED_SHORTCUT_DEFAULTS[key];
    if (superseded && normalized === normalizeShortcut(superseded)) {
      settings.value[key] = fallback;
      continue;
    }
    settings.value[key] = normalized || fallback;
  }
  // 数字键现在统一用于左侧菜单。若用户已有上一版误写入的工作区页签配置，
  // 首次升级时沿用这些键位并删除旧字段，避免 Ctrl+1~5 同时绑定两个目标。
  const legacyWorkspaceShortcuts = Array.isArray(settings.value.workspaceTabShortcuts)
    ? settings.value.workspaceTabShortcuts
    : [];
  const currentSidebarShortcuts = (
    Array.isArray(settings.value.sidebarMenuShortcuts)
      ? settings.value.sidebarMenuShortcuts
      : legacyWorkspaceShortcuts
  ).map(shortcut => normalizeShortcut(String(shortcut || '')));
  const usesSupersededSidebarDefaults = currentSidebarShortcuts.length === SUPERSEDED_SIDEBAR_MENU_SHORTCUTS.length
    && currentSidebarShortcuts.every((shortcut, index) =>
      shortcut === normalizeShortcut(SUPERSEDED_SIDEBAR_MENU_SHORTCUTS[index]),
    );
  settings.value.sidebarMenuShortcuts = DEFAULT_SIDEBAR_MENU_SHORTCUTS.map((fallback, index) => {
    if (usesSupersededSidebarDefaults) return fallback;
    return currentSidebarShortcuts[index] || fallback;
  });
  delete settings.value.workspaceTabShortcuts;
  if (typeof settings.value.backgroundImagePath !== 'string') {
    settings.value.backgroundImagePath = '';
  }
  if (typeof settings.value.backgroundImageOpacity !== 'number') {
    settings.value.backgroundImageOpacity = 0.35;
  }
  settings.value.backgroundImageOpacity = Math.min(1, Math.max(0.1, settings.value.backgroundImageOpacity));
  settings.value.uiSize = normalizeUiSize(settings.value.uiSize);

  const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');

  const updateTheme = (e?: MediaQueryListEvent) => {
      const mode = settings.value.themeMode;
      const isDark = mode === 'dark' || (mode === 'auto' && (e ? e.matches : systemThemeMedia.matches));

      if (isDark) {
          document.documentElement.classList.add('dark');
      } else {
          document.documentElement.classList.remove('dark');
      }
  };

  let backgroundLoadToken = 0;
  let appliedBackgroundPath = '';
  const backgroundImageDataUrl = ref('');
  const backgroundImagePreviewOpacity = ref(settings.value.backgroundImageOpacity ?? 0.35);

  const applyBackgroundImage = async (
    imagePath = settings.value.backgroundImagePath?.trim() || '',
    opacity = settings.value.backgroundImageOpacity ?? 0.35,
    preparedDataUrl?: string,
  ) => {
    const root = document.documentElement;
    const normalizedOpacity = Math.min(1, Math.max(0.1, opacity));
    backgroundImagePreviewOpacity.value = normalizedOpacity;

    if (!imagePath) {
      backgroundLoadToken++;
      appliedBackgroundPath = '';
      backgroundImageDataUrl.value = '';
      root.classList.remove('has-custom-background');
      return;
    }

    if (preparedDataUrl) {
      backgroundLoadToken++;
      backgroundImageDataUrl.value = preparedDataUrl;
      root.classList.add('has-custom-background');
      appliedBackgroundPath = imagePath;
      return;
    }

    if (imagePath === appliedBackgroundPath && backgroundImageDataUrl.value) {
      return;
    }

    const token = ++backgroundLoadToken;
    try {
      const base64 = await api.readBinaryFileBase64(imagePath);
      if (token !== backgroundLoadToken) return;
      backgroundImageDataUrl.value = createImageDataUrl(imagePath, base64);
      root.classList.add('has-custom-background');
      appliedBackgroundPath = imagePath;
    } catch (error) {
      if (token !== backgroundLoadToken) return;
      console.error('Failed to load custom background image', error);
      appliedBackgroundPath = '';
      backgroundImageDataUrl.value = '';
      root.classList.remove('has-custom-background');
    }
  };

  // Listen for system changes
  systemThemeMedia.addEventListener('change', (e) => {
      if (settings.value.themeMode === 'auto') {
          updateTheme(e);
      }
  });

  const applySettings = () => {
    // Locale
    if (settings.value.locale) {
      // @ts-ignore
      i18n.global.locale.value = settings.value.locale;
    }

    // Theme Mode
    updateTheme();
    applyUiSizeToRoot(settings.value.uiSize);
    void applyBackgroundImage();
  };

  // Apply on init
  applySettings();

  watch(settings, (newVal) => {
    const normalizedUiSize = normalizeUiSize(newVal.uiSize);
    if (newVal.uiSize !== normalizedUiSize) {
      settings.value.uiSize = normalizedUiSize;
    }
    localStorage.setItem('settings', JSON.stringify(newVal));
    applySettings();
  }, { deep: true });

  const allTerminals = computed(() => {
    const custom = settings.value.customTerminals || [];
    const detected = availableTerminals.value;
    const ids = new Set(detected.map(t => t.id));
    return [...detected, ...custom.filter(t => !ids.has(t.id))];
  });

  return {
    settings,
    availableTerminals,
    allTerminals,
    fetchAvailableTerminals,
    applyUiSize: () => applyUiSizeToRoot(settings.value.uiSize),
    applyBackgroundImage,
    backgroundImageDataUrl,
    backgroundImagePreviewOpacity,
  };
});
