// ZTools ccToggle - provider-db.ts
// 供应商 CRUD、切换、导入导出（profile-aware）

import * as utils from '../utils';
import * as configRw from '../config/config-rw';
import * as cryptoApi from '../core/crypto';
import { BalanceManager } from './balance';

export class ProviderStore {
  /** 延迟加载 ProfileStore 避免循环依赖 */
  private static _profileStore: any = null;
  private static get ProfileStore() {
    if (!ProviderStore._profileStore) {
      ProviderStore._profileStore = require('./profile-db').ProfileStore;
    }
    return ProviderStore._profileStore;
  }

  static getProviderKey(appType: string, providerId: string): string {
    return appType + '_' + providerId;
  }

  static listProviders(appType: string): any[] {
    try {
      const profile = ProviderStore.ProfileStore.getActiveProfile();
      const appProviders = (profile.providers || {})[appType] || {};
      const result = Object.keys(appProviders).map(function (id) {
        const p = appProviders[id];
        return {
          id: id,
          name: p.name || '',
          baseUrl: p.baseUrl || '',
          model: p.model || '',
          models: p.models || [],
          websiteUrl: p.websiteUrl || '',
          remark: p.remark || '',
          icon: p.icon || '',
          iconColor: p.iconColor || '',
          category: p.category || '',
          configType: p.configType || '',
          isCurrent: p.isCurrent || false,
          sortOrder: p.sortOrder || 0,
          createdAt: p.createdAt || '',
          apiFormat: p.apiFormat || '',
          wireApi: p.wireApi || '',
          balance: p.balance || null
        };
      });
      // 按 (sortOrder, createdAt) 稳定排序；同值时保持对象键（插入）顺序
      return result.sort(function (a: any, b: any) {
        const sa = a.sortOrder || 0;
        const sb = b.sortOrder || 0;
        if (sa !== sb) return sa - sb;
        const ca = a.createdAt || '';
        const cb = b.createdAt || '';
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
    } catch (e) {
      return [];
    }
  }

  static getProvider(appType: string, providerId: string): any {
    try {
      const profile = ProviderStore.ProfileStore.getActiveProfile();
      const p = ((profile.providers || {})[appType] || {})[providerId];
      if (!p) return null;

      // 从 profile 中的密文解密；失败/无密文时兜底回读旧 dbCryptoStorage Key
      let apiKey = '';
      if (p.encryptedApiKey) {
        try {
          apiKey = cryptoApi.decryptSecret(p.encryptedApiKey);
        } catch (e: any) {
          console.error(
            '[ProviderStore] Failed to decrypt apiKey:',
            appType,
            providerId,
            e.message
          );
          apiKey = '';
        }
      }
      if (!apiKey && cryptoApi.isCryptoStorageKey(appType, providerId)) {
        apiKey = cryptoApi.getCryptoStorageKey(appType, providerId);
      }

      return {
        id: providerId,
        appType: appType,
        name: p.name || '',
        baseUrl: p.baseUrl || '',
        apiKey: apiKey,
        authType: p.authType || 'api_key',
        apiKeyHeader: p.apiKeyHeader || 'Authorization',
        apiKeyPrefix: p.apiKeyPrefix || 'Bearer ',
        reasoningEffort: p.reasoningEffort || 'high',
        maxTokens: p.maxTokens || '',
        temperature: p.temperature || '',
        extraHeaders: p.extraHeaders || '',
        model: p.model || '',
        models: p.models || [],
        websiteUrl: p.websiteUrl || '',
        remark: p.remark || '',
        icon: p.icon || '',
        iconColor: p.iconColor || '',
        category: p.category || 'custom',
        configType: p.configType || 'openai',
        authData: p.authData || {},
        extraConfig: p.extraConfig || '',
        settingsConfig: p.settingsConfig || {},
        authField: p.authField || 'ANTHROPIC_AUTH_TOKEN',
        wireApi: p.wireApi || '',
        apiFormat: p.apiFormat || '',
        apiKeyUrl: p.apiKeyUrl || '',
        modelCatalog: p.modelCatalog || [],
        endpointCandidates: p.endpointCandidates || [],
        customUserAgent: p.customUserAgent || '',
        headersOverride: p.headersOverride || '',
        bodyOverride: p.bodyOverride || '',
        authMethod: p.authMethod || 'api_key',
        impersonateClaudeCode: p.impersonateClaudeCode || false,
        apiProtocol: p.apiProtocol || '',
        suggestedDefaults: p.suggestedDefaults || null,
        isCurrent: p.isCurrent || false,
        sortOrder: p.sortOrder || 0,
        createdAt: p.createdAt || '',
        balance: p.balance || null
      };
    } catch (e) {
      return null;
    }
  }

  /** 将单个供应商写入 active profile，返回 { id, changed }；数据无改动时跳过写入 */
  static saveProvider(appType: string, providerData: any): { id: string; changed: boolean } {
    const id = providerData.id || utils.generateId();
    const apiKey = providerData.apiKey || '';

    const profile = ProviderStore.ProfileStore.getActiveProfile();
    const existing = ((profile.providers || {})[appType] || {})[id];

    // 计算加密后的 Key：
    // - 明文未变化（含未填写）时沿用现有密文，避免无效重加密导致误判为"已改动"
    // - 明文变化/无现有时才重新加密，写入 profile
    let encryptedApiKey = '';
    if (apiKey) {
      let oldPlain = '';
      if (existing && existing.encryptedApiKey) {
        try {
          oldPlain = cryptoApi.decryptSecret(existing.encryptedApiKey);
        } catch (e) {
          oldPlain = '';
        }
      }
      if (oldPlain === apiKey) {
        encryptedApiKey = existing.encryptedApiKey || '';
      } else {
        encryptedApiKey = cryptoApi.encryptSecret(apiKey);
      }
    } else if (existing && existing.encryptedApiKey) {
      encryptedApiKey = existing.encryptedApiKey;
    }

    const provider: Record<string, any> = {
      name: providerData.name || 'Unnamed',
      baseUrl: providerData.baseUrl || '',
      model: providerData.model || '',
      models: providerData.models || [],
      websiteUrl: providerData.websiteUrl || '',
      remark: providerData.remark || '',
      icon: providerData.icon || '',
      iconColor: providerData.iconColor || '',
      category: providerData.category || 'custom',
      authType: providerData.authType || 'api_key',
      apiKeyHeader: providerData.apiKeyHeader || 'Authorization',
      apiKeyPrefix: providerData.apiKeyPrefix || 'Bearer ',
      reasoningEffort: providerData.reasoningEffort || 'high',
      maxTokens: providerData.maxTokens || '',
      temperature: providerData.temperature || '',
      extraHeaders: providerData.extraHeaders || '',
      configType: providerData.configType || 'openai',
      authData: providerData.authData || {},
      extraConfig: providerData.extraConfig || '',
      settingsConfig: providerData.settingsConfig || {},
      authField: providerData.authField || 'ANTHROPIC_AUTH_TOKEN',
      wireApi: providerData.wireApi || '',
      apiFormat: providerData.apiFormat || '',
      apiKeyUrl: providerData.apiKeyUrl || '',
      modelCatalog: providerData.modelCatalog || [],
      endpointCandidates: providerData.endpointCandidates || [],
      customUserAgent: providerData.customUserAgent || '',
      headersOverride: providerData.headersOverride || '',
      bodyOverride: providerData.bodyOverride || '',
      authMethod: providerData.authMethod || 'api_key',
      impersonateClaudeCode: providerData.impersonateClaudeCode || false,
      apiProtocol: providerData.apiProtocol || '',
      suggestedDefaults: providerData.suggestedDefaults || null,
      isCurrent:
        providerData.isCurrent !== undefined
          ? providerData.isCurrent
          : existing
            ? existing.isCurrent
            : false,
      sortOrder:
        providerData.sortOrder !== undefined
          ? providerData.sortOrder
          : existing
            ? existing.sortOrder
            : 0,
      createdAt:
        providerData.createdAt || (existing ? existing.createdAt : new Date().toISOString()),
      encryptedApiKey: encryptedApiKey,
      balance: providerData.balance || null
    };

    // 数据与加密 Key 均无改动时跳过写入，避免触发无意义的配置重应用
    if (existing) {
      if (JSON.stringify(provider) === JSON.stringify(existing)) {
        return { id: id, changed: false };
      }
    }

    // 更新 profile 中的供应商
    const providers = Object.assign({}, profile.providers || {});
    if (!providers[appType]) providers[appType] = {};
    providers[appType] = Object.assign({}, providers[appType]);
    providers[appType][id] = provider;

    ProviderStore.ProfileStore.saveProfile({
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt,
      providers: providers
    });

    // 新增/复制供应商：按 (sortOrder, createdAt) 全量重排归属，落在「原 sortOrder 为 0 的一批」之后
    if (!existing) {
      ProviderStore.renumberApp(appType);
    }

    return { id: id, changed: true };
  }

  /** 按 (sortOrder, createdAt) 稳定排序后将该 App 全部供应商重编号为连续 0..n-1 */
  private static renumberApp(appType: string): void {
    try {
      const profile = ProviderStore.ProfileStore.getActiveProfile();
      const appProviders = Object.assign({}, (profile.providers || {})[appType] || {});
      const entries = Object.keys(appProviders)
        .map(function (id) {
          return { id: id, p: appProviders[id] };
        })
        .sort(function (a, b) {
          const sa = a.p.sortOrder || 0;
          const sb = b.p.sortOrder || 0;
          if (sa !== sb) return sa - sb;
          const ca = a.p.createdAt || '';
          const cb = b.p.createdAt || '';
          return ca < cb ? -1 : ca > cb ? 1 : 0;
        });
      const renumbered: Record<string, any> = {};
      entries.forEach(function (entry, idx) {
        renumbered[entry.id] = Object.assign({}, entry.p, { sortOrder: idx });
      });
      const providers = Object.assign({}, profile.providers || {});
      providers[appType] = renumbered;
      ProviderStore.ProfileStore.saveProfile({
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        providers: providers
      });
    } catch (e) {}
  }

  /**
   * 按给定 id 顺序为同 App 供应商重编号连续 sortOrder（0..n-1）。
   * 只改 sortOrder，不动 isCurrent / 配置 / 代理状态。返回是否成功。
   */
  static sortProviders(appType: string, orderedIds: string[]): boolean {
    try {
      const profile = ProviderStore.ProfileStore.getActiveProfile();
      const appProviders = Object.assign({}, (profile.providers || {})[appType] || {});
      const seen = new Set(orderedIds);
      // 兜底：orderedIds 未覆盖的供应商追加到尾部（防御性，正常不会发生）
      const fullOrder = [...orderedIds, ...Object.keys(appProviders).filter(id => !seen.has(id))];
      const renumbered: Record<string, any> = {};
      fullOrder.forEach(function (id, idx) {
        if (appProviders[id]) {
          renumbered[id] = Object.assign({}, appProviders[id], { sortOrder: idx });
        }
      });
      const providers = Object.assign({}, profile.providers || {});
      providers[appType] = renumbered;
      ProviderStore.ProfileStore.saveProfile({
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        providers: providers
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  static deleteProvider(appType: string, providerId: string): boolean {
    // 从 active profile 中删除
    const profile = ProviderStore.ProfileStore.getActiveProfile();
    const providers = Object.assign({}, profile.providers || {});
    if (providers[appType]) {
      providers[appType] = Object.assign({}, providers[appType]);
      delete providers[appType][providerId];
      ProviderStore.ProfileStore.saveProfile({
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        providers: providers
      });
    }

    // 清理关联的余额缓存与告警状态
    try {
      BalanceManager.clearProviderCache(providerId);
      BalanceManager.clearProviderNotify(providerId);
    } catch (e) {}

    // 清理关联的路由组
    try {
      var proxy = require('../proxy/proxy');
      var groups = proxy.ProxyManager.listRouteGroups(appType);
      groups.forEach(function (g: any) {
        var before = (g.members || []).length;
        g.members = (g.members || []).filter(function (m: any) {
          return m.providerId !== providerId;
        });
        if (g.members.length !== before) {
          g.appType = appType;
          if (g.members.length === 0) {
            proxy.ProxyManager.deleteRouteGroup(appType, g.id);
            if (proxy.ProxyManager.proxyRuntime._active === appType) {
              proxy.ProxyManager.stopProxy(appType);
              proxy.ProxyManager.restoreApp(appType);
            }
          } else {
            proxy.ProxyManager.saveRouteGroup(g);
          }
        }
      });
    } catch (e) {}
    return true;
  }

  static switchProvider(appType: string, providerId: string): any {
    const provider = ProviderStore.getProvider(appType, providerId);
    if (!provider) {
      return { success: false, error: 'provider not found' };
    }

    try {
      if (appType === 'codex') {
        configRw.switchProviderCodex(provider);
      } else if (appType === 'claude') {
        configRw.switchProviderClaude(provider);
      } else if (appType === 'openclaw') {
        configRw.switchProviderOpenclaw(provider);
      } else if (appType === 'gemini') {
        configRw.switchProviderGemini(provider);
      } else if (appType === 'opencode') {
        configRw.switchProviderOpenCode(provider);
      } else if (appType === 'claude-desktop') {
        configRw.switchProviderClaudeDesktop(provider);
      } else {
        return { success: false, error: 'unknown app type' };
      }
      ProviderStore.markCurrent(appType, providerId);
      return { success: true, providerName: provider.name };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static markCurrent(appType: string, providerId: string): void {
    const profile = ProviderStore.ProfileStore.getActiveProfile();
    const providers = Object.assign({}, profile.providers || {});
    if (!providers[appType]) return;

    const appProviders: Record<string, any> = {};
    Object.keys(providers[appType]).forEach(function (pid) {
      appProviders[pid] = Object.assign({}, providers[appType][pid], {
        isCurrent: pid === providerId
      });
    });
    providers[appType] = appProviders;

    ProviderStore.ProfileStore.saveProfile({
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt,
      providers: providers
    });
  }

  static getCurrentProviderId(appType: string): string | null {
    const all = ProviderStore.listProviders(appType);
    const current = all.find(function (p) {
      return p.isCurrent;
    });
    return current ? current.id : null;
  }

  static setLastActiveApp(appType: string): boolean {
    try {
      ProviderStore.ProfileStore.setLastActiveApp(appType);
    } catch (e) {}
    return true;
  }

  static getLastActiveApp(): string {
    try {
      return ProviderStore.ProfileStore.getLastActiveApp();
    } catch (e) {
      return '';
    }
  }

  static reapplyCurrent(onlyAppType?: string): any {
    const result: Record<string, any> = {};
    const apps = onlyAppType ? [onlyAppType] : ['codex', 'claude', 'gemini', 'openclaw'];
    apps.forEach(function (appType) {
      try {
        var proxy = require('../proxy/proxy');
        const rt = proxy.ProxyManager.proxyRuntime[appType];
        if (rt && rt.running) {
          result[appType] = { skipped: 'proxy running' };
          return;
        }
        const id = ProviderStore.getCurrentProviderId(appType);
        if (!id) {
          result[appType] = { skipped: 'no current' };
          return;
        }
        const r = ProviderStore.switchProvider(appType, id);
        result[appType] = r;
      } catch (e: any) {
        result[appType] = { success: false, error: e.message };
      }
    });
    return result;
  }

  static exportAllProviders(): any {
    const result: Record<string, any> = {
      codex: [],
      claude: [],
      gemini: [],
      exportTime: new Date().toISOString()
    };
    ['codex', 'claude', 'gemini'].forEach(function (appType) {
      const providers = ProviderStore.listProviders(appType);
      providers.forEach(function (p: any) {
        const full = ProviderStore.getProvider(appType, p.id);
        result[appType].push(full);
      });
    });
    return result;
  }

  static importProviders(data: any): number {
    let count = 0;
    ['codex', 'claude', 'gemini'].forEach(function (appType) {
      (data[appType] || []).forEach(function (p: any) {
        p.appType = appType;
        ProviderStore.saveProvider(appType, p);
        count++;
      });
    });
    return count;
  }
}
