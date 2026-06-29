function getHostApi() {
  if (typeof window === 'undefined') return null;

  const api = window.hostTools || window.utools || window.ztools || null;
  if (api && window.hostTools !== api) {
    window.hostTools = api;
  }
  return api;
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
