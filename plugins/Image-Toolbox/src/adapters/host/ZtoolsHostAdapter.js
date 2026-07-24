/**
 * ZtoolsHostAdapter
 * ZTools 平台宿主适配器，继承 BaseHostAdapter。
 */

import BaseHostAdapter from '../../../core/src/adapters/BaseHostAdapter.js';

const DEFAULT_HOST_NAME = 'ZTools';

function normalizeZtoolsUser(user) {
  if (!user) return null;

  return {
    nickname: user.nickname || user.name || user.userName || user.username || '',
    avatar: user.avatar || user.avatarUrl || user.photo || '',
    type: user.type || '',
    raw: user,
  };
}

class ZtoolsHostAdapter extends BaseHostAdapter {
  constructor() {
    super();
    this._isZTools = this._api !== null;
  }

  get platformId() {
    return 'ztools';
  }

  getDefaultHostName() {
    return DEFAULT_HOST_NAME;
  }

  getHostApiPriority() {
    return ['ztools', 'hostTools', 'utools'];
  }

  getAppVersionPriority() {
    return ['getAppVersion', 'getVersion', 'getPluginVersion'];
  }

  getHostDisplayName(api) {
    const target = api || this._api;
    if (!target) return DEFAULT_HOST_NAME;

    try {
      if (typeof target.getAppName === 'function') {
        const name = target.getAppName();
        if (name) return String(name);
      }
    } catch (e) {
      console.warn('[ZtoolsHostAdapter] 获取宿主名称失败:', e);
    }

    if (typeof window !== 'undefined') {
      if (window.ztools) return 'ZTools';
      if (window.utools) return 'uTools';
    }

    return DEFAULT_HOST_NAME;
  }

  normalizeUser(user) {
    return normalizeZtoolsUser(user);
  }

  getRawUser(api) {
    const target = api || this._api;
    try {
      if (target && typeof target.getUser === 'function') return target.getUser();
      if (target && typeof target.getUserInfo === 'function') return target.getUserInfo();
      if (typeof window !== 'undefined' && typeof window.getZtoolsUser === 'function') return window.getZtoolsUser();
    } catch (e) {
      console.warn('[ZtoolsHostAdapter] 获取宿主用户失败:', e);
    }
    return null;
  }

  getContactUrl() {
    return 'https://qm.qq.com/q/xdx9hstuGA';
  }

  get isZTools() {
    return this._isZTools;
  }
}

export default ZtoolsHostAdapter;

// 便捷导出函数（旧 UI 兼容；新代码优先注入 host adapter）
const defaultAdapter = new ZtoolsHostAdapter();

export function getHostAppVersion() {
  return defaultAdapter.getHostAppVersion();
}

export function getHostName() {
  return defaultAdapter.getHostName();
}

export function getHostUser() {
  return defaultAdapter.getHostUser();
}

export function openHostExternal(url) {
  return defaultAdapter.openHostExternal(url);
}
