// ZTools ccToggle - profile-db.ts
// 项目配置方案 CRUD、激活管理

import * as utils from '../utils';

const PROFILE_PREFIX = 'cctoggle_profile_';
const ACTIVE_PROFILE_KEY = 'cctoggle_active_profile';

export interface ProjectProfile {
  _id?: string;
  _rev?: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  providers: Record<string, Record<string, any>>; // appType → providerId → Provider
  lastActiveApp?: string; // 最后激活的 appType tab
  balanceNotify?: Record<string, { balance: number; at: number }>; // `${appType}_${providerId}` → 低余额告警标记
}

export class ProfileStore {
  /** 获取 profile DB key */
  static getProfileKey(profileId: string): string {
    return PROFILE_PREFIX + profileId;
  }

  /** 列出所有用户项目（不含 default） */
  static listProfiles(): ProjectProfile[] {
    try {
      const docs = ztools.db.allDocs(PROFILE_PREFIX) || [];
      return docs
        .filter(function (doc: any) {
          const id = doc.id || doc._id.replace(PROFILE_PREFIX, '');
          return id !== 'default';
        })
        .map(function (doc: any) {
          return {
            id: doc.id || doc._id.replace(PROFILE_PREFIX, ''),
            name: doc.name || '',
            createdAt: doc.createdAt || '',
            updatedAt: doc.updatedAt || '',
            providers: doc.providers || {},
            lastActiveApp: doc.lastActiveApp || '',
            balanceNotify: doc.balanceNotify || {}
          };
        });
    } catch (e) {
      return [];
    }
  }

  /** 列出所有项目（含 default），供全局清理使用 */
  static listAllProfiles(): ProjectProfile[] {
    try {
      const docs = ztools.db.allDocs(PROFILE_PREFIX) || [];
      return docs.map(function (doc: any) {
        return {
          id: doc.id || doc._id.replace(PROFILE_PREFIX, ''),
          name: doc.name || '',
          createdAt: doc.createdAt || '',
          updatedAt: doc.updatedAt || '',
          providers: doc.providers || {},
          lastActiveApp: doc.lastActiveApp || '',
          balanceNotify: doc.balanceNotify || {}
        };
      });
    } catch (e) {
      return [];
    }
  }

  /** 获取单个项目 */
  static getProfile(id: string): ProjectProfile | null {
    try {
      const doc = ztools.db.get(ProfileStore.getProfileKey(id));
      if (!doc) return null;
      return {
        id: id,
        name: doc.name || '',
        createdAt: doc.createdAt || '',
        updatedAt: doc.updatedAt || '',
        providers: doc.providers || {},
        lastActiveApp: doc.lastActiveApp || '',
        balanceNotify: doc.balanceNotify || {}
      };
    } catch (e) {
      return null;
    }
  }

  /** 保存项目（新建或更新），返回 id */
  static saveProfile(data: Partial<ProjectProfile>): string {
    const id = data.id || utils.generateId();
    const key = ProfileStore.getProfileKey(id);
    const existing = ztools.db.get(key);
    const now = new Date().toISOString();

    const doc: any = {
      _id: key,
      _rev: existing ? existing._rev : undefined,
      id: id,
      name: data.name !== undefined ? data.name : existing ? existing.name : 'Unnamed',
      createdAt: data.createdAt || (existing ? existing.createdAt : now),
      updatedAt: now,
      providers: data.providers !== undefined ? data.providers : existing ? existing.providers : {},
      lastActiveApp:
        data.lastActiveApp !== undefined
          ? data.lastActiveApp
          : existing
            ? existing.lastActiveApp
            : '',
      balanceNotify:
        data.balanceNotify !== undefined
          ? data.balanceNotify
          : existing
            ? existing.balanceNotify
            : {}
    };

    ztools.db.put(doc);
    return id;
  }

  /** 删除项目 */
  static deleteProfile(id: string): void {
    // 若删除的是当前激活项目，取消激活
    if (ProfileStore.getActiveProfileId() === id) {
      ProfileStore.deactivateProfile();
    }
    ztools.db.remove(ProfileStore.getProfileKey(id));
  }

  /** 激活项目：遍历项目的供应商，逐一调用 switchProvider */
  static activateProfile(id: string): { success: boolean; error?: string } {
    const profile = ProfileStore.getProfile(id);
    if (!profile) {
      return { success: false, error: 'profile not found' };
    }

    try {
      // 延迟加载避免循环依赖
      const { ProviderStore } = require('./provider-db');
      const proxy = require('../proxy/proxy');

      // 先关闭所有运行中的代理
      const appTypes = ['codex', 'claude', 'claude-desktop', 'openclaw', 'gemini'];
      appTypes.forEach(function (appType) {
        try {
          const status = proxy.ProxyManager.getProxyStatus(appType);
          if (status && status.running) {
            proxy.ProxyManager.stopProxy(appType);
            proxy.ProxyManager.restoreApp(appType);
          }
        } catch (e) {}
      });

      // 遍历项目中配置的 appType
      const providers = profile.providers || {};
      Object.keys(providers).forEach(function (appType) {
        const appProviders = providers[appType] || {};
        // 找到该项目中标记为 isCurrent 的供应商
        const currentId = Object.keys(appProviders).find(function (pid) {
          return appProviders[pid].isCurrent;
        });
        if (currentId) {
          ProviderStore.switchProvider(appType, currentId);
        }
      });

      // 持久化激活状态
      ztools.dbStorage.setItem(ACTIVE_PROFILE_KEY, id);

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /** 取消激活（回到全局默认） */
  static deactivateProfile(): void {
    try {
      ztools.dbStorage.removeItem(ACTIVE_PROFILE_KEY);
    } catch (e) {}
  }

  /** 获取当前激活的项目 ID */
  static getActiveProfileId(): string | null {
    try {
      const raw = ztools.dbStorage.getItem(ACTIVE_PROFILE_KEY);
      const val = raw && typeof raw === 'object' ? raw.value || '' : raw || '';
      return val || null;
    } catch (e) {
      return null;
    }
  }

  /** 获取当前项目的 lastActiveApp */
  static getLastActiveApp(): string {
    try {
      const profile = ProfileStore.getActiveProfile();
      return profile.lastActiveApp || '';
    } catch (e) {
      return '';
    }
  }

  /** 设置当前项目的 lastActiveApp */
  static setLastActiveApp(appType: string): void {
    try {
      const profile = ProfileStore.getActiveProfile();
      ProfileStore.saveProfile({ id: profile.id, lastActiveApp: appType });
    } catch (e) {}
  }

  /** 获取当前激活的项目，无激活则返回 default */
  static getActiveProfile(): ProjectProfile {
    const activeId = ProfileStore.getActiveProfileId();
    if (activeId) {
      const profile = ProfileStore.getProfile(activeId);
      if (profile) return profile;
    }
    // fallback 到 default
    const defaultProfile = ProfileStore.getProfile('default');
    if (defaultProfile) return defaultProfile;
    // 若 default 也不存在，返回空结构
    return {
      id: 'default',
      name: '全局默认',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      providers: {},
      balanceNotify: {}
    };
  }
}
