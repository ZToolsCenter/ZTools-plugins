export function getHostApi() {
  if (typeof window === 'undefined') return null;

  const api = window.hostTools || window.utools || window.ztools || null;
  if (api && window.hostTools !== api) {
    window.hostTools = api;
  }
  return api;
}

export function getHostName() {
  const api = getHostApi();

  try {
    if (api && typeof api.getAppName === 'function') {
      const name = api.getAppName();
      if (name) return String(name);
    }
  } catch (e) {
    console.warn('[Host] 获取宿主名称失败:', e);
  }

  if (typeof window !== 'undefined') {
    if (window.ztools) return 'ZTools';
    if (window.utools) return 'uTools';
  }

  return '本地环境';
}

export function getHostUser() {
  if (typeof window !== 'undefined') {
    try {
      if (typeof window.getHostUser === 'function') return window.getHostUser();
      if (typeof window.getUtoolsUser === 'function') return window.getUtoolsUser();
    } catch (e) {
      console.warn('[Host] 获取宿主用户信息失败:', e);
    }
  }

  const api = getHostApi();
  try {
    if (api && typeof api.getUser === 'function') return api.getUser();
  } catch (e) {
    console.warn('[Host] 获取宿主用户信息失败:', e);
  }

  return null;
}

export function getHostAppVersion() {
  const api = getHostApi();

  try {
    if (api && typeof api.getAppVersion === 'function') return api.getAppVersion();
  } catch (e) {
    console.warn('[Host] 获取宿主版本失败:', e);
  }

  return null;
}

export function isHostDarkColors() {
  const api = getHostApi();

  try {
    if (api && typeof api.isDarkColors === 'function') return !!api.isDarkColors();
  } catch (e) {
    console.warn('[Host] 读取宿主系统颜色失败:', e);
  }

  return null;
}

export function setHostExpendHeight(height) {
  const api = getHostApi();

  try {
    if (api && typeof api.setExpendHeight === 'function') {
      api.setExpendHeight(height);
      return true;
    }
  } catch (e) {
    console.warn('[Host] 设置宿主窗口高度失败:', e);
  }

  return false;
}

export function onHostPluginEnter(callback) {
  const api = getHostApi();

  try {
    if (api && typeof api.onPluginEnter === 'function') {
      api.onPluginEnter(callback);
      return true;
    }
  } catch (e) {
    console.warn('[Host] 注册插件进入事件失败:', e);
  }

  return false;
}

export function openHostExternal(url) {
  const api = getHostApi();

  try {
    if (api && typeof api.shellOpenExternal === 'function') {
      api.shellOpenExternal(url);
      return true;
    }
  } catch (e) {
    console.warn('[Host] 使用宿主打开外部链接失败:', e);
  }

  return false;
}
