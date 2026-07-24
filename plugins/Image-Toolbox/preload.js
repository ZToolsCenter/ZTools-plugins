const { initPreload } = require('./core/src/preloadHelpers.js');

// ═══════════════════════════════════════════════════════════════
// ZTools 平台特定配置
// ═══════════════════════════════════════════════════════════════

const PLATFORM_NAME = 'ZTools';
const USER_FN_NAME = 'getZtoolsUser';

const platform = {
  getName: () => PLATFORM_NAME,
  getApiKeys: () => ['hostTools', 'ztools', 'utools'],
  getUserFnName: () => USER_FN_NAME,
  getContactUrl: () => 'https://qm.qq.com/q/xdx9hstuGA',
  onPluginEnter: (callback) => {
    const api = getHostTools();
    if (api && typeof api.onPluginEnter === 'function') {
      api.onPluginEnter(callback);
    }
    return () => {};
  },
  onPluginOut: (callback) => {
    const api = getHostTools();
    if (api && typeof api.onPluginOut === 'function') {
      api.onPluginOut(callback);
    }
    return () => {};
  },
  openExternal: (url) => {
    const api = getHostTools();
    if (api && typeof api.shellOpenExternal === 'function') {
      api.shellOpenExternal(url);
      return true;
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  },
};

// ═══════════════════════════════════════════════════════════════
// API 查找函数（ZTools 平台特定顺序）
// ═══════════════════════════════════════════════════════════════

const getHostTools = () => {
  if (typeof window === 'undefined') return null;

  const priorities = platform.getApiKeys();

  if (typeof window !== 'undefined') {
    for (const key of priorities) {
      if (window[key]) return window[key];
    }
  }

  if (typeof globalThis !== 'undefined') {
    for (const key of priorities) {
      if (globalThis[key]) return globalThis[key];
    }
  }

  return null;
};

const getHostAppVersion = () => {
  const api = getHostTools();
  if (api && typeof api.getAppVersion === 'function') return api.getAppVersion();
  if (api && typeof api.getVersion === 'function') return api.getVersion();
  if (api && typeof api.getPluginVersion === 'function') return api.getPluginVersion();
  return 'unknown';
};

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  initPreload(platform);

  // 注册平台特定 API
  window.getHostAppVersion = getHostAppVersion;
  window.getHostName = () => PLATFORM_NAME;

  window[USER_FN_NAME] = () => {
    const api = getHostTools();
    if (!api) return null;
    try {
      if (typeof api.getUser === 'function') return api.getUser();
      if (typeof api.getUserInfo === 'function') return api.getUserInfo();
    } catch (e) {
      console.warn(`[${PLATFORM_NAME} preload] 获取宿主用户失败:`, e);
    }
    return null;
  };
}
