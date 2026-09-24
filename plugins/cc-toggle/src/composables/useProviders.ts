import { ref } from 'vue';
import { PRESETS as BUILT_IN_PRESETS } from '../data/presets';
import { useRoutes } from './useRoutes';
import { APP_TYPES, APP_LABELS, APP_ICONS, getSkillNest, toPlain } from './shared';
import type { AppType, Provider } from '../types/ztools-cctoggle';

const PRESETS = BUILT_IN_PRESETS;

const providers = ref<Provider[]>([]);

function _initActiveTab(): AppType {
  try {
    const last = window.ztoolsCctoggle?.getLastActiveApp?.();
    if (last && APP_TYPES.includes(last as AppType)) return last as AppType;
  } catch (e) {
    /* ignore */
  }
  return 'codex';
}

const _activeTab = ref<AppType>(_initActiveTab());

function activeTab(): AppType {
  return _activeTab.value;
}

function stopCurrentProxy(): void {
  const ccs = getSkillNest();
  if (!ccs.getProxyStatus || !ccs.stopProxy || !ccs.restoreApp) return;

  for (const appType of APP_TYPES) {
    const status = ccs.getProxyStatus(appType);
    if (status && status.running) {
      ccs.stopProxy(appType);
      ccs.restoreApp(appType);
    }
  }

  try {
    const { refreshStatus } = useRoutes();
    APP_TYPES.forEach(appType => refreshStatus(appType));
  } catch (e) {
    /* ignore */
  }
}

function setActiveTab(t: AppType): void {
  if (t !== _activeTab.value) {
    stopCurrentProxy();
    _activeTab.value = t;
    try {
      window.ztoolsCctoggle?.setLastActiveApp?.(t);
    } catch (e) {
      /* ignore */
    }
    loadProviders();
  }
}

function loadProviders(): void {
  const tab = activeTab();
  if (APP_TYPES.includes(tab)) {
    providers.value = getSkillNest().listProviders(tab);
  }
}

function switchProvider(id: string) {
  const tab = activeTab();
  const target = providers.value.find(pv => pv.id === id);
  const r = getSkillNest().switchProvider(tab, id);
  if (r.success) {
    try {
      getSkillNest().setLastActiveApp?.(tab);
    } catch (e) {
      /* ignore */
    }
    loadProviders();
  }
  return r;
}

function saveProvider(data: Partial<Provider>): void {
  const tab = activeTab();
  const r = getSkillNest().saveProvider(tab, toPlain(data));
  loadProviders();
  // 有实际改动且编辑的是当前激活供应商时，立即重写 CLI 配置使改动生效
  if (r?.changed && data.id && providers.value.find(p => p.id === data.id)?.isCurrent) {
    getSkillNest().reapplyCurrent?.(tab);
  }
}

function deleteProvider(id: string): void {
  getSkillNest().deleteProvider(activeTab(), id);
  loadProviders();
  try {
    const { refreshStatus } = useRoutes();
    APP_TYPES.forEach(appType => refreshStatus(appType));
  } catch (e) {
    /* ignore */
  }
}

function sortProviders(orderedIds: string[]): boolean {
  const tab = activeTab();
  const prev = providers.value.slice();
  const ok = getSkillNest().sortProviders(tab, orderedIds);
  loadProviders();
  if (!ok) {
    providers.value = prev;
  }
  return ok;
}

function presetToProviderData(preset: any): Partial<Provider> {
  const tab = activeTab();
  const base: Partial<Provider> = {
    name: preset.name,
    baseUrl: preset.baseUrl || '',
    apiKey: '',
    model: preset.model || '',
    models: preset.models || [],
    websiteUrl: preset.websiteUrl || '',
    apiKeyUrl: preset.apiKeyUrl || '',
    icon: preset.icon || '',
    iconColor: preset.iconColor || '',
    category: preset.category || 'custom',
    configType:
      preset.configType ||
      (tab === 'claude' || tab === 'claude-desktop'
        ? 'anthropic'
        : tab === 'gemini'
          ? 'gemini'
          : tab === 'openclaw'
            ? 'openclaw'
            : 'openai'),
    endpointCandidates: preset.endpointCandidates || []
  };
  if (tab === 'codex') {
    return Object.assign(base, {
      reasoningEffort: preset.reasoningEffort || 'high',
      wireApi: preset.wireApi || 'responses',
      apiFormat: preset.apiFormat || '',
      modelCatalog: preset.modelCatalog || [],
      authData: preset.authData || { OPENAI_API_KEY: '' },
      extraConfig: preset.config || ''
    });
  } else if (tab === 'claude') {
    return Object.assign(base, { settingsConfig: preset.settingsConfig || { env: {} } });
  } else if (tab === 'claude-desktop') {
    return Object.assign(base, { settingsConfig: preset.settingsConfig || { env: {} } });
  } else if (tab === 'openclaw') {
    return Object.assign(base, {
      apiProtocol: preset.apiProtocol || 'openai-completions',
      settingsConfig: preset.settingsConfig || {},
      suggestedDefaults: preset.suggestedDefaults || null
    });
  }
  return Object.assign(base, { settingsConfig: preset.settingsConfig || { env: {} } });
}

function importPreset(preset: any): void {
  getSkillNest().saveProvider(activeTab(), toPlain(presetToProviderData(preset)));
  loadProviders();
}

function getFullProvider(id: string): Provider | null {
  return getSkillNest().getProvider(activeTab(), id);
}

function copyProvider(id: string): { success: boolean; name?: string; error?: string } {
  const full = getFullProvider(id);
  if (!full) {
    return { success: false, error: '未找到该供应商' };
  }
  const copy: Partial<Provider> = Object.assign({}, full);
  delete copy.id;
  delete copy.appType;
  copy.isCurrent = false;
  copy.name = (full.name || 'Unnamed') + ' (copy)';
  copy.createdAt = '';
  copy.sortOrder = 0;
  saveProvider(copy);
  return { success: true, name: copy.name };
}

const paths = {
  get codexAuth(): string {
    return getSkillNest().paths?.codexAuth || '';
  },
  get codexConfig(): string {
    return getSkillNest().paths?.codexConfig || '';
  },
  get claudeSettings(): string {
    return getSkillNest().paths?.claudeSettings || '';
  },
  get claudeDesktopConfig(): string {
    return getSkillNest().paths?.claudeDesktopConfig || '';
  },
  get openclawConfig(): string {
    return getSkillNest().paths?.openclawConfig || '';
  },
  get geminiEnv(): string {
    return getSkillNest().paths?.geminiEnv || '';
  }
};

export function refreshOnEnter(): void {
  try {
    getSkillNest().reapplyCurrent?.(activeTab());
    loadProviders();
    const { refreshStatus } = useRoutes();
    APP_TYPES.forEach(function (appType) {
      refreshStatus(appType);
    });
  } catch (e) {
    /* ignore */
  }
}

export function useProviders() {
  return {
    APP_TYPES,
    APP_LABELS,
    APP_ICONS,
    PRESETS,
    activeTab,
    setActiveTab,
    providers,
    paths,
    loadProviders,
    switchProvider,
    saveProvider,
    deleteProvider,
    sortProviders,
    copyProvider,
    importPreset,
    getFullProvider,
    presetToProviderData
  };
}
